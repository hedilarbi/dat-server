const { saveBuffer } = require('../services/storage.service');

// Sous-dossier de stockage autorisé pour req.body.folder (multer expose les champs texte du
// multipart dans req.body même avec upload.single('file')) — whitelist plutôt que sanitizer
// regex pour éviter tout risque de traversée de chemin, défaut 'documents' pour ne rien casser
// des appelants existants (KBIS, CIN, RIB, tickets) qui n'envoient pas ce champ.
const ALLOWED_FOLDERS = ['documents', 'vehicules/photos', 'vehicules/documents'];

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

module.exports = { uploadFile };
