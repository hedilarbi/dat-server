const sharp = require('sharp');
const { saveBuffer } = require('./storage.service');
const { assertTrustedFileOrigin, basenameFromUrl, clamp } = require('./vehicleDossierMediaShared');

/**
 * Applique un flou gaussien sur les zones fournies (coordonnées normalisées 0-1) d'une image déjà
 * uploadée, et sauvegarde le résultat comme un nouveau fichier (l'original n'est jamais modifié
 * ni supprimé — il reste accessible pour les droits d'accès non-acheteur définis plus tard).
 *
 * @param {string} imageUrl - URL déjà uploadée (Firebase Storage ou fallback local)
 * @param {Array<{x:number,y:number,width:number,height:number}>} zones
 * @param {import('express').Request} req
 * @returns {Promise<{url: string}>}
 */
const applyBlur = async (imageUrl, zones, req) => {
  if (!imageUrl) {
    const error = new Error("L'URL de l'image est requise.");
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.validation_error';
    throw error;
  }

  assertTrustedFileOrigin(imageUrl, req);

  if (!Array.isArray(zones) || zones.length === 0) {
    // Le vendeur a retiré toutes ses zones : on revient simplement à l'original, sans traitement.
    return { url: imageUrl };
  }

  const sourceRes = await fetch(imageUrl);
  if (!sourceRes.ok) {
    const error = new Error("Impossible de récupérer l'image originale.");
    error.statusCode = 502;
    error.codeName = 'vehicleDossier.image_fetch_failed';
    throw error;
  }
  const buffer = Buffer.from(await sourceRes.arrayBuffer());

  let image = sharp(buffer);
  let metadata;
  try {
    metadata = await image.metadata();
  } catch {
    const error = new Error("Ce format d'image n'est pas pris en charge pour le floutage.");
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.blur_unsupported_format';
    throw error;
  }

  const { width, height, format } = metadata;
  if (!width || !height) {
    const error = new Error("Impossible de déterminer les dimensions de l'image.");
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.blur_unsupported_format';
    throw error;
  }

  const overlays = [];
  for (const zone of zones) {
    const left = clamp(Math.round(zone.x * width), 0, width - 1);
    const top = clamp(Math.round(zone.y * height), 0, height - 1);
    const regionWidth = clamp(Math.round(zone.width * width), 1, width - left);
    const regionHeight = clamp(Math.round(zone.height * height), 1, height - top);

    // Sigma adaptatif à la taille de la zone : assez fort pour rendre le contenu illisible
    // (plaque d'immatriculation, VIN...) même sur une petite zone, plafonné pour rester
    // raisonnable sur une grande zone.
    const sigma = clamp(Math.round(Math.min(regionWidth, regionHeight) / 6), 8, 40);

    const blurredRegion = await sharp(buffer)
      .extract({ left, top, width: regionWidth, height: regionHeight })
      .blur(sigma)
      .toBuffer();

    overlays.push({ input: blurredRegion, left, top });
  }

  const resultBuffer = await sharp(buffer)
    .composite(overlays)
    .toFormat(format)
    .toBuffer();

  const basename = basenameFromUrl(imageUrl);
  const filename = `vehicules/blurred/${Date.now()}_${basename}`;
  const contentType = `image/${format}`;

  const { url } = await saveBuffer({ buffer: resultBuffer, filename, contentType, req });
  return { url };
};

module.exports = { applyBlur };
