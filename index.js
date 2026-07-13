require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
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

// Middlewares globaux
app.use(cors({
  origin: process.env.CLIENT_URL || ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:19006'], // URL Next client, Next admin, Expo web
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

// Service de fichiers statiques (fallback local si nécessaire)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route de base de vérification de santé (health check)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Le serveur DealsAutoPro fonctionne correctement.' });
});

// Middleware de gestion d'erreur global (doit être après les routes)
app.use(errorHandler);

// Démarrage du serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Serveur DealsAutoPro démarré sur le port ${PORT}`);
});
