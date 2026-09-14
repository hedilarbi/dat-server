const mongoose = require('mongoose');

// Motifs de refus d'un certificat signé, proposés au vendeur à l'étape de validation.
const CERTIFICATE_REJECTION_REASONS = [
  'tampon_manquant',
  'mauvais_tampon',
  'document_illisible',
  'signature_manquante',
  'document_incomplet',
  'mauvais_document',
  'autre',
];

// Étapes de la procédure d'achat suivie par le gagnant, dans l'ordre.
const PURCHASE_STEPS = [
  'commission',             // 1. Paiement de la commission par l'acheteur
  'virement_carte_grise',   // 2. Virement confirmé et dernière information carte grise
  'signature_electronique', // 3. Signature électronique du dossier par les deux parties
  'tampon_vendeur',         // 4. Tampon automatique ou dépôt manuel du vendeur
  'validation_acheteur',    // 5. Validation des documents vendeur par l'acheteur
  'tampon_acheteur',        // 6. Tampon automatique ou dépôt manuel de l'acheteur
  'validation_vendeur',     // 7. Validation finale des documents par le vendeur
  'enlevement',             // 8. Bon d'enlèvement, remise et clôture
];

/**
 * Un candidat de la liste d'attente : l'offre reste éligible tant que le gagnant courant
 * n'a pas terminé sa procédure. Si celui-ci est écarté (délai dépassé), le rang suivant prend
 * sa place et reçoit exactement la même procédure.
 */
const waitingListEntrySchema = new mongoose.Schema({
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  offer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', required: true },
  amount: { type: Number, required: true },
  // Moment retenu pour départager deux offres de même montant
  offeredAt: { type: Date, required: true },
  rank: { type: Number, required: true, min: 1 },
  status: {
    type: String,
    enum: ['gagnant', 'en_attente', 'ecarte'],
    default: 'en_attente'
  },
  discardedAt: { type: Date },
  discardReason: { type: String, trim: true }
}, { _id: false });

/**
 * Résultat de la mise en vente d'un véhicule à la clôture d'une session : le gagnant
 * désigné, la liste d'attente ordonnée, et l'avancement de la procédure d'achat.
 */
const saleSchema = new mongoose.Schema({
  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'VehicleDossier',
    required: true
  },
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Prix de réserve au moment de la clôture : seules les offres l'atteignant sont éligibles
  reservePrice: { type: Number, default: 0 },

  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  winningOffer: { type: mongoose.Schema.Types.ObjectId, ref: 'Offer', default: null },
  amount: { type: Number, default: null },
  // Rang courant dans la liste d'attente (0 quand plus personne n'est éligible)
  currentRank: { type: Number, default: 0 },
  waitingList: { type: [waitingListEntrySchema], default: [] },

  status: {
    type: String,
    enum: ['en_cours', 'cloturee', 'sans_gagnant', 'annulee'],
    default: 'en_cours'
  },
  // Position dans PURCHASE_STEPS (1 = paiement de la commission)
  currentStep: { type: Number, default: 1, min: 1, max: PURCHASE_STEPS.length },
  currentStepStartedAt: { type: Date, default: null },
  // Échéance de l'étape en cours, calculée d'après les délais de la configuration générale.
  // Dépassée, elle écarte le gagnant au profit du candidat suivant de la liste d'attente.
  currentStepDueAt: { type: Date, default: null },
  // Seuils de rappel déjà envoyés pour l'étape en cours (en % du délai écoulé),
  // remis à zéro à chaque changement d'étape pour ne jamais relancer deux fois.
  stepRemindersSent: { type: [Number], default: [] },
  
  // Pause du chronomètre par l'admin
  timerPaused: { type: Boolean, default: false },
  timerPausedAt: { type: Date, default: null },

  // Étape 1 : paiement de la commission et mode de remise des papiers du véhicule
  commissionPaidAt: { type: Date, default: null },
  documentsDelivery: {
    type: String,
    enum: ['main_propre', 'poste'],
    default: null
  },
  // Trace du paiement en ligne de la commission. `amount` est en centimes, comme chez Stripe.
  commissionPayment: {
    provider: { type: String, default: 'stripe' },
    // 'checkout' pour le web (session hébergée), 'payment_intent' pour la PaymentSheet mobile
    mode: { type: String, enum: ['checkout', 'payment_intent'], default: null },
    checkoutSessionId: { type: String, default: null },
    paymentIntentId: { type: String, default: null },
    status: {
      type: String,
      enum: ['en_attente', 'paye', 'echoue'],
      default: null
    },
    amount: { type: Number, default: null },
    currency: { type: String, default: 'eur' },
    initiatedAt: { type: Date, default: null }
  },

  // Étape 2 : le virement est fait hors plateforme, le vendeur en confirme la réception
  transferConfirmedAt: { type: Date, default: null },

  // Documents et versions tamponnées utilisés entre les étapes 3 et 7.
  certificate: {
    url: { type: String, default: null },
    filename: { type: String, default: null },
    generatedAt: { type: Date, default: null },
    // Étape 3 : le vendeur télécharge, signe et redépose le certificat (si pas de tampon auto)
    sellerSignedUrl: { type: String, default: null },
    sellerSignedFilename: { type: String, default: null },
    sellerSignedAt: { type: Date, default: null },
    // Étape 4 : l'acheteur valide que le document du vendeur est correct
    buyerValidatedAt: { type: Date, default: null },
    // Étape 5 : l'acheteur télécharge (le doc du vendeur), signe et redépose le certificat (si pas de tampon auto)
    signedUrl: { type: String, default: null },
    signedFilename: { type: String, default: null },
    signedAt: { type: Date, default: null },
    // Étape 6 : le vendeur atteste que le document déposé est bien signé et tamponné
    validatedAt: { type: Date, default: null },
    // Historique des refus : le document écarté est conservé pour la traçabilité.
    rejections: [{
      url: { type: String },
      rejectedBy: { type: String, enum: ['buyer', 'seller'], required: true },
      reason: { type: String, enum: CERTIFICATE_REJECTION_REASONS, required: true },
      comment: { type: String, trim: true },
      createdAt: { type: Date, default: Date.now }
    }],
    rejectionCount: { type: Number, default: 0 },
    lastRejection: {
      url: { type: String },
      rejectedBy: { type: String, enum: ['buyer', 'seller'] },
      reason: { type: String, enum: CERTIFICATE_REJECTION_REASONS },
      comment: { type: String, trim: true },
      createdAt: { type: Date }
    }
  },

  // Déclaration d'achat Cerfa 13751*02, générée avec le certificat dès l'étape 3.
  purchaseDeclaration: {
    url: { type: String, default: null },
    filename: { type: String, default: null },
    generatedAt: { type: Date, default: null }
  },

  // Documents disponibles lors de l'étape 8 (enlèvement).
  handover: {
    declarationUrl: { type: String, default: null },
    declarationFilename: { type: String, default: null },
    generatedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null }
  },

  // Document Bon d'enlèvement
  bonEnlevement: {
    url: { type: String, default: null },
    filename: { type: String, default: null },
    generatedAt: { type: Date, default: null }
  },

  // Intégration Signature Électronique (OpenAPI)
  esignature: {
    operationId: { type: String, default: null },
    status: { type: String, default: null }, // ex: WAIT_VALIDATION, SIGNED, ERROR
    sellerUrl: { type: String, default: null },
    buyerUrl: { type: String, default: null },
    initiatedAt: { type: Date, default: null },
    signedDocumentUrl: { type: String, default: null },
    signedDocumentFilename: { type: String, default: null },
    sellerStampedUrl: { type: String, default: null },
    sellerStampedFilename: { type: String, default: null },
    buyerStampedUrl: { type: String, default: null },
    buyerStampedFilename: { type: String, default: null },
    auditUrl: { type: String, default: null },
    auditFilename: { type: String, default: null },
    completedAt: { type: Date, default: null }
  },

  wonAt: { type: Date },
  closedAt: { type: Date }
}, {
  timestamps: true
});

// Un véhicule ne peut donner lieu qu'à une seule vente par session : garantit
// l'idempotence du traitement d'attribution, même s'il est rejoué.
saleSchema.index({ vehicle: 1, session: 1 }, { unique: true });
saleSchema.index({ winner: 1, createdAt: -1 });

const Sale = mongoose.model('Sale', saleSchema);

module.exports = Sale;
module.exports.PURCHASE_STEPS = PURCHASE_STEPS;
module.exports.CERTIFICATE_REJECTION_REASONS = CERTIFICATE_REJECTION_REASONS;
