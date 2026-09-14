const Session = require('../models/session.model');
const SessionConfig = require('../models/sessionConfig.model');
const User = require('../models/user.model');
const commissionService = require('./commission.service');
const generalConfigService = require('./generalConfig.service');
const notificationService = require('./notification.service');
const { nextLotNumber } = require('../models/counter.model');

/**
 * Récupère ou initialise la configuration des sessions (Lundi, Mercredi, Vendredi, 48h)
 */
const getConfig = async () => {
  let config = await SessionConfig.findOne();
  if (!config) {
    config = new SessionConfig({
      daysOfWeek: [1, 3, 5], // Lundi (1), Mercredi (3), Vendredi (5)
      startTime: '10:00',
      durationHours: 48,
      autoGenerateWeeks: 4,
    });
    await config.save();
  }
  return config;
};

/**
 * Mettre à jour la configuration et régénérer le calendrier
 */
const updateConfig = async (payload) => {
  let config = await SessionConfig.findOne();
  if (!config) {
    config = new SessionConfig();
  }

  if (Array.isArray(payload.daysOfWeek)) config.daysOfWeek = payload.daysOfWeek;
  if (payload.startTime) config.startTime = payload.startTime;
  if (payload.durationHours !== undefined) config.durationHours = Number(payload.durationHours);
  if (payload.autoGenerateWeeks !== undefined) config.autoGenerateWeeks = Number(payload.autoGenerateWeeks);

  await config.save();
  await autoGenerateAndSyncSessions();
  return config;
};

/**
 * Synchronise les statuts des sessions existantes en fonction de la date courante (now)
 */
const syncSessionStatuses = async () => {
  const now = new Date();
  const sessions = await Session.find({ status: { $ne: 'annulee' } });

  for (const [index, session] of sessions.entries()) {
    let newStatus = session.status;
    const start = new Date(session.startDate || session.date);
    if (Number.isNaN(start.getTime())) {
      console.warn(`Session ${session._id} ignorée : aucune date de début valide.`);
      continue;
    }

    const end = new Date(
      session.endDate || (start.getTime() + (session.durationHours || 48) * 3600 * 1000)
    );

    // Normaliser les anciennes sessions qui ne possédaient que le champ `date`.
    // Sans cette migration, la mise à jour du statut échoue car les champs actuels
    // name, startDate et endDate sont obligatoires dans le modèle.
    if (!session.name) session.name = `Session #${index + 1}`;
    if (!session.startDate) session.startDate = start;
    if (!session.endDate) session.endDate = end;
    if (!session.date) session.date = start;

    if (now > end) {
      newStatus = 'closed';
    } else if (now >= start && now <= end) {
      newStatus = 'open';
    } else {
      newStatus = 'upcoming';
    }

    if (session.status !== newStatus) session.status = newStatus;

    if (session.isModified()) {
      await session.save();
    }
  }
};

/**
 * Met à jour les statuts des sessions existantes, puis crée les sessions hebdomadaires
 * récurrentes manquantes d'après la planification (Sessions > Planification).
 * Ne crée que des sessions vides : leur contenu est affecté manuellement par l'admin.
 */
const autoGenerateAndSyncSessions = async () => {
  await syncSessionStatuses();

  const config = await getConfig();
  const now = new Date();

  const [hoursStr, minutesStr] = (config.startTime || '10:00').split(':');
  const startHours = parseInt(hoursStr, 10) || 10;
  const startMinutes = parseInt(minutesStr, 10) || 0;

  // Calcul du nombre total de sessions existantes pour la numérotation
  let totalSessionCount = await Session.countDocuments();

  // Pour les N semaines à venir
  for (let week = 0; week < config.autoGenerateWeeks; week++) {
    for (const dayOfWeek of config.daysOfWeek) {
      // Trouver la date correspondante à cette semaine pour le jour donné
      const targetDate = new Date();
      targetDate.setHours(startHours, startMinutes, 0, 0);

      // Calculer le décalage de jours par rapport à aujourd'hui
      const currentDayOfWeek = targetDate.getDay(); // 0=Sun, 1=Mon...
      let dayDiff = dayOfWeek - currentDayOfWeek;
      dayDiff += week * 7;

      targetDate.setDate(targetDate.getDate() + dayDiff);

      // Ne pas créer de session récurrente dans le passé si elle est déjà terminée
      const endDate = new Date(targetDate.getTime() + config.durationHours * 3600 * 1000);
      if (endDate < now) continue;

      // Vérifier si une session existe déjà à cette date (+/- 2 heures)
      const windowStart = new Date(targetDate.getTime() - 2 * 3600 * 1000);
      const windowEnd = new Date(targetDate.getTime() + 2 * 3600 * 1000);

      const existing = await Session.findOne({
        startDate: { $gte: windowStart, $lte: windowEnd },
      });

      if (!existing) {
        totalSessionCount += 1;
        let initialStatus = 'upcoming';
        if (now >= targetDate && now <= endDate) {
          initialStatus = 'open';
        }

        const newSession = new Session({
          name: `Session #${totalSessionCount}`,
          startDate: targetDate,
          endDate: endDate,
          date: targetDate,
          durationHours: config.durationHours,
          isManual: false,
          status: initialStatus,
          // Les sessions récurrentes suivent la configuration de commission par défaut
          commission: { useDefault: true, tiers: [] },
        });

        await newSession.save();
      }
    }
  }

  // L'affectation des véhicules aux sessions est exclusivement manuelle (voir
  // assignVehicleToSession, appelée depuis l'interface admin) : la génération automatique
  // ne crée que le calendrier des sessions, jamais leur contenu.
};

/**
 * Prévenir l'administrateur (centre de notifications in-app) qu'un véhicule vient d'atteindre
 * le nombre de mises en vente autorisé sans trouver preneur. Un échec d'envoi ne doit jamais
 * faire échouer l'affectation elle-même.
 */
const notifyAdminOfMaxAttempts = async (vehicle, listingCount) => {
  try {
    const seller = await User.findById(vehicle.seller).select('companyName firstName lastName');
    await notificationService.createAdminVehicleMaxAttemptsNotification(vehicle, seller, listingCount);
  } catch (err) {
    console.error(`Erreur lors de la notification admin (tentatives max, véhicule ${vehicle._id}) : ${err.message}`);
  }
};

/**
 * Publier un véhicule dans une session. L'affectation est toujours déclenchée manuellement
 * depuis l'interface admin, et incrémente le compteur de tentatives de vente du véhicule
 * (cahier des charges §6.11). Une réaffectation à la même session — après un retrait par
 * exemple — ne recompte pas la tentative.
 *
 * Le nombre de tentatives autorisées (Configuration > Configuration générale) ne bloque pas
 * l'affectation : c'est un repère affiché à l'administrateur, qui reste libre de republier
 * un véhicule au-delà. Dès que ce nombre est atteint, l'admin en est prévenu par notification
 * — le véhicule réclame alors une décision commerciale (baisse du prix, retrait...).
 */
const assignVehicleToSession = async (vehicle, sessionId) => {
  const sessionKey = String(sessionId);
  const isNewListing = String(vehicle.lastListedSession || '') !== sessionKey;

  vehicle.session = sessionKey;
  if (isNewListing) {
    vehicle.lastListedSession = sessionId;
    vehicle.listingCount = (vehicle.listingCount || 0) + 1;
    // Un lot appartient à une mise en vente : republier le véhicule lui donne un nouveau
    // numéro, le réaffecter à la même session conserve le sien.
    vehicle.lotNumber = await nextLotNumber();
  }

  await vehicle.save();

  if (isNewListing) {
    const { vehicleListingAttempts } = await generalConfigService.getConfig();
    const threshold = Number(vehicleListingAttempts) || 3;
    if (vehicle.listingCount === threshold) {
      await notifyAdminOfMaxAttempts(vehicle, vehicle.listingCount);
    }
  }

  return vehicle;
};

/**
 * Clôturer une session immédiatement, sans attendre la fin de sa fenêtre.
 *
 * La fin anticipée doit produire EXACTEMENT ce que produit une fin par le temps : la date
 * de fin est ramenée à maintenant, puis l'attribution est jouée par le même
 * `processSessionAttributions` que la boucle de fond. Réécrire l'attribution ici ferait
 * diverger les deux chemins au premier changement de règle.
 *
 * `saleService` est chargé à l'appel : les deux services se référencent mutuellement, un
 * require en tête de fichier créerait un cycle.
 */
const closeSessionNow = async (sessionId) => {
  const session = await Session.findById(sessionId);
  if (!session) {
    const error = new Error('Session introuvable.');
    error.statusCode = 404;
    error.codeName = 'session.not_found';
    throw error;
  }
  if (session.attributionsProcessedAt) {
    const error = new Error('Cette session a déjà été clôturée et ses gagnants désignés.');
    error.statusCode = 409;
    error.codeName = 'session.already_closed';
    throw error;
  }

  const now = new Date();
  // Sans ce recalage, la synchronisation périodique rouvrirait la session : c'est la
  // fenêtre de dates qui fait foi pour le statut, pas le champ `status`.
  session.endDate = now;
  if (session.startDate > now) session.startDate = now;
  session.status = 'closed';
  await session.save();

  const saleService = require('./sale.service');
  const results = await saleService.processSessionAttributions(session);
  session.attributionsProcessedAt = new Date();
  await session.save();

  return {
    session,
    total: results.length,
    winners: results.filter((sale) => sale.status === 'en_cours').length,
    withoutWinner: results.filter((sale) => sale.status === 'sans_gagnant').length,
  };
};

/**
 * Créer une session manuellement
 */
const createManualSession = async ({ name, startDate, durationHours, commission }) => {
  const start = new Date(startDate);
  const duration = Number(durationHours) || 48;
  const end = new Date(start.getTime() + duration * 3600 * 1000);
  const now = new Date();

  let status = 'upcoming';
  if (now > end) status = 'closed';
  else if (now >= start && now <= end) status = 'open';

  const totalCount = await Session.countDocuments();
  const sessionName = name && name.trim() ? name.trim() : `Session #${totalCount + 1}`;

  const newSession = new Session({
    name: sessionName,
    startDate: start,
    endDate: end,
    date: start,
    durationHours: duration,
    isManual: true,
    status,
    // Configuration par défaut sauf si l'admin l'a personnalisée dans le formulaire de création
    commission: commissionService.parseSessionCommission(commission),
  });

  await newSession.save();
  return newSession;
};

/**
 * Mettre à jour les informations éditables d'une session (nom, configuration de commission)
 */
const updateSession = async (id, { name, commission }) => {
  const session = await Session.findById(id);
  if (!session) {
    const err = new Error('Session introuvable.');
    err.codeName = 'session.not_found';
    err.statusCode = 404;
    throw err;
  }

  if (name !== undefined) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      const err = new Error('Le nom de la session est requis.');
      err.codeName = 'session.validation_error';
      throw err;
    }
    session.name = trimmed;
  }

  if (commission !== undefined) {
    session.commission = commissionService.parseSessionCommission(commission);
  }

  await session.save();
  return session;
};

/**
 * Compléter une ou plusieurs sessions avec les tranches de commission réellement applicables :
 * les siennes si elle est personnalisée, sinon celles de la configuration globale.
 * Les tranches par défaut ne sont chargées qu'une fois pour toute la liste.
 */
const withResolvedCommission = async (sessions) => {
  const defaultTiers = await commissionService.getTiers();
  const list = Array.isArray(sessions) ? sessions : [sessions];

  const resolved = list.map((session) => {
    const plain = typeof session.toObject === 'function' ? session.toObject() : session;
    const commission = plain.commission || { useDefault: true, tiers: [] };
    return {
      ...plain,
      commission: {
        useDefault: commission.useDefault !== false,
        tiers: commissionService.resolveTiers(commission, defaultTiers),
      },
    };
  });

  return Array.isArray(sessions) ? resolved : resolved[0];
};

module.exports = {
  getConfig,
  updateConfig,
  syncSessionStatuses,
  autoGenerateAndSyncSessions,
  assignVehicleToSession,
  closeSessionNow,
  createManualSession,
  updateSession,
  withResolvedCommission,
};
