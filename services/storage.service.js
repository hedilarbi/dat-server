const { storageBucket } = require('../config/firebase');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Sauvegarde un buffer sur Firebase Storage, avec fallback disque local (utile en dev quand
 * Firebase n'est pas configuré). Extrait de upload.controller.js pour être réutilisable par
 * tout endpoint ayant besoin de persister un fichier généré côté serveur (ex: image floutée).
 *
 * @param {Object} params
 * @param {Buffer} params.buffer
 * @param {string} params.filename - chemin complet dans le bucket (ex: 'vehicules/photos/123_a.jpg')
 * @param {string} params.contentType
 * @param {import('express').Request} params.req - utilisé pour construire l'URL de fallback local
 * @returns {Promise<{url: string, filename: string, provider: 'firebase'|'local'}>}
 */
const saveBuffer = async ({ buffer, filename, contentType, req }) => {
  if (storageBucket) {
    try {
      const token = crypto.randomUUID();
      const fileUpload = storageBucket.file(filename);

      await fileUpload.save(buffer, {
        metadata: {
          contentType,
          metadata: {
            firebaseStorageDownloadTokens: token
          }
        }
      });

      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${storageBucket.name}/o/${encodeURIComponent(fileUpload.name)}?alt=media&token=${token}`;
      return { url: publicUrl, filename: fileUpload.name, provider: 'firebase' };
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

        const localFilename = filename.replace(/\//g, '_');
        const filePath = path.join(uploadDir, localFilename);
        fs.writeFileSync(filePath, buffer);

        const baseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
        const localUrl = `${baseUrl}/uploads/${localFilename}`;

        return { url: localUrl, filename: localFilename, provider: 'local' };
      } catch (localError) {
        console.error('Échec du fallback de stockage local :', localError);
        const error = new Error('Le service de stockage de fichiers est momentanément indisponible. Veuillez réessayer plus tard ou contacter le support.');
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
};

module.exports = { saveBuffer };
