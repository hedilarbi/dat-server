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
        console.warn('Erreur Firebase Storage, bascule sur le stockage local :', fbError.message);
      }
    }

    // Fallback : Stockage local sur le serveur (/uploads) si Firebase Storage échoue ou non initialisé
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
  } catch (error) {
    next(error);
  }
};

module.exports = { uploadFile };
