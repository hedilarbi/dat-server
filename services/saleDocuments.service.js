const { PDFDocument } = require('pdf-lib');
const { storageBucket } = require('../config/firebase');
const { drawStamp } = require('./certificateOfTransfer.service');

// Emplacement des tampons sur la première page de chaque document. Coordonnées pdf-lib :
// origine en bas à gauche. Les zones de signature OpenAPI (esignature.service.js) sont
// placées à côté : le tampon ne doit jamais les recouvrir.
const STAMP_POSITIONS = {
  certificate: {
    // Entre la signature et le libellé « Signature … et cachet » du cadre « Ancien propriétaire »
    seller: { position: { x: 280, y: 283 }, maxWidth: 105, maxHeight: 45 },
    // Même emplacement dans le cadre « Nouveau propriétaire »
    buyer: { position: { x: 280, y: 32 }, maxWidth: 105, maxHeight: 45 },
  },
  purchaseDeclaration: {
    // Cadre « Certificat de vente », à droite de la signature du vendeur
    seller: { position: { x: 285, y: 64 }, maxWidth: 120, maxHeight: 50 },
    // Dans le cadre « Cachet et signature de l'acquéreur »
    buyer: { position: { x: 425, y: 370 }, maxWidth: 130, maxHeight: 55 },
  },
};

const documentError = (message, codeName, statusCode = 400) => {
  const error = new Error(message);
  error.codeName = codeName;
  error.statusCode = statusCode;
  return error;
};

/**
 * Un document redéposé doit venir du stockage de la plateforme : le serveur le télécharge
 * ensuite, il ne doit jamais aller chercher une adresse arbitraire.
 */
const isPlatformStorageUrl = (url) => {
  if (typeof url !== 'string' || !url) return false;
  const prefixes = [];
  if (storageBucket) prefixes.push(`https://firebasestorage.googleapis.com/v0/b/${storageBucket.name}/o/`);
  if (process.env.API_URL) prefixes.push(`${process.env.API_URL.replace(/\/+$/, '')}/uploads/`);
  return prefixes.some((prefix) => url.startsWith(prefix));
};

/** Télécharge un document stocké (Firebase ou stockage local) à partir de son URL. */
const downloadPdf = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw documentError(`Téléchargement du document impossible (${response.status}).`, 'sale.document_download_failed', 502);
  }
  return Buffer.from(await response.arrayBuffer());
};

const loadPdf = async (buffer) => {
  try {
    return await PDFDocument.load(buffer, { ignoreEncryption: true });
  } catch {
    throw documentError('Le document doit être un fichier PDF lisible.', 'sale.document_not_pdf');
  }
};

/** Nombre de pages d'un PDF ; rejette tout fichier qui n'est pas un PDF exploitable. */
const countPages = async (buffer) => (await loadPdf(buffer)).getPageCount();

/** Appose les tampons des deux parties sur la première page d'un document. */
const stampDocument = async ({ buffer, document, sellerStampUrl, buyerStampUrl }) => {
  const pdf = await loadPdf(buffer);
  const page = pdf.getPages()[0];
  for (const [role, stampUrl] of [['seller', sellerStampUrl], ['buyer', buyerStampUrl]]) {
    const placement = STAMP_POSITIONS[document][role];
    await drawStamp(pdf, page, stampUrl, placement.position, placement.maxWidth, placement.maxHeight);
  }
  return Buffer.from(await pdf.save());
};

/** Regroupe plusieurs PDF en un seul dossier, dans l'ordre reçu. */
const mergePdfs = async (buffers) => {
  const merged = await PDFDocument.create();
  for (const buffer of buffers) {
    const source = await loadPdf(buffer);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return Buffer.from(await merged.save());
};

/**
 * Copie des pages [from, to[ d'un PDF. Sert à consulter séparément chaque document du dossier
 * signé : la signature électronique, elle, ne vaut que pour le dossier complet.
 */
const extractPages = async (buffer, from, to) => {
  const source = await loadPdf(buffer);
  const end = Math.min(to ?? source.getPageCount(), source.getPageCount());
  const copy = await PDFDocument.create();
  const indices = [];
  for (let index = from; index < end; index += 1) indices.push(index);
  const pages = await copy.copyPages(source, indices);
  pages.forEach((page) => copy.addPage(page));
  return Buffer.from(await copy.save());
};

module.exports = {
  STAMP_POSITIONS,
  isPlatformStorageUrl,
  downloadPdf,
  countPages,
  stampDocument,
  mergePdfs,
  extractPages,
};
