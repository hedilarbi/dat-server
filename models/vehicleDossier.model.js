const mongoose = require('mongoose');

// Rectangle en coordonnées normalisées (0-1), relatif à la largeur/hauteur de l'image ORIGINALE
// (pas de l'aperçu écran) — reste valide quel que soit le device/zoom qui l'a dessiné. `page` ne
// sert que pour les documents PDF multi-pages (0 = première page) ; absent/0 pour une photo ou un
// document image, qui n'ont qu'une seule "page" implicite.
const blurZoneSchema = new mongoose.Schema({
  page: { type: Number, min: 0, default: 0 },
  x: { type: Number, required: true, min: 0, max: 1 },
  y: { type: Number, required: true, min: 0, max: 1 },
  width: { type: Number, required: true, min: 0, max: 1 },
  height: { type: Number, required: true, min: 0, max: 1 }
}, { _id: true });

const photoSchema = new mongoose.Schema({
  originalUrl: { type: String, required: true, trim: true },
  processedUrl: { type: String, trim: true },
  blurZones: [blurZoneSchema],
  isCover: { type: Boolean, default: false },
  order: { type: Number, required: true, default: 0 },
  width: { type: Number },
  height: { type: Number }
}, { timestamps: true, _id: true });

const documentSchema = new mongoose.Schema({
  type: { type: String, enum: ['rapport_expert', 'complementaire'], required: true },
  originalUrl: { type: String, required: true, trim: true },
  processedUrl: { type: String, trim: true },
  mimeType: { type: String, trim: true },
  blurZones: [blurZoneSchema],
  label: { type: String, trim: true },
  width: { type: Number },
  height: { type: Number }
}, { timestamps: true, _id: true });

// Symétrique de User.rejections (server/models/user.model.js) — mêmes noms de champs. Alimenté
// par le futur workflow de validation admin, pas par ce lot.
const refusalSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  motifs: [{ type: String }],
  motifsLabels: [{ type: String }],
  comment: { type: String },
  resubmittedAt: { type: Date }
}, { _id: false });

const vehicleDossierSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Étape 1 : informations véhicule
  brand: { type: String, trim: true },
  model: { type: String, trim: true },
  year: { type: Number },
  mileage: { type: Number },
  engine: { type: String, trim: true },
  fuelType: {
    type: String,
    enum: ['essence', 'diesel', 'hybride', 'electrique', 'gpl', 'autre']
  },
  vin: { type: String, trim: true },
  description: { type: String, trim: true },
  registrationNumber: { type: String, trim: true, unique: true, sparse: true },
  registrationCountry: { type: String, trim: true },
  firstRegistrationDate: { type: String, trim: true },
  co2: { type: String, trim: true },
  energyLabel: { type: String, trim: true },
  vehicleGenre: { type: String, trim: true },
  fiscalPower: { type: String, trim: true },
  bodyType: { type: String, trim: true },
  gearbox: { type: String, trim: true },
  passengerCount: { type: String, trim: true },
  doorCount: { type: String, trim: true },
  color: { type: String, trim: true },
  vrade: { type: String, trim: true },
  procedure: { type: String, enum: ['VEI', 'VE', 'TNR', 'RIV / VE', 'RIV'] },
  vehicleAddress: { type: String, trim: true },
  vehicleAddressDetails: {
    street: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    city: { type: String, trim: true },
    country: { type: String, trim: true },
  },
  registrationCardAvailable: { type: Boolean, default: true },
  formulaNumber: { type: String, trim: true },
  registrationCardMissingMotif: { type: String, trim: true },
  registrationCardMissingReasons: [{ type: String, enum: ['declaration_perte', 'declaration_vol', 'autre'] }],
  identificationSheetAvailable: { type: Boolean, default: false },
  policeBookNumber: { type: String, trim: true },

  // Étape 2 : images et documents
  photos: [photoSchema],
  expertReport: documentSchema,
  additionalDocuments: [documentSchema],

  // Étape 3 : prix et détails complémentaires
  reservePrice: { type: Number },
  conditionDetails: { type: String, trim: true },

  // Compteur de mises en vente (cahier des charges §6.11) : incrémenté dès qu'un véhicule
  // est publié dans une session d'appel d'offres. `lastListedSession` retient la dernière
  // session comptabilisée, pour qu'un retrait suivi d'une réaffectation à la même session
  // ne compte pas deux fois.
  listingCount: { type: Number, default: 0 },
  // Numéro de lot attribué à la publication dans une session (« Lot #12311 »). Un nouveau
  // numéro est tiré à chaque nouvelle mise en vente : un lot appartient à une session.
  lotNumber: { type: Number, default: null, index: true },
  lastListedSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    default: null
  },

  // Session d'appel d'offres à laquelle ce véhicule est rattaché
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    default: null
  },

  // Cycle de vie du dossier avant mise en session (pattern identique à User.status). Les statuts
  // liés aux sessions/offres/paiements/OTP (cahier des charges §9) seront ajoutés par les tickets
  // qui implémentent ces modules.
  status: {
    type: String,
    enum: ['brouillon', 'soumis', 'en_attente_validation', 'correction_demandee', 'refuse', 'valide', 'annule_vendeur'],
    default: 'brouillon'
  },
  submittedAt: { type: Date },
  refusals: [refusalSchema]
}, {
  timestamps: true
});

const VehicleDossier = mongoose.model('VehicleDossier', vehicleDossierSchema);

module.exports = VehicleDossier;
