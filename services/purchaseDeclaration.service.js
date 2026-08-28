const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { splitStreet } = require('./certificateOfTransfer.service');

// Formulaire officiel Cerfa 13751*02, livré avec le dépôt.
const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'declaration-achat.pdf');

const TEMPLATE_PAGE_COUNT = 1;
const TEMPLATE_WIDTH = 595;
const TEMPLATE_HEIGHT = 842;

/**
 * Coordonnées en points PDF (origine en bas à gauche), relevées sur le gabarit.
 * Comme sur le certificat de cession, les libellés imprimés sont sous leur case :
 * la valeur se pose donc au-dessus du libellé.
 */
const LAYOUT = {
  // Bloc haut : déclaration de l'acquéreur (l'acheteur professionnel)
  buyer: {
    professionalCheckbox: { x: 171, y: 748 },
    name: { x: 108, y: 728 },
    siren: { x: 466, y: 732 },
    streetNumber: { x: 105, y: 703 },
    streetExtension: { x: 145, y: 703 },
    streetType: { x: 200, y: 703 },
    streetName: { x: 280, y: 703 },
    postalCode: { x: 90, y: 681 },
    city: { x: 178, y: 679 },
    purchaseDay: { x: 136, y: 653 },
    purchaseMonth: { x: 173, y: 653 },
    purchaseYear: { x: 214, y: 653 },
    purchaseHour: { x: 279, y: 653 },
    purchaseMinute: { x: 309, y: 653 },
    signedAt: { x: 60, y: 434 },
    signedDay: { x: 287, y: 438 },
    signedMonth: { x: 320, y: 438 },
    signedYear: { x: 364, y: 438 },
  },
  vehicle: {
    registrationNumber: { x: 66, y: 612 },
    vin: { x: 245, y: 612 },
    brand: { x: 465, y: 612 },
    type: { x: 120, y: 587 },
    commercialName: { x: 312, y: 587 },
    genre: { x: 478, y: 587 },
    registrationCardYes: { x: 237, y: 554 },
    registrationCardNo: { x: 291, y: 554 },
    registrationCardDate: { x: 145, y: 535 },
    formulaNumber: { x: 322, y: 535 },
  },
  // Bloc bas : certificat de vente, rempli par l'ancien propriétaire (le vendeur)
  seller: {
    name: { x: 110, y: 255 },
    siren: { x: 462, y: 259 },
    streetNumber: { x: 92, y: 226 },
    streetExtension: { x: 135, y: 226 },
    streetType: { x: 192, y: 226 },
    streetName: { x: 275, y: 226 },
    postalCode: { x: 90, y: 200 },
    city: { x: 176, y: 198 },
    soldDay: { x: 369, y: 170 },
    soldMonth: { x: 402, y: 170 },
    soldYear: { x: 448, y: 170 },
    signedAt: { x: 62, y: 131 },
    signedDay: { x: 213, y: 134 },
    signedMonth: { x: 246, y: 134 },
    signedYear: { x: 292, y: 134 },
  },
};

const TEXT_SIZE = 8;
const CHECK_SIZE = 8;
const INK = rgb(0.05, 0.1, 0.25);

const padded = (value) => String(value).padStart(2, '0');

/**
 * Le Cerfa 13751 demande un SIREN (9 chiffres), là où les comptes stockent un SIRET
 * (14 chiffres) : le SIREN en est le préfixe.
 */
const sirenFromSiret = (siret) => String(siret || '').replace(/\D/g, '').slice(0, 9);

/**
 * Remplit la déclaration d'achat (Cerfa 13751*02) et retourne le PDF complété.
 *
 * @param {object} input
 * @param {object} input.vehicle dossier véhicule
 * @param {object} input.seller  ancien propriétaire
 * @param {object} input.buyer   acquéreur professionnel
 * @param {Date}   [input.purchasedAt] date et heure de l'achat
 * @returns {Promise<Buffer>}
 */
const fillPurchaseDeclaration = async ({ vehicle, seller, buyer, purchasedAt }) => {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    const error = new Error("Le gabarit de la déclaration d'achat est introuvable sur le serveur.");
    error.codeName = 'declaration.template_missing';
    throw error;
  }

  const pdf = await PDFDocument.load(fs.readFileSync(TEMPLATE_PATH));
  const pages = pdf.getPages();

  if (pages.length !== TEMPLATE_PAGE_COUNT
    || Math.round(pages[0].getWidth()) !== TEMPLATE_WIDTH
    || Math.round(pages[0].getHeight()) !== TEMPLATE_HEIGHT) {
    const error = new Error("Le gabarit de la déclaration d'achat ne correspond pas au format attendu (Cerfa 13751*02, A4, 1 page).");
    error.codeName = 'declaration.template_mismatch';
    throw error;
  }

  const page = pages[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const write = (position, value, size = TEXT_SIZE) => {
    const text = value === null || value === undefined ? '' : String(value).trim();
    if (!text) return;
    page.drawText(text, { x: position.x, y: position.y, size, font, color: INK });
  };

  const check = (position) => {
    page.drawText('X', { x: position.x, y: position.y, size: CHECK_SIZE, font: bold, color: INK });
  };

  const boughtAt = purchasedAt ? new Date(purchasedAt) : new Date();
  const day = padded(boughtAt.getDate());
  const month = padded(boughtAt.getMonth() + 1);
  const year = String(boughtAt.getFullYear());
  const buyerStreet = splitStreet(buyer?.address?.street);
  const sellerStreet = splitStreet(seller?.address?.street);

  // --- Acquéreur : un acheteur de la plateforme est toujours un professionnel de l'automobile
  check(LAYOUT.buyer.professionalCheckbox);
  write(LAYOUT.buyer.name, buyer?.companyName);
  write(LAYOUT.buyer.siren, sirenFromSiret(buyer?.siret));
  write(LAYOUT.buyer.streetNumber, buyerStreet.number);
  write(LAYOUT.buyer.streetExtension, buyerStreet.extension);
  write(LAYOUT.buyer.streetType, buyerStreet.type);
  write(LAYOUT.buyer.streetName, buyerStreet.name);
  write(LAYOUT.buyer.postalCode, buyer?.address?.postalCode);
  write(LAYOUT.buyer.city, buyer?.address?.city);
  write(LAYOUT.buyer.purchaseDay, day);
  write(LAYOUT.buyer.purchaseMonth, month);
  write(LAYOUT.buyer.purchaseYear, year);
  write(LAYOUT.buyer.purchaseHour, padded(boughtAt.getHours()));
  write(LAYOUT.buyer.purchaseMinute, padded(boughtAt.getMinutes()));
  write(LAYOUT.buyer.signedAt, buyer?.address?.city);
  write(LAYOUT.buyer.signedDay, day);
  write(LAYOUT.buyer.signedMonth, month);
  write(LAYOUT.buyer.signedYear, year);

  // --- Véhicule
  write(LAYOUT.vehicle.registrationNumber, vehicle?.registrationNumber);
  write(LAYOUT.vehicle.vin, vehicle?.vin);
  write(LAYOUT.vehicle.brand, vehicle?.brand);
  write(LAYOUT.vehicle.type, vehicle?.engine);
  write(LAYOUT.vehicle.commercialName, vehicle?.model);
  write(LAYOUT.vehicle.genre, vehicle?.vehicleGenre);
  if (vehicle?.registrationCardAvailable) {
    check(LAYOUT.vehicle.registrationCardYes);
  } else {
    check(LAYOUT.vehicle.registrationCardNo);
  }

  // --- Certificat de vente (ancien propriétaire)
  write(LAYOUT.seller.name, seller?.companyName);
  write(LAYOUT.seller.siren, sirenFromSiret(seller?.siret));
  write(LAYOUT.seller.streetNumber, sellerStreet.number);
  write(LAYOUT.seller.streetExtension, sellerStreet.extension);
  write(LAYOUT.seller.streetType, sellerStreet.type);
  write(LAYOUT.seller.streetName, sellerStreet.name);
  write(LAYOUT.seller.postalCode, seller?.address?.postalCode);
  write(LAYOUT.seller.city, seller?.address?.city);
  write(LAYOUT.seller.soldDay, day);
  write(LAYOUT.seller.soldMonth, month);
  write(LAYOUT.seller.soldYear, year);
  write(LAYOUT.seller.signedAt, seller?.address?.city);
  write(LAYOUT.seller.signedDay, day);
  write(LAYOUT.seller.signedMonth, month);
  write(LAYOUT.seller.signedYear, year);

  return Buffer.from(await pdf.save());
};

module.exports = {
  fillPurchaseDeclaration,
  TEMPLATE_PATH,
};
