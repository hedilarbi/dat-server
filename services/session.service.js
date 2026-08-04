const Session = require('../models/session.model');
const SessionConfig = require('../models/sessionConfig.model');
const VehicleDossier = require('../models/vehicleDossier.model');

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
      autoAssignVehicles: true,
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
  if (payload.autoAssignVehicles !== undefined) config.autoAssignVehicles = Boolean(payload.autoAssignVehicles);

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
 * Génère automatiquement les sessions hebdomadaires récurrentes et affecte les véhicules validés
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
        });

        await newSession.save();
      }
    }
  }

  // Affectation automatique des véhicules validés sans session aux prochaines sessions à venir
  if (config.autoAssignVehicles) {
    const unassignedVehicles = await VehicleDossier.find({ status: 'valide', session: null }).sort({ updatedAt: 1 });
    if (unassignedVehicles.length > 0) {
      const nextSession = await Session.findOne({ status: { $in: ['open', 'upcoming'] } }).sort({ startDate: 1 });
      if (nextSession) {
        for (const vehicle of unassignedVehicles) {
          vehicle.session = nextSession._id.toString();
          await vehicle.save();
        }
      }
    }
  }
};

/**
 * Créer une session manuellement
 */
const createManualSession = async ({ name, startDate, durationHours }) => {
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
  });

  await newSession.save();
  return newSession;
};

module.exports = {
  getConfig,
  updateConfig,
  syncSessionStatuses,
  autoGenerateAndSyncSessions,
  createManualSession,
};
