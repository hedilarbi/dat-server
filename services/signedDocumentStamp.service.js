const { PDFDocument } = require('pdf-lib');
const { drawStamp } = require('./certificateOfTransfer.service');

// Le dossier OpenAPI contient le certificat de cession en page 1 et la déclaration
// d'achat en page 2. Coordonnées pdf-lib : origine en bas à gauche.
const STAMP_POSITIONS = {
  seller: [
    // Certificat : à droite et légèrement au-dessus de la signature vendeur.
    { pageIndex: 0, position: { x: 350, y: 275 }, maxWidth: 145, maxHeight: 58 },
    // Déclaration d'achat : cadre vendeur en bas de page.
    { pageIndex: 1, position: { x: 370, y: 82 }, maxWidth: 145, maxHeight: 55 },
  ],
  buyer: [
    // Certificat : à droite de la signature acheteur.
    { pageIndex: 0, position: { x: 350, y: 35 }, maxWidth: 145, maxHeight: 52 },
    // Déclaration d'achat : davantage décalé vers la droite.
    { pageIndex: 1, position: { x: 440, y: 390 }, maxWidth: 120, maxHeight: 52 },
  ],
};

const downloadPdf = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`Téléchargement du dossier signé impossible (${response.status}).`);
    error.codeName = 'sale.signed_document_download_failed';
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
};

/**
 * Produit une copie visuellement tamponnée du dossier signé sans modifier l'original
 * archivé. Le cachet est appliqué aux deux Cerfa composant le dossier.
 */
const stampSignedBundle = async ({ sourceUrl, sourceBuffer, stampUrl, role }) => {
  if ((!sourceUrl && !sourceBuffer) || !stampUrl || !STAMP_POSITIONS[role]) {
    const error = new Error('Données insuffisantes pour appliquer le tampon.');
    error.codeName = 'sale.stamp_data_missing';
    throw error;
  }

  const pdf = await PDFDocument.load(sourceBuffer || await downloadPdf(sourceUrl));
  const pages = pdf.getPages();
  if (pages.length < 2) {
    const error = new Error('Le dossier signé doit contenir le certificat et la déclaration d’achat.');
    error.codeName = 'sale.signed_document_invalid';
    throw error;
  }

  for (const placement of STAMP_POSITIONS[role]) {
    await drawStamp(
      pdf,
      pages[placement.pageIndex],
      stampUrl,
      placement.position,
      placement.maxWidth,
      placement.maxHeight,
    );
  }

  return Buffer.from(await pdf.save());
};

module.exports = { stampSignedBundle, STAMP_POSITIONS };
