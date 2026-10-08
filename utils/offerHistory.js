/**
 * Historique des offres d'un acheteur sur un véhicule, pour une session — réservé à
 * l'administration (les acheteurs et vendeurs ne voient jamais les versions successives).
 *
 * Une offre modifiée garde ses montants précédents dans `revisions`. Chaque version a une date :
 *   - la première, celle du dépôt (`createdAt`) ;
 *   - les suivantes, celle de la modification qui les a posées. Les offres modifiées avant que
 *     cette date soit enregistrée (`proposedAt`) la retrouvent à partir de `replacedAt` de la
 *     version qui précède : une version remplace l'autre à l'instant où elle commence.
 * L'annulation est un événement à part, avec le dernier montant proposé.
 */

const versionsOf = (offer) => {
  const revisions = offer.revisions || [];
  const versions = revisions.map((revision, index) => ({
    amount: revision.amount,
    at: revision.proposedAt || (index === 0 ? offer.createdAt : revisions[index - 1].replacedAt),
  }));
  const currentAt = offer.amountUpdatedAt
    || (revisions.length > 0 ? revisions[revisions.length - 1].replacedAt : offer.createdAt);
  versions.push({ amount: offer.amount, at: currentAt });
  return versions;
};

/** Événements (dépôt, modification, annulation) d'une ou plusieurs offres du même acheteur. */
const buildBuyerOfferHistory = (offers) => {
  const events = [];
  for (const offer of offers) {
    versionsOf(offer).forEach((version, index) => {
      events.push({ type: index === 0 ? 'depot' : 'modification', amount: version.amount, at: version.at });
    });
    if (offer.status === 'annulee' && offer.cancelledAt) {
      events.push({ type: 'annulation', amount: offer.amount, at: offer.cancelledAt });
    }
  }
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
};

module.exports = { buildBuyerOfferHistory };
