const CommissionTier = require('../models/commissionTier.model');

const validationError = (message) => {
  const err = new Error(message);
  err.codeName = 'commission.validation_error';
  return err;
};

const formatAmount = (amount) => `${amount.toLocaleString('fr-FR')} €`;

const describeRange = ({ minAmount, maxAmount }) => (
  maxAmount === null || maxAmount === undefined
    ? `à partir de ${formatAmount(minAmount)}`
    : `de ${formatAmount(minAmount)} à ${formatAmount(maxAmount)}`
);

/**
 * Normaliser et valider les données d'une tranche envoyées par l'admin.
 */
const parseTierPayload = ({ minAmount, maxAmount, type, value, label, active }) => {
  const min = Number(minAmount);
  if (!Number.isFinite(min) || min < 0) {
    throw validationError('Le montant minimum doit être un nombre positif.');
  }

  const hasMax = maxAmount !== null && maxAmount !== undefined && maxAmount !== '';
  const max = hasMax ? Number(maxAmount) : null;
  if (hasMax && (!Number.isFinite(max) || max < 0)) {
    throw validationError('Le montant maximum doit être un nombre positif ou vide (tranche non bornée).');
  }
  if (max !== null && max < min) {
    throw validationError('Le montant maximum doit être supérieur ou égal au montant minimum.');
  }

  if (!['percentage', 'fixed'].includes(type)) {
    throw validationError('Le type de commission doit être « percentage » ou « fixed ».');
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw validationError('La valeur de la commission doit être un nombre positif.');
  }
  if (type === 'percentage' && numericValue > 100) {
    throw validationError('Un pourcentage de commission ne peut pas dépasser 100 %.');
  }

  return {
    minAmount: min,
    maxAmount: max,
    type,
    value: numericValue,
    label: typeof label === 'string' ? label.trim() : '',
    active: active === undefined ? true : Boolean(active)
  };
};

const upperBound = (tier) => (tier.maxAmount === null || tier.maxAmount === undefined ? Infinity : tier.maxAmount);

/**
 * Retourner la première tranche de `others` qui recouvre `tier`, s'il y en a une.
 * Deux tranches actives qui se chevauchent rendraient la commission ambiguë.
 */
const findOverlap = (tier, others) => others.find((other) => (
  tier.minAmount <= upperBound(other) && other.minAmount <= upperBound(tier)
));

const assertNoOverlap = (tier, others) => {
  if (!tier.active) return;
  const conflict = findOverlap(tier, others.filter((other) => other.active));
  if (conflict) {
    throw validationError(`Cette tranche chevauche une tranche existante (${describeRange(conflict)}).`);
  }
};

/**
 * Valider une liste complète de tranches (cas d'une configuration propre à une session,
 * enregistrée d'un bloc) : chaque tranche est normalisée et ne doit recouvrir aucune autre.
 */
const normalizeTierList = (tiers) => {
  if (!Array.isArray(tiers)) {
    throw validationError('La liste des tranches de commission est invalide.');
  }

  const normalized = [];
  for (const tier of tiers) {
    const parsed = parseTierPayload(tier);
    assertNoOverlap(parsed, normalized);
    normalized.push(parsed);
  }
  return normalized.sort((a, b) => a.minAmount - b.minAmount);
};

/**
 * Normaliser la configuration de commission attachée à une session.
 * useDefault = true : la session suit la configuration globale, aucune tranche n'est stockée.
 */
const parseSessionCommission = (commission) => {
  if (!commission || commission.useDefault !== false) {
    return { useDefault: true, tiers: [] };
  }

  const tiers = normalizeTierList(commission.tiers || []);
  if (tiers.length === 0) {
    throw validationError('Une configuration de commission personnalisée doit contenir au moins une tranche.');
  }
  return { useDefault: false, tiers };
};

/**
 * Lister les tranches par défaut de la plateforme, de la plus basse à la plus haute.
 */
const getTiers = async () => CommissionTier.find().sort({ minAmount: 1 });

const createTier = async (payload) => {
  const tier = parseTierPayload(payload);
  assertNoOverlap(tier, await CommissionTier.find({ active: true }));
  return CommissionTier.create(tier);
};

const updateTier = async (id, payload) => {
  const existing = await CommissionTier.findById(id);
  if (!existing) {
    const err = new Error('Tranche de commission introuvable.');
    err.codeName = 'commission.not_found';
    err.statusCode = 404;
    throw err;
  }

  // Mise à jour partielle : on repart des valeurs existantes pour les champs non fournis
  // (le toggle « activer/désactiver » n'envoie par exemple que `active`).
  const merged = parseTierPayload({
    minAmount: payload.minAmount === undefined ? existing.minAmount : payload.minAmount,
    maxAmount: payload.maxAmount === undefined ? existing.maxAmount : payload.maxAmount,
    type: payload.type === undefined ? existing.type : payload.type,
    value: payload.value === undefined ? existing.value : payload.value,
    label: payload.label === undefined ? existing.label : payload.label,
    active: payload.active === undefined ? existing.active : payload.active
  });

  assertNoOverlap(merged, await CommissionTier.find({ active: true, _id: { $ne: existing._id } }));

  Object.assign(existing, merged);
  await existing.save();
  return existing;
};

const deleteTier = async (id) => {
  const tier = await CommissionTier.findByIdAndDelete(id);
  if (!tier) {
    const err = new Error('Tranche de commission introuvable.');
    err.codeName = 'commission.not_found';
    err.statusCode = 404;
    throw err;
  }
  return { message: 'Tranche de commission supprimée.' };
};

/**
 * Tranches réellement applicables à une session : les siennes si elle est personnalisée,
 * sinon celles de la configuration globale (passées en second argument pour éviter
 * de les recharger à chaque session d'une liste).
 */
const resolveTiers = (commission, defaultTiers) => (
  commission && commission.useDefault === false ? (commission.tiers || []) : defaultTiers
);

/**
 * Calculer la commission applicable à un montant selon une liste de tranches.
 * Si aucune tranche active ne couvre le montant, la commission est nulle.
 */
const calculateFromTiers = (tiers, amount) => {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    throw validationError('Le montant à simuler doit être un nombre positif.');
  }

  const tier = (tiers || [])
    .filter((item) => item.active && item.minAmount <= numericAmount && upperBound(item) >= numericAmount)
    .sort((a, b) => b.minAmount - a.minAmount)[0] || null;

  if (!tier) {
    return { amount: numericAmount, tier: null, commission: 0 };
  }

  const commission = tier.type === 'percentage'
    ? (numericAmount * tier.value) / 100
    : tier.value;

  return {
    amount: numericAmount,
    tier,
    commission: Math.round(commission * 100) / 100
  };
};

/**
 * Calculer la commission plateforme applicable à un montant avec la configuration par défaut.
 */
const calculateCommission = async (amount) => calculateFromTiers(await getTiers(), amount);

/**
 * Calculer la commission applicable à un montant dans le cadre d'une session donnée.
 */
const calculateSessionCommission = async (session, amount) => {
  const commission = session && session.commission;
  const tiers = commission && commission.useDefault === false ? commission.tiers : await getTiers();
  return calculateFromTiers(tiers, amount);
};

module.exports = {
  getTiers,
  createTier,
  updateTier,
  deleteTier,
  normalizeTierList,
  parseSessionCommission,
  resolveTiers,
  calculateFromTiers,
  calculateCommission,
  calculateSessionCommission
};
