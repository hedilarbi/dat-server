const Stripe = require('stripe');

const secretKey = process.env.STRIPE_PRIVATE_KEY || process.env.STRIPE_SECRET_KEY;

let client = null;

/**
 * Client Stripe, initialisé à la première utilisation.
 * Une clé absente lève une erreur explicite plutôt que de laisser un paiement
 * passer sans jamais avoir été encaissé.
 */
const getStripe = () => {
  if (!secretKey) {
    const error = new Error("Le paiement en ligne n'est pas configuré (STRIPE_PRIVATE_KEY absente).");
    error.codeName = 'payment.not_configured';
    error.statusCode = 503;
    throw error;
  }
  if (!client) {
    client = new Stripe(secretKey);
  }
  return client;
};

const isStripeConfigured = () => Boolean(secretKey);

module.exports = { getStripe, isStripeConfigured };
