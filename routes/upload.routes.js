const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/upload.controller');

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

// Configuration de multer en mémoire (pour l'envoyer vers Firebase Storage ou disque ensuite)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_BYTES, // 30 MB max
  }
});

// Route publique/protégée d'upload de fichier multipart/form-data
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: 'upload.file_too_large',
          message: 'Le fichier est trop lourd. La taille maximale autorisée est de 30 Mo.',
        });
      }
      return next(err);
    }
    return uploadController.uploadFile(req, res, next);
  });
});

module.exports = router;
