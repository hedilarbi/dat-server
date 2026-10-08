const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { saveBuffer } = require('./storage.service');

const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'templates', 'bon_enlevement_vehicule_accidente.pdf');
const INK = rgb(0.05, 0.1, 0.25);

const fullName = (user) => user?.companyName
  || [user?.firstName, user?.lastName].filter(Boolean).join(' ')
  || '';

const addressLine = (address) => {
  if (!address) return '';
  if (typeof address === 'string') return address;
  return [address.street, [address.postalCode, address.city].filter(Boolean).join(' '), address.country]
    .filter(Boolean)
    .join(', ');
};

const cleanText = (value) => String(value || '')
  .trim()
  .replace(/[\u00a0\u202f]/g, ' ')
  .replace(/[–—]/g, '-');

/** Nom de la personne (sans la raison sociale) ; à défaut, la raison sociale. */
const personName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.companyName || '';

/**
 * Coupe un texte en lignes qui tiennent chacune dans la largeur qui leur est réservée
 * (`widths[i]` pour la ligne i). Les mots ne sont jamais coupés, sauf s'ils sont plus larges
 * qu'une ligne entière. Retourne null si le texte ne tient pas dans le nombre de lignes prévu.
 */
const wrapLines = (font, text, size, widths) => {
  const lines = [];
  let current = '';
  const fits = (candidate) => font.widthOfTextAtSize(candidate, size) <= widths[Math.min(lines.length, widths.length - 1)];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
    } else if (current) {
      lines.push(current);
      current = word;
    } else {
      return null;
    }
    if (lines.length >= widths.length) return null;
  }
  if (current) lines.push(current);
  return lines.length <= widths.length && lines.every((line, index) => font.widthOfTextAtSize(line, size) <= widths[index]) ? lines : null;
};

const fitText = (font, value, maxWidth, initialSize = 9, minimumSize = 6) => {
  const text = cleanText(value);
  let size = initialSize;
  while (size > minimumSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return { text, size };
};

/** Remplit le modèle de bon d'enlèvement fourni à la racine du projet. */
const generateBonEnlevement = async (sale, vehicle, seller, buyer) => {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    const error = new Error("Le modèle du bon d'enlèvement est introuvable.");
    error.codeName = 'handover.template_missing';
    throw error;
  }

  const pdfDoc = await PDFDocument.load(fs.readFileSync(TEMPLATE_PATH));
  const pages = pdfDoc.getPages();
  if (pages.length !== 1) {
    const error = new Error("Le modèle du bon d'enlèvement doit contenir une seule page.");
    error.codeName = 'handover.template_invalid';
    throw error;
  }

  const page = pages[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const write = (x, y, value, maxWidth, initialSize = 9) => {
    const fitted = fitText(font, value, maxWidth, initialSize);
    if (!fitted.text) return;
    page.drawText(fitted.text, { x, y, size: fitted.size, font, color: INK });
  };

  /**
   * Texte long dans une case : il revient à la ligne au lieu de dépasser. Chaque ligne a sa
   * position et sa largeur (la première suit souvent un libellé, les suivantes partent du bord
   * de la case) ; la taille diminue jusqu'à ce que tout tienne.
   */
  const writeWrapped = (value, lines, initialSize = 8, minimumSize = 5.5) => {
    const text = cleanText(value);
    if (!text) return;
    for (let size = initialSize; size >= minimumSize; size -= 0.5) {
      const wrapped = wrapLines(font, text, size, lines.map((line) => line.width));
      if (wrapped) {
        wrapped.forEach((line, index) => page.drawText(line, { x: lines[index].x, y: lines[index].y, size, font, color: INK }));
        return;
      }
    }
    // Dernier recours : tout sur la première ligne, réduit à la taille minimale
    write(lines[0].x, lines[0].y, text, lines[0].width, minimumSize);
  };

  const now = new Date();
  const vehicleLabel = [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ');
  const pickupLocation = vehicle?.vehicleAddress || addressLine(vehicle?.vehicleAddressDetails) || addressLine(seller?.address);

  write(88, 708, now.toLocaleDateString('fr-FR'), 85);
  write(222, 708, now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), 62);
  // La case « Lieu d'enlèvement » est petite : l'adresse commence après le libellé, puis revient
  // à la ligne sous celui-ci plutôt que de dépasser à droite.
  writeWrapped(pickupLocation, [
    { x: 391, y: 709, width: 146 },
    { x: 302, y: 700, width: 236 },
  ], 8);
  write(145, 637, vehicleLabel, 175);
  write(423, 637, vehicle?.registrationNumber, 115);
  write(140, 603, vehicle?.vin, 180);
  write(406, 603, vehicle?.mileage != null ? `${Number(vehicle.mileage).toLocaleString('fr-FR')} km` : '', 130);
  // Vendeur / propriétaire : la personne ; raison sociale : l'entreprise qui vend le véhicule
  write(172, 533, personName(seller), 116, 8);
  if (seller?.companyName) {
    const label = 'Raison sociale :';
    page.drawText(label, { x: 58, y: 521, size: 8, font: bold, color: INK });
    write(58 + bold.widthOfTextAtSize(label, 8) + 4, 521, seller.companyName, 230 - bold.widthOfTextAtSize(label, 8) - 4, 8);
  }
  write(311, 518, fullName(buyer), 225);
  write(115, 497, seller?.phone, 170);
  write(367, 497, buyer?.phone, 170);
  write(88, 230, fullName(seller), 165, 8);
  write(341, 230, fullName(buyer), 165, 8);

  const buffer = Buffer.from(await pdfDoc.save());
  const filename = `ventes/bon-enlevement/${sale._id}_bon-enlevement.pdf`;
  const stored = await saveBuffer({ buffer, filename, contentType: 'application/pdf' });
  return { url: stored.url, filename: stored.filename, buffer };
};

module.exports = { generateBonEnlevement, TEMPLATE_PATH };
