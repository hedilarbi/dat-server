/**
 * Ventes critiques : étape 1 ou 2 entre 80 % et 100 % du délai courant. Une échéance expirée est
 * traitée par la réattribution et ne doit plus apparaître ici ; le candidat suivant repart avec son
 * propre chronomètre à zéro. Définition unique, partagée par le tableau de bord (compteur) et la
 * liste des ventes (filtre « critiques »).
 */
const CRITICAL_THRESHOLD_PERCENT = 80;

const isCriticalSale = (sale, now = new Date()) => {
  if (!sale.currentStepDueAt) return false;
  const dueAt = new Date(sale.currentStepDueAt);
  const startedAt = sale.currentStepStartedAt
    ? new Date(sale.currentStepStartedAt)
    : sale.wonAt
      ? new Date(sale.wonAt)
      : sale.createdAt
        ? new Date(sale.createdAt)
        : null;

  if (now >= dueAt) return false;
  if (!startedAt) return false;

  const total = dueAt.getTime() - startedAt.getTime();
  if (total <= 0) return true;

  return ((now.getTime() - startedAt.getTime()) / total) * 100 >= CRITICAL_THRESHOLD_PERCENT;
};

/** Ventes critiques (documents lean) ; `populate` permet d'enrichir les lignes du tableau de bord. */
const findCriticalSales = async (Sale, { populate = false } = {}) => {
  let query = Sale.find({ status: 'en_cours', currentStep: { $in: [1, 2] } });
  if (populate) {
    query = query
      .populate('vehicle', 'brand model year')
      .populate('winner', 'firstName lastName companyName');
  }
  const sales = await query.lean();
  const now = new Date();
  return sales.filter((sale) => isCriticalSale(sale, now));
};

module.exports = { findCriticalSales, isCriticalSale };
