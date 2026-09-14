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

const fitText = (font, value, maxWidth, initialSize = 9, minimumSize = 6) => {
  const text = String(value || '')
    .trim()
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[–—]/g, '-');
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
  const write = (x, y, value, maxWidth, initialSize = 9) => {
    const fitted = fitText(font, value, maxWidth, initialSize);
    if (!fitted.text) return;
    page.drawText(fitted.text, { x, y, size: fitted.size, font, color: INK });
  };

  const now = new Date();
  const vehicleLabel = [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ');
  const pickupLocation = vehicle?.vehicleAddress || addressLine(vehicle?.vehicleAddressDetails) || addressLine(seller?.address);

  write(88, 708, now.toLocaleDateString('fr-FR'), 85);
  write(222, 708, now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), 62);
  write(391, 708, pickupLocation, 145, 8);
  write(145, 637, vehicleLabel, 175);
  write(423, 637, vehicle?.registrationNumber, 115);
  write(140, 603, vehicle?.vin, 180);
  write(406, 603, vehicle?.mileage != null ? `${Number(vehicle.mileage).toLocaleString('fr-FR')} km` : '', 130);
  write(58, 518, fullName(seller), 230);
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
