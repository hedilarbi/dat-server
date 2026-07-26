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
  vehicleCondition: { type: String, trim: true },
  dossierType: { type: String, enum: ['Sinistré', 'VHU', 'Flotte', 'Occasion'], default: 'Sinistré' },
  registrationNumber: { type: String, trim: true },

  // Étape 2 : images et documents
  photos: [photoSchema],
  expertReport: documentSchema,
  additionalDocuments: [documentSchema],

  // Étape 3 : prix et détails complémentaires
  reservePrice: { type: Number },
  conditionDetails: { type: String, trim: true },

  // Anticipé cahier des charges §6.11/10.21, non exploité dans ce lot
  listingCount: { type: Number, default: 0 },

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
