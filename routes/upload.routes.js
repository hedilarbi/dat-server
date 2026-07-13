const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/upload.controller');

// Configuration de multer en mémoire (pour l'envoyer vers Firebase Storage ou disque ensuite)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB max
  }
});

// Route publique/protégée d'upload de fichier multipart/form-data
router.post('/', upload.single('file'), uploadController.uploadFile);

module.exports = router;
