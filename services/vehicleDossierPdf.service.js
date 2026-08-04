const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, DOMMatrix, ImageData, Path2D } = require('@napi-rs/canvas');
const path = require('path');
const { pathToFileURL } = require('url');
const { saveBuffer } = require('./storage.service');
const { assertTrustedFileOrigin, basenameFromUrl, clamp } = require('./vehicleDossierMediaShared');

const MAX_PAGES = 15;
const RENDER_SCALE = 2; // résolution suffisante pour lire/flouter un texte de rapport expert

let cachedStandardFontDataUrl = null;
const getStandardFontDataUrl = () => {
  if (cachedStandardFontDataUrl) return cachedStandardFontDataUrl;
  try {
    const pdfjsMain = require.resolve('pdfjs-dist');
    const fontsDir = path.resolve(path.dirname(pdfjsMain), '../standard_fonts');
    cachedStandardFontDataUrl = pathToFileURL(fontsDir + '/').href;
  } catch (_err) {
    cachedStandardFontDataUrl = 'https://unpkg.com/pdfjs-dist@4.10.38/standard_fonts/';
  }
  return cachedStandardFontDataUrl;
};

// pdfjs-dist "legacy" (build Node) n'est distribué qu'en ESM — require()-er ce module casserait
// sur les versions de Node sans support de require(ESM). Chargé via import() dynamique mis en
// cache, même pattern que expo-server-sdk dans admin.service.js/vehicleDossier.service.js.
let pdfjsModulePromise = null;
const getPdfjs = async () => {
  if (!pdfjsModulePromise) {
    // pdfjs-dist utilise ces API DOM dès l'import du module, avant même l'ouverture d'un PDF.
    // Elles n'existent pas dans Node ; @napi-rs/canvas fournit les implémentations natives
    // compatibles utilisées ensuite pour le rendu des pages.
    globalThis.DOMMatrix ??= DOMMatrix;
    globalThis.ImageData ??= ImageData;
    globalThis.Path2D ??= Path2D;
    // pdfjs-dist 6 appelle l'API Node 22 `process.getBuiltinModule`. Les environnements encore
    // en Node 20/21 peuvent fournir le même comportement via require pour les modules natifs.
    process.getBuiltinModule ??= require;
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsModulePromise;
};

const fetchPdfBuffer = async (pdfUrl, req) => {
  assertTrustedFileOrigin(pdfUrl, req);
  const res = await fetch(pdfUrl);
  if (!res.ok) {
    const error = new Error("Impossible de récupérer le document PDF original.");
    error.statusCode = 502;
    error.codeName = 'vehicleDossier.image_fetch_failed';
    throw error;
  }
  return Buffer.from(await res.arrayBuffer());
};

const loadPdf = async (buffer) => {
  const pdfjsLib = await getPdfjs();
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: getStandardFontDataUrl(),
    });
    const pdfDoc = await loadingTask.promise;
    if (pdfDoc.numPages > MAX_PAGES) {
      const error = new Error(`Ce document compte trop de pages (max ${MAX_PAGES} pour l'édition).`);
      error.statusCode = 400;
      error.codeName = 'vehicleDossier.pdf_too_many_pages';
      throw error;
    }
    return pdfDoc;
  } catch (err) {
    if (err.codeName) throw err;
    const error = new Error('Ce document PDF est illisible ou corrompu.');
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.blur_unsupported_format';
    throw error;
  }
};

const renderPageToPng = async (pdfDoc, pageNumber) => {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  const buffer = await canvas.encode('png');
  return { buffer, width: canvas.width, height: canvas.height };
};

/**
 * Rend chaque page d'un PDF déjà uploadé en image PNG (base64), pour affichage dans l'éditeur de
 * zones de flou côté client. Rendu à la volée et jamais persisté : ces images ne servent qu'à
 * l'édition, seul le PDF final reconstruit (applyPdfBlur) est sauvegardé.
 *
 * @param {string} pdfUrl - URL déjà uploadée (Firebase Storage ou fallback local)
 * @param {import('express').Request} req
 * @returns {Promise<{pages: Array<{index:number, width:number, height:number, dataUrl:string}>}>}
 */
const getPdfPages = async (pdfUrl, req) => {
  if (!pdfUrl) {
    const error = new Error("L'URL du document est requise.");
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.validation_error';
    throw error;
  }

  const buffer = await fetchPdfBuffer(pdfUrl, req);
  const pdfDoc = await loadPdf(buffer);

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
    const { buffer: pngBuffer, width, height } = await renderPageToPng(pdfDoc, pageNumber);
    pages.push({
      index: pageNumber - 1,
      width,
      height,
      dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
    });
  }

  return { pages };
};

/**
 * Applique un flou par page sur un PDF déjà uploadé, puis reconstruit un nouveau PDF à partir des
 * pages rendues (floutées ou non) — chaque page devient une image plein cadre dans le document de
 * sortie (garantit qu'aucun texte vectoriel sous-jacent ne reste sélectionnable/copiable dans une
 * zone floutée). L'original n'est jamais modifié : seul un nouveau fichier "processedUrl" est
 * généré, cohérent avec le floutage des photos (vehicleDossierMedia.service.js::applyBlur).
 *
 * @param {string} pdfUrl
 * @param {Array<{page:number, zones:Array<{x:number,y:number,width:number,height:number}>}>} pagesZones
 * @param {import('express').Request} req
 * @returns {Promise<{url: string}>}
 */
const applyPdfBlur = async (pdfUrl, pagesZones, req) => {
  if (!pdfUrl) {
    const error = new Error("L'URL du document est requise.");
    error.statusCode = 400;
    error.codeName = 'vehicleDossier.validation_error';
    throw error;
  }

  const zonesByPage = new Map();
  for (const entry of Array.isArray(pagesZones) ? pagesZones : []) {
    if (Array.isArray(entry?.zones) && entry.zones.length > 0) {
      zonesByPage.set(entry.page, entry.zones);
    }
  }

  const buffer = await fetchPdfBuffer(pdfUrl, req);
  const pdfDoc = await loadPdf(buffer);

  const outPdf = await PDFDocument.create();

  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
    const pageIndex = pageNumber - 1;
    // eslint-disable-next-line prefer-const
    let { buffer: pageBuffer, width, height } = await renderPageToPng(pdfDoc, pageNumber);

    const zones = zonesByPage.get(pageIndex);
    if (zones && zones.length > 0) {
      const overlays = [];
      for (const zone of zones) {
        const left = clamp(Math.round(zone.x * width), 0, width - 1);
        const top = clamp(Math.round(zone.y * height), 0, height - 1);
        const regionWidth = clamp(Math.round(zone.width * width), 1, width - left);
        const regionHeight = clamp(Math.round(zone.height * height), 1, height - top);
        const sigma = clamp(Math.round(Math.min(regionWidth, regionHeight) / 6), 8, 40);

        const blurredRegion = await sharp(pageBuffer)
          .extract({ left, top, width: regionWidth, height: regionHeight })
          .blur(sigma)
          .toBuffer();

        overlays.push({ input: blurredRegion, left, top });
      }
      pageBuffer = await sharp(pageBuffer).composite(overlays).png().toBuffer();
    }

    const embeddedImage = await outPdf.embedPng(pageBuffer);
    const outPage = outPdf.addPage([width, height]);
    outPage.drawImage(embeddedImage, { x: 0, y: 0, width, height });
  }

  // Sans object streams, le PDF est un peu plus volumineux mais reste lisible par davantage de
  // moteurs intégrés (aperçus WebView/iOS, anciens lecteurs et certaines previews navigateur).
  const outBytes = await outPdf.save({ useObjectStreams: false });
  const basename = basenameFromUrl(pdfUrl).replace(/\.pdf$/i, '') + '.pdf';
  const filename = `vehicules/blurred/${Date.now()}_${basename}`;

  const { url } = await saveBuffer({ buffer: Buffer.from(outBytes), filename, contentType: 'application/pdf', req });
  return { url };
};

module.exports = { getPdfPages, applyPdfBlur };
