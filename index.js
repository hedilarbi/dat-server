require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const os = require('os');
const connectDB = require('./config/db');
const seedAdmin = require('./utils/seedAdmin');
const seedTaxes = require('./utils/seedTaxes');
const migrateLegacyVehicleDossierFields = require('./utils/migrateLegacyVehicleDossierFields');
const migrateSirenToSiret = require('./utils/migrateSirenToSiret');
const { errorHandler } = require('./middlewares/error.middleware');

// Initialisation de l'application Express
const app = express();

const sessionService = require('./services/session.service');
const saleService = require('./services/sale.service');

// Synchroniser les sessions puis désigner les gagnants des sessions qui viennent de clôturer
const syncSessionsAndAttributions = async () => {
  await sessionService.autoGenerateAndSyncSessions();
  await saleService.processClosedSessions();
  // Reprendre les notifications top 3 / réattribution qui ont échoué au premier envoi.
  await saleService.processPendingAttributionEmails();
  // Rattrape les commissions encaissées dont le retour navigateur n'est jamais arrivé
  await saleService.reconcilePendingCommissionPayments();
  // Rappels à 50 % et 80 % du délai, puis retrait de l'attribution à l'expiration
  await saleService.processStepDeadlines();
};

// Connexion à la base de données
connectDB().then(() => {
  migrateLegacyVehicleDossierFields().catch((err) => {
    console.error('Erreur migration des dossiers véhicules :', err.message);
  });

  // Bascule du SIREN (9 chiffres) vers le SIRET (14 chiffres) pour les comptes existants
  migrateSirenToSiret().catch((err) => {
    console.error('Erreur migration SIREN vers SIRET :', err.message);
  });

  // Seeding de l'administrateur par défaut après connexion réussie à la BDD
  seedAdmin();

  // Seeding des taxes par défaut (TAV 20 %)
  seedTaxes();

  // Initialiser et synchroniser automatiquement les sessions (ouvertes/clôturées)
  syncSessionsAndAttributions().catch((err) => {
    console.error('Erreur initialisation des sessions:', err.message);
  });

  // Tâche de fond automatique toutes les 60 secondes
  setInterval(() => {
    syncSessionsAndAttributions().catch((err) => {
      console.error('Erreur synchronisation automatique des sessions:', err.message);
    });
  }, 60 * 1000);
});

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:19006',
  'http://localhost:8081',
  'http://localhost:8082',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:8082',
  'https://dat-client.vercel.app',
  'https://dat-admin-cyan.vercel.app'
];
const configuredOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(origin => origin.trim()).filter(Boolean)
  : defaultAllowedOrigins;
const expoDevOriginPattern = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):\d+$/;

// Middlewares globaux
app.use(cors({
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin) || expoDevOriginPattern.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origine CORS non autorisée : ${origin}`));
  },
  credentials: true, // Autorise l'envoi de cookies JWT
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const path = require('path');

// Déclaration des routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/tickets', require('./routes/ticket.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/admin/messages', require('./routes/message.routes'));
app.use('/api/admin/commissions', require('./routes/commission.routes'));
app.use('/api/admin/general-config', require('./routes/generalConfig.routes'));
app.use('/api/upload', require('./routes/upload.routes'));
app.use('/api/vehicle-dossiers', require('./routes/vehicleDossier.routes'));
app.use('/api/admin/vehicle-dossiers', require('./routes/adminVehicleDossier.routes'));
app.use('/api/sessions', require('./routes/session.routes'));
app.use('/api/offers', require('./routes/offer.routes'));
app.use('/api/sales', require('./routes/sale.routes'));
app.use('/api/public', require('./routes/publicSales.routes'));
app.use('/api/webhooks', require('./routes/webhook.routes'));

// Service de fichiers statiques (fallback local si nécessaire)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route de base de vérification de santé (health check)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Le serveur DealAutoPro fonctionne correctement.' });
});

// Middleware de gestion d'erreur global (doit être après les routes)
app.use(errorHandler);

// Démarrage du serveur
const PORT = process.env.PORT || 5002;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  const lanAddress = Object.values(os.networkInterfaces())
    .flat()
    .find(iface => iface && iface.family === 'IPv4' && !iface.internal)?.address;
  console.log(`Serveur DealAutoPro démarré sur http://${HOST}:${PORT}`);
  if (lanAddress) {
    console.log(`URL mobile LAN : http://${lanAddress}:${PORT}`);
  }
});
