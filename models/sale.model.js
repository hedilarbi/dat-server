const mongoose = require('mongoose');

// Motifs proposés à une partie qui signale une erreur sur les documents tamponnés (étape 3.2).
const DOCUMENT_REPORT_REASONS = [
  'tampon_manquant',
  'mauvais_tampon',
  'informations_erronees',
  'document_illisible',
  'document_incomplet',
  'autre',
];

// Étapes de la procédure d'achat suivie par le gagnant, dans l'ordre. Les étapes 3 à 5 forment
// l'étape « Documents administratifs » présentée aux utilisateurs en 3.1, 3.2 et 3.3.
// La vente est clôturée dès que les deux parties ont signé (étape 3.3).
const PURCHASE_STEPS = [
  'commission',             // 1. Paiement de la commission par l'acheteur
  // Clé historique conservée : les motifs de retrait déjà enregistrés
  // (virement_carte_grise_delai_depasse) et le calcul des pénalités en dépendent.
  'virement_carte_grise',   // 2. Virement du prix, confirmé par le vendeur
  'preparation_documents',  // 3.1 Données de la carte grise (vendeur) et tampons des deux parties
  'verification_documents', // 3.2 Vérification des documents tamponnés par les deux parties
  'signature_electronique', // 3.3 Signature électronique par les deux parties
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
  discardReason: { type: String, trim: true },
  topThreeEmailSentAt: { type: Date, default: null },
  promotionEmailSentAt: { type: Date, default: null },
  sellerPromotionEmailSentAt: { type: Date, default: null }
}, { _id: false });

// Un des deux documents administratifs. `source` indique qui l'a produit : la plateforme
// (généré et tamponné automatiquement) ou une partie qui l'a redéposé après un signalement.
const saleDocumentSchema = new mongoose.Schema({
  url: { type: String, default: null },
  filename: { type: String, default: null },
  source: { type: String, enum: ['generated', 'seller', 'buyer'], default: 'generated' },
  generatedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: null }
}, { _id: false });

// Avis d'une partie sur la version courante des documents
const reviewDecisionSchema = new mongoose.Schema({
  decision: { type: String, enum: ['valide', 'erreur'], default: null },
  reason: { type: String, enum: DOCUMENT_REPORT_REASONS, default: null },
  comment: { type: String, trim: true, default: null },
  decidedAt: { type: Date, default: null }
}, { _id: false });

// Trace de la vérification : avis donnés et documents redéposés, pour l'administration
const reviewEventSchema = new mongoose.Schema({
  type: { type: String, enum: ['valide', 'erreur', 'depot'], required: true },
  by: { type: String, enum: ['seller', 'buyer'], required: true },
  document: { type: String, enum: ['certificate', 'purchaseDeclaration'], default: null },
  reason: { type: String, enum: DOCUMENT_REPORT_REASONS, default: null },
  comment: { type: String, trim: true, default: null },
  url: { type: String, default: null },
  version: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
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
    enum: ['en_cours', 'suspendue', 'cloturee', 'sans_gagnant', 'annulee'],
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
  // Échéance laissée au vendeur quand une vente est suspendue avec des offres sous le prix
  // de réserve. Après cette date, le véhicule est remis en attente de session.
  sellerDecisionDueAt: { type: Date, default: null },
  
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

  // Étape 3.1 : le vendeur a saisi les données complémentaires de la carte grise
  registrationCardSubmittedAt: { type: Date, default: null },

  // Version courante des deux documents, remplis et tamponnés par les deux parties (étape 3.2),
  // puis envoyés ensemble à la signature (étape 3.3). Un dépôt après un signalement remplace
  // le document généré.
  certificate: saleDocumentSchema,
  purchaseDeclaration: saleDocumentSchema,

  // Étape 3.2 : chaque partie valide les documents ou signale une erreur.
  documentsReview: {
    // Incrémentée à chaque nouvelle version d'un document : les avis précédents ne valent plus.
    version: { type: Number, default: 0 },
    // Ouverte au premier signalement : chaque partie peut alors redéposer chaque document,
    // jusqu'à ce que les deux valident une même version.
    correctionOpen: { type: Boolean, default: false },
    seller: reviewDecisionSchema,
    buyer: reviewDecisionSchema,
    history: { type: [reviewEventSchema], default: [] }
  },

  // Bon d'enlèvement, généré à la clôture de la vente
  bonEnlevement: {
    url: { type: String, default: null },
    filename: { type: String, default: null },
    generatedAt: { type: Date, default: null }
  },

  // Étape 3.3 : signature électronique (OpenAPI) du dossier regroupant les deux documents
  esignature: {
    operationId: { type: String, default: null },
    status: { type: String, default: null }, // ex: WAIT_VALIDATION, WAIT_SIGNER, DONE, ERROR
    sellerUrl: { type: String, default: null },
    buyerUrl: { type: String, default: null },
    // Posé juste avant l'appel à OpenAPI : empêche deux créations simultanées de la session
    initiatedAt: { type: Date, default: null },
    // Posé au début de la finalisation : le webhook et la tâche de fond ne la mènent qu'une fois
    finalizingAt: { type: Date, default: null },
    // Nombre de pages du certificat en tête du dossier : la déclaration commence juste après
    certificatePageCount: { type: Number, default: null },
    // Avancement par signataire, relu sur OpenAPI : chaque partie voit si l'autre a déjà signé
    // et n'est prévenue qu'une fois (confirmation au signataire, « à vous » pour l'autre).
    sellerSignedAt: { type: Date, default: null },
    buyerSignedAt: { type: Date, default: null },
    // Dossier signé tel que renvoyé par OpenAPI : c'est lui qui porte la signature électronique.
    signedDocumentUrl: { type: String, default: null },
    signedDocumentFilename: { type: String, default: null },
    // Copies de consultation de chaque document, extraites du dossier signé
    signedCertificateUrl: { type: String, default: null },
    signedPurchaseDeclarationUrl: { type: String, default: null },
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
module.exports.DOCUMENT_REPORT_REASONS = DOCUMENT_REPORT_REASONS;
