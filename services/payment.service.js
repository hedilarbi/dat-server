const { getStripe } = require('../config/stripe');

// Même repli que les e-mails (emailTemplates.service.js) : l'URL de retour de Stripe et
// les liens envoyés par courriel doivent toujours désigner le même site.
const CLIENT_BASE_URL = process.env.CLIENT_BASE_URL || 'https://dealautopro.com';

// Slug de la page de détail d'une vente gagnée, par langue
const WON_SALE_PATH = { fr: '/fr/acheteur/tableau-de-bord/mes-vehicules', en: '/en/acheteur/tableau-de-bord/mes-vehicules' };

const paymentError = (message, codeName, statusCode) => {
  const err = new Error(message);
  err.codeName = codeName;
  if (statusCode) err.statusCode = statusCode;
  return err;
};

/** Convertit un montant en euros vers l'unité attendue par Stripe (centimes). */
const toMinorUnits = (amount) => Math.round(Number(amount) * 100);

/**
 * Ouvrir une session de paiement Stripe pour la commission d'une vente.
 * Le montant est calculé côté serveur à partir des frais figés sur l'offre gagnante :
 * le navigateur ne transmet jamais de montant.
 */
const createCommissionCheckout = async ({ sale, buyer, vehicleLabel, language }) => {
  const fees = sale.fees || sale.winningOffer?.fees;
  if (!fees) {
    throw paymentError("Les frais de cette vente sont introuvables.", 'payment.fees_missing');
  }

  const amount = toMinorUnits(fees.commission + fees.taxAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw paymentError('Le montant de la commission est invalide.', 'payment.invalid_amount');
  }

  const lang = WON_SALE_PATH[language] ? language : 'fr';
  const returnUrl = `${CLIENT_BASE_URL}${WON_SALE_PATH[lang]}/${sale._id}?session_id={CHECKOUT_SESSION_ID}`;

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    // « embedded » a été renommé « embedded_page » dans les versions récentes de l'API Stripe
    ui_mode: 'embedded_page',
    return_url: returnUrl,
    customer_email: buyer.email,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: amount,
        product_data: {
          name: lang === 'fr' ? `Commission plateforme — ${vehicleLabel}` : `Platform commission — ${vehicleLabel}`,
          description: lang === 'fr'
            ? `Commission ${fees.commission} € + ${fees.taxName} ${fees.taxAmount} €`
            : `Commission €${fees.commission} + ${fees.taxName} €${fees.taxAmount}`,
        },
      },
    }],
    // Rattache la session à la vente : la confirmation vérifie cette correspondance
    metadata: {
      saleId: String(sale._id),
      buyerId: String(buyer._id),
      purpose: 'commission',
    },
  });

  return { session, amount };
};

/**
 * Relire une session auprès de Stripe et n'en retenir que ce qui est vérifiable côté serveur.
 * Le navigateur ne fait que transmettre un identifiant : rien de ce qu'il annonce n'est cru.
 */
const retrieveCommissionCheckout = async (checkoutSessionId) => {
  const session = await getStripe().checkout.sessions.retrieve(checkoutSessionId);

  return {
    id: session.id,
    paid: session.payment_status === 'paid',
    paymentStatus: session.payment_status,
    saleId: session.metadata?.saleId || null,
    buyerId: session.metadata?.buyerId || null,
    userId: session.metadata?.userId || null,
    purpose: session.metadata?.purpose || null,
    amount: session.amount_total ?? null,
    currency: session.currency || 'eur',
    paymentIntentId: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || null,
  };
};

/**
 * Ouvrir un paiement de commission pour l'application mobile.
 * La PaymentSheet de Stripe consomme un PaymentIntent, là où le web utilise une session
 * Checkout : même montant calculé côté serveur, mêmes métadonnées de rattachement.
 */
const createCommissionPaymentIntent = async ({ sale, buyer, vehicleLabel }) => {
  const fees = sale.fees || sale.winningOffer?.fees;
  if (!fees) {
    throw paymentError('Les frais de cette vente sont introuvables.', 'payment.fees_missing');
  }

  const amount = toMinorUnits(fees.commission + fees.taxAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw paymentError('Le montant de la commission est invalide.', 'payment.invalid_amount');
  }

  const intent = await getStripe().paymentIntents.create({
    amount,
    currency: 'eur',
    description: `Commission plateforme — ${vehicleLabel}`,
    receipt_email: buyer.email || undefined,
    automatic_payment_methods: { enabled: true },
    metadata: {
      saleId: String(sale._id),
      buyerId: String(buyer._id),
      purpose: 'commission',
    },
  });

  return { intent, amount };
};

/**
 * Relire un PaymentIntent auprès de Stripe. Comme pour Checkout, rien de ce que
 * l'application annonce n'est cru : seul l'état renvoyé par Stripe fait foi.
 */
const retrieveCommissionPaymentIntent = async (paymentIntentId) => {
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);

  return {
    id: intent.id,
    paid: intent.status === 'succeeded',
    paymentStatus: intent.status,
    saleId: intent.metadata?.saleId || null,
    buyerId: intent.metadata?.buyerId || null,
    purpose: intent.metadata?.purpose || null,
    amount: intent.amount_received ?? intent.amount ?? null,
    currency: intent.currency || 'eur',
    paymentIntentId: intent.id,
  };
};

const createPendingCommissionCheckout = async ({ amount, reason, user, language }) => {
  const lang = ['fr', 'en'].includes(language) ? language : 'fr';
  const returnUrl = `${CLIENT_BASE_URL}/${lang}/${user.role}/tableau-de-bord/profil?session_id={CHECKOUT_SESSION_ID}&action=pending_commission`;

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    ui_mode: 'embedded_page',
    return_url: returnUrl,
    customer_email: user.email,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: toMinorUnits(amount),
        product_data: {
          name: reason === 'penalite_etape_2'
            ? (lang === 'fr' ? 'Pénalité de réactivation DealAutoPro' : 'DealAutoPro reactivation penalty')
            : (lang === 'fr' ? 'Commission DealAutoPro impayée' : 'Unpaid DealAutoPro commission'),
        },
      },
    }],
    metadata: {
      userId: String(user._id),
      purpose: 'pending_commission',
      debtReason: reason || 'commission_impayee',
      saleId: user.pendingCommission?.saleId ? String(user.pendingCommission.saleId) : '',
    },
  });

  return { session, amount: toMinorUnits(amount) };
};

const createPendingCommissionPaymentIntent = async ({ amount, reason, user }) => {
  const intent = await getStripe().paymentIntents.create({
    amount: toMinorUnits(amount),
    currency: 'eur',
    receipt_email: user.email,
    description: reason === 'penalite_etape_2' ? 'Pénalité de réactivation DealAutoPro' : 'Commission DealAutoPro impayée',
    metadata: {
      userId: String(user._id),
      purpose: 'pending_commission',
      debtReason: reason || 'commission_impayee',
      saleId: user.pendingCommission?.saleId ? String(user.pendingCommission.saleId) : '',
    },
  });

  return { clientSecret: intent.client_secret, paymentIntentId: intent.id, amount: toMinorUnits(amount) };
};

const retrievePendingCommissionPaymentIntent = async (paymentIntentId) => {
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
  return {
    id: intent.id,
    paid: intent.status === 'succeeded',
    userId: intent.metadata?.userId || null,
    purpose: intent.metadata?.purpose || null,
    debtReason: intent.metadata?.debtReason || null,
    saleId: intent.metadata?.saleId || null,
    amount: intent.amount_received ?? intent.amount ?? null,
    currency: intent.currency || null,
  };
};

// Rattrape les paiements mobiles effectués avant que l'application confirme l'intent.
// La recherche est réservée à cette récupération historique, jamais au retour immédiat
// de PaymentSheet (l'index de recherche Stripe est éventuellement cohérent).
const findPaidPendingCommissionIntents = async (userId, amount, reason, saleId, createdAfter) => {
  const result = await getStripe().paymentIntents.search({
    query: `metadata['userId']:'${String(userId)}' AND metadata['purpose']:'pending_commission'`,
    limit: 100,
  });
  return result.data.filter((intent) =>
    intent.status === 'succeeded'
    && intent.metadata?.debtReason === reason
    && (!intent.metadata?.saleId || intent.metadata.saleId === String(saleId))
    && (!createdAfter || intent.created * 1000 >= createdAfter.getTime())
    && intent.currency === 'eur'
    && (intent.amount_received ?? intent.amount) === toMinorUnits(amount)
  ).map((intent) => intent.id);
};

module.exports = {
  paymentError,
  createCommissionCheckout,
  retrieveCommissionCheckout,
  createCommissionPaymentIntent,
  retrieveCommissionPaymentIntent,
  createPendingCommissionCheckout,
  createPendingCommissionPaymentIntent,
  retrievePendingCommissionPaymentIntent,
  findPaidPendingCommissionIntents,
  toMinorUnits,
};
