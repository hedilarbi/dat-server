require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const os = require('os');
const connectDB = require('./config/db');
const seedAdmin = require('./utils/seedAdmin');
const { errorHandler } = require('./middlewares/error.middleware');

// Initialisation de l'application Express
const app = express();

// Connexion à la base de données
connectDB().then(() => {
  // Seeding de l'administrateur par défaut après connexion réussie à la BDD
  seedAdmin();
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
app.use('/api/upload', require('./routes/upload.routes'));
app.use('/api/vehicle-dossiers', require('./routes/vehicleDossier.routes'));
app.use('/api/admin/vehicle-dossiers', require('./routes/adminVehicleDossier.routes'));

// Service de fichiers statiques (fallback local si nécessaire)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route de base de vérification de santé (health check)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Le serveur DealAutoPro fonctionne correctement.' });
});

// Middleware de gestion d'erreur global (doit être après les routes)
app.use(errorHandler);

// Démarrage du serveur
const PORT = process.env.PORT || 5001;
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
