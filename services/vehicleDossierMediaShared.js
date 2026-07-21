const FIREBASE_STORAGE_ORIGIN = 'https://firebasestorage.googleapis.com';

// Un fichier reçu par les endpoints de floutage est nécessairement une URL déjà uploadée par notre
// propre service de stockage (Firebase Storage ou fallback disque local) — jamais une URL
// arbitraire fournie par l'utilisateur. Sans ce garde-fou, l'endpoint deviendrait un proxy SSRF
// exploitable par tout vendeur/admin authentifié (fetch() vers une origine interne au réseau du
// serveur, etc.). Partagé entre le floutage image et le floutage PDF.
const assertTrustedFileOrigin = (fileUrl, req) => {
  let parsed;
  try {
    parsed = new URL(fileUrl);
  } catch {
    const error = new Error("L'URL du fichier fournie est invalide.");
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.invalid_image_source';
    throw error;
  }

  if (parsed.origin === FIREBASE_STORAGE_ORIGIN) return;

  // Fallback local (/uploads/...) : même origine que celle utilisée par storage.service.js pour
  // construire les URLs locales (API_URL si défini, sinon protocole+host de la requête courante).
  const localBaseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
  let localOrigin;
  try {
    localOrigin = new URL(localBaseUrl).origin;
  } catch {
    localOrigin = null;
  }

  if (localOrigin && parsed.origin === localOrigin && parsed.pathname.startsWith('/uploads/')) return;

  const error = new Error("Ce fichier ne provient pas d'une source autorisée.");
  error.statusCode = 400;
  error.codeName = 'vehicleDossier.invalid_image_source';
  throw error;
};

const basenameFromUrl = (fileUrl) => {
  const pathname = new URL(fileUrl).pathname;
  const lastSegment = decodeURIComponent(pathname.split('/').pop() || 'file');
  // Le nom de fichier Firebase contient déjà le dossier encodé (ex: 'vehicules/photos/123_a.jpg')
  // sous forme de segments '/' — ne garder que la partie après le dernier '/'.
  return lastSegment.split('/').pop();
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

module.exports = { assertTrustedFileOrigin, basenameFromUrl, clamp };
