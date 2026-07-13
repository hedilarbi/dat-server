const { storageBucket } = require('../config/firebase');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni dans la requête.' });
    }

    const safeOriginalName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const filename = `documents/${timestamp}_${safeOriginalName}`;

    // Tentative d'upload sur Firebase Storage Admin SDK
    if (storageBucket) {
      try {
        const token = crypto.randomUUID();
        const fileUpload = storageBucket.file(filename);

        await fileUpload.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
            metadata: {
              firebaseStorageDownloadTokens: token
            }
          }
        });

        const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket.name}/o/${encodeURIComponent(fileUpload.name)}?alt=media&token=${token}`;
        return res.status(200).json({
          success: true,
          url: publicUrl,
          filename: fileUpload.name,
          provider: 'firebase'
        });
      } catch (fbError) {
        console.error('Erreur Firebase Storage, tentative de bascule sur le stockage local :', fbError);

        // Fallback : stockage local sur disque (/uploads), utile en développement quand
        // Firebase n'est pas configuré. En production serverless (fs en lecture seule hors
        // /tmp, instances éphémères), cette écriture échoue systématiquement — dans ce cas on
        // remonte l'erreur Firebase d'origine plutôt que de laisser l'échec du fallback (ex.
        // ENOENT sur mkdir) masquer la vraie cause.
        try {
          const uploadDir = path.join(__dirname, '../uploads');
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }

          const localFilename = `${timestamp}_${safeOriginalName}`;
          const filePath = path.join(uploadDir, localFilename);
          fs.writeFileSync(filePath, req.file.buffer);

          const baseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
          const localUrl = `${baseUrl}/uploads/${localFilename}`;

          return res.status(200).json({
            success: true,
            url: localUrl,
            filename: localFilename,
            provider: 'local'
          });
        } catch (localError) {
          console.error('Échec du fallback de stockage local :', localError);
          const error = new Error("Le service de stockage de fichiers est momentanément indisponible. Veuillez réessayer plus tard ou contacter le support.");
          error.statusCode = 502;
          error.codeName = 'upload.storage_unavailable';
          throw error;
        }
      }
    }

    const error = new Error("Le service de stockage de fichiers n'est pas configuré.");
    error.statusCode = 503;
    error.codeName = 'upload.storage_not_configured';
    throw error;
  } catch (error) {
    next(error);
  }
};

module.exports = { uploadFile };
