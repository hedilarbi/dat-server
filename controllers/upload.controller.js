const { saveBuffer } = require('../services/storage.service');
const sharp = require('sharp');
const { removeStampBackground } = require('../services/stampBackground.service');

// Sous-dossier de stockage autorisé pour req.body.folder (multer expose les champs texte du
// multipart dans req.body même avec upload.single('file')) — whitelist plutôt que sanitizer
// regex pour éviter tout risque de traversée de chemin, défaut 'documents' pour ne rien casser
// des appelants existants (KBIS, CIN, RIB, tickets) qui n'envoient pas ce champ.
const ALLOWED_FOLDERS = ['documents', 'vehicules/photos', 'vehicules/documents', 'ventes/certificats'];

const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni dans la requête.' });
    }

    const folder = ALLOWED_FOLDERS.includes(req.body.folder) ? req.body.folder : 'documents';
    const safeOriginalName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    const filename = `${folder}/${timestamp}_${safeOriginalName}`;

    const result = await saveBuffer({
      buffer: req.file.buffer,
      filename,
      contentType: req.file.mimetype,
      req
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * Téléversement du tampon d'entreprise : la photo est détourée avant stockage, pour
 * obtenir un PNG à fond transparent apposable sur un document sans en masquer le texte.
 * En cas d'échec du détourage, l'image d'origine est conservée plutôt que de perdre
 * le téléversement de l'utilisateur.
 */
const uploadStamp = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Aucun fichier fourni dans la requête.' });
    }
    if (!String(req.file.mimetype || '').startsWith('image/')) {
      return res.status(400).json({
        success: false,
        error: 'upload.stamp_not_an_image',
        message: 'Le tampon doit être une image (photo ou scan).'
      });
    }

    // Le type MIME annoncé par le client ne prouve rien : on vérifie que l'image est
    // réellement décodable avant de la stocker, sinon le repli ci-dessous conserverait
    // un fichier illisible.
    try {
      await sharp(req.file.buffer).metadata();
    } catch {
      return res.status(400).json({
        success: false,
        error: 'upload.stamp_unreadable',
        message: "Cette image n'a pas pu être lue. Envoyez une photo au format JPEG ou PNG."
      });
    }

    let buffer = req.file.buffer;
    let contentType = 'image/png';
    let extension = 'png';
    let backgroundRemoved = true;

    try {
      const processed = await removeStampBackground(req.file.buffer);
      buffer = processed.buffer;
    } catch (processingError) {
      console.error(`Détourage du tampon impossible, image d'origine conservée : ${processingError.message}`);
      contentType = req.file.mimetype;
      extension = (req.file.originalname.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
      backgroundRemoved = false;
    }

    const result = await saveBuffer({
      buffer,
      filename: `documents/tampons/${Date.now()}_tampon.${extension}`,
      contentType,
      req
    });

    return res.status(200).json({ success: true, backgroundRemoved, ...result });
  } catch (error) {
    next(error);
  }
};

module.exports = { uploadFile, uploadStamp };
