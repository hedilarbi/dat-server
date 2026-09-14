const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Formulaire officiel Cerfa 15776*02, livré avec le dépôt.
const TEMPLATE_PATH = path.join(__dirname, '..', 'assets', 'certificat-cession.pdf');

// Le gabarit est un A4 vectoriel d'une seule page : le second exemplaire du Cerfa
// (identique) a été retiré, il n'était pas exploité par la procédure.
const TEMPLATE_PAGE_COUNT = 1;
const TEMPLATE_WIDTH = 595;
const TEMPLATE_HEIGHT = 842;

/**
 * Coordonnées en points PDF (origine en bas à gauche), relevées sur le gabarit :
 * chaque libellé imprimé est placé SOUS sa case, la valeur se pose donc au-dessus de lui.
 */
const LAYOUT = {
  vehicle: {
    registrationNumber: { x: 40, y: 724 },
    vin: { x: 178, y: 724 },
    firstRegistrationDate: { x: 445, y: 724 },
    brand: { x: 40, y: 700 },
    type: { x: 179, y: 700 },
    genre: { x: 326, y: 700 },
    commercialName: { x: 446, y: 700 },
    mileage: { x: 215, y: 671 },
    registrationCardYes: { x: 37, y: 641 },
    registrationCardNo: { x: 339, y: 644 },
    formulaNumber: { x: 174, y: 643 },
  },
  seller: {
    legalEntity: { x: 37, y: 562 },
    name: { x: 100, y: 545 },
    siret: { x: 400, y: 547 },
    streetNumber: { x: 112, y: 514 },
    streetExtension: { x: 160, y: 514 },
    streetType: { x: 285, y: 514 },
    streetName: { x: 368, y: 514 },
    postalCode: { x: 112, y: 495 },
    city: { x: 195, y: 495 },
    transferCheckbox: { x: 186, y: 466 },
    transferDate: { x: 52, y: 454 },
    transferHour: { x: 156, y: 454 },
    transferMinute: { x: 188, y: 454 },
    certifyHandover: { x: 37, y: 417 },
    certifyNoChange: { x: 37, y: 398 },
    signedAt: { x: 78, y: 331 },
    signedOn: { x: 228, y: 331 },
  },
  buyer: {
    legalEntity: { x: 37, y: 231 },
    name: { x: 100, y: 213 },
    siret: { x: 400, y: 215 },
    streetNumber: { x: 112, y: 169 },
    streetExtension: { x: 160, y: 169 },
    streetType: { x: 285, y: 169 },
    streetName: { x: 368, y: 169 },
    postalCode: { x: 112, y: 151 },
    city: { x: 195, y: 151 },
    certifyAcquire: { x: 37, y: 110 },
    certifyInformed: { x: 37, y: 97 },
    signedAt: { x: 78, y: 76 },
    signedOn: { x: 228, y: 76 },
  },
};

const TEXT_SIZE = 10;
const CHECK_SIZE = 10;
const INK = rgb(0.05, 0.1, 0.25);

/** Types de voie reconnus pour découper une rue en « type » + « nom », comme l'exige le Cerfa. */
const STREET_TYPES = [
  'avenue', 'boulevard', 'rue', 'chemin', 'route', 'impasse', 'allee', 'allée', 'place',
  'quai', 'cours', 'square', 'voie', 'passage', 'sentier', 'faubourg', 'zone', 'lieu-dit',
];

/**
 * Décompose une adresse en une ligne (« 12 bis avenue des Champs ») selon les colonnes
 * du Cerfa. Best-effort : ce qui n'est pas reconnu part dans le nom de la voie.
 */
const splitStreet = (street = '') => {
  const cleaned = String(street).trim().replace(/\s+/g, ' ');
  if (!cleaned) return { number: '', extension: '', type: '', name: '' };

  const match = cleaned.match(/^(\d+)\s*(bis|ter|quater|[A-Za-z])?\s+(.*)$/i);
  const number = match ? match[1] : '';
  const extension = match && match[2] ? match[2] : '';
  const rest = match ? match[3] : cleaned;

  const words = rest.split(' ');
  const firstWord = (words[0] || '').toLowerCase().replace(/[^a-zà-ÿ-]/gi, '');
  const isKnownType = STREET_TYPES.includes(firstWord);

  return {
    number,
    extension,
    type: isKnownType ? words[0] : '',
    name: isKnownType ? words.slice(1).join(' ') : rest,
  };
};

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const padded = (value) => String(value).padStart(2, '0');

/**
 * Télécharge et intègre une image de tampon dans le PDF.
 */
const drawStamp = async (pdf, page, stampUrl, position, maxWidth = 150, maxHeight = 70) => {
  if (!stampUrl) return;
  try {
    const response = await fetch(stampUrl);
    if (!response.ok) return;
    const arrayBuffer = await response.arrayBuffer();
    
    let image;
    const isPng = stampUrl.toLowerCase().includes('.png') || stampUrl.toLowerCase().includes('png');
    
    try {
      image = isPng ? await pdf.embedPng(arrayBuffer) : await pdf.embedJpg(arrayBuffer);
    } catch (e) {
      // Fallback in case the extension doesn't match the actual format
      image = isPng ? await pdf.embedJpg(arrayBuffer) : await pdf.embedPng(arrayBuffer);
    }
    
    const dims = image.scale(1);
    const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height, 1);
    const width = dims.width * scale;
    const height = dims.height * scale;
    
    // Centrer l'image dans l'espace alloué si elle est plus petite
    const xOffset = (maxWidth - width) / 2;
    
    page.drawImage(image, {
      x: position.x + xOffset,
      y: position.y,
      width,
      height,
    });
  } catch (error) {
    console.error(`Erreur lors de l'intégration du tampon (${stampUrl}):`, error.message);
  }
};

/**
 * Remplit le Cerfa 15776*02 à partir d'une vente et retourne le PDF complété.
 *
 * @param {object} input
 * @param {object} input.vehicle  dossier véhicule (marque, modèle, VIN, immatriculation…)
 * @param {object} input.seller   ancien propriétaire (raison sociale, SIRET, adresse)
 * @param {object} input.buyer    nouveau propriétaire
 * @param {Date}   [input.transferredAt] date et heure de la cession
 * @returns {Promise<Buffer>} le PDF rempli
 */
const fillCertificateOfTransfer = async ({ vehicle, seller, buyer, transferredAt }) => {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    const error = new Error("Le gabarit du certificat de cession est introuvable sur le serveur.");
    error.codeName = 'certificate.template_missing';
    throw error;
  }

  const pdf = await PDFDocument.load(fs.readFileSync(TEMPLATE_PATH));
  const pages = pdf.getPages();
  const [page] = pages;

  // Les coordonnées sont relevées sur ce gabarit précis : un modèle différent les invaliderait.
  if (pages.length !== TEMPLATE_PAGE_COUNT
    || Math.round(pages[0].getWidth()) !== TEMPLATE_WIDTH
    || Math.round(pages[0].getHeight()) !== TEMPLATE_HEIGHT) {
    const error = new Error('Le gabarit du certificat de cession ne correspond pas au format attendu (Cerfa 15776*02, A4, 1 page).');
    error.codeName = 'certificate.template_mismatch';
    throw error;
  }

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

  const cededAt = transferredAt ? new Date(transferredAt) : new Date();
  const sellerStreet = splitStreet(seller?.address?.street);
  const buyerStreet = splitStreet(buyer?.address?.street);

  // --- Le véhicule ---
  write(LAYOUT.vehicle.registrationNumber, vehicle?.registrationNumber);
  write(LAYOUT.vehicle.vin, vehicle?.vin);
  write(LAYOUT.vehicle.firstRegistrationDate, vehicle?.firstRegistrationDate);
  write(LAYOUT.vehicle.brand, vehicle?.brand);
  write(LAYOUT.vehicle.type, vehicle?.engine);
  write(LAYOUT.vehicle.genre, vehicle?.vehicleGenre);
  write(LAYOUT.vehicle.commercialName, vehicle?.model);
  write(LAYOUT.vehicle.mileage, vehicle?.mileage != null ? `${vehicle.mileage} km` : '');
  // Présence du certificat d'immatriculation : la case OUI ou la case NON est cochée
  // selon la disponibilité de la carte grise. Une valeur inconnue ne coche rien plutôt
  // que d'affirmer une absence à tort.
  if (vehicle?.registrationCardAvailable === true) {
    check(LAYOUT.vehicle.registrationCardYes);
    if (vehicle.formulaNumber) {
      write(LAYOUT.vehicle.formulaNumber, vehicle.formulaNumber);
    }
  } else if (vehicle?.registrationCardAvailable === false) {
    check(LAYOUT.vehicle.registrationCardNo);
    if (vehicle.registrationCardMissingMotif) {
      write({ x: 339, y: 625 }, vehicle.registrationCardMissingMotif, 8); // Slightly below the NO checkbox, smaller font
    }
  }

  // --- Ancien propriétaire (le vendeur) ---
  check(LAYOUT.seller.legalEntity);
  write(LAYOUT.seller.name, seller?.companyName);
  write(LAYOUT.seller.siret, seller?.siret);
  write(LAYOUT.seller.streetNumber, sellerStreet.number);
  write(LAYOUT.seller.streetExtension, sellerStreet.extension);
  write(LAYOUT.seller.streetType, sellerStreet.type);
  write(LAYOUT.seller.streetName, sellerStreet.name);
  write(LAYOUT.seller.postalCode, seller?.address?.postalCode);
  write(LAYOUT.seller.city, seller?.address?.city);
  check(LAYOUT.seller.transferCheckbox);
  write(LAYOUT.seller.transferDate, formatDate(cededAt));
  write(LAYOUT.seller.transferHour, padded(cededAt.getHours()));
  write(LAYOUT.seller.transferMinute, padded(cededAt.getMinutes()));
  check(LAYOUT.seller.certifyHandover);
  // La case « n'a pas subi de transformation notable » n'est délibérément pas cochée :
  // la plateforme n'est pas en mesure de l'attester à la place du vendeur.
  write(LAYOUT.seller.signedAt, seller?.address?.city);
  write(LAYOUT.seller.signedOn, formatDate(cededAt));

  // --- Nouveau propriétaire (l'acheteur) ---
  check(LAYOUT.buyer.legalEntity);
  write(LAYOUT.buyer.name, buyer?.companyName);
  write(LAYOUT.buyer.siret, buyer?.siret);
  write(LAYOUT.buyer.streetNumber, buyerStreet.number);
  write(LAYOUT.buyer.streetExtension, buyerStreet.extension);
  write(LAYOUT.buyer.streetType, buyerStreet.type);
  write(LAYOUT.buyer.streetName, buyerStreet.name);
  write(LAYOUT.buyer.postalCode, buyer?.address?.postalCode);
  write(LAYOUT.buyer.city, buyer?.address?.city);
  check(LAYOUT.buyer.certifyAcquire);
  check(LAYOUT.buyer.certifyInformed);
  write(LAYOUT.buyer.signedAt, buyer?.address?.city);
  write(LAYOUT.buyer.signedOn, formatDate(cededAt));

  // --- Insertion des tampons s'ils sont disponibles ---
  // Vendeur (Encadré "Ancien propriétaire" vers le bas de la section, y: 250)
  if (seller?.stampUrl) {
    await drawStamp(pdf, page, seller.stampUrl, { x: 78, y: 250 }, 150, 70);
  }
  
  // Acheteur (Encadré "Nouveau propriétaire" tout en bas du document, y: 15)
  if (buyer?.stampUrl) {
    await drawStamp(pdf, page, buyer.stampUrl, { x: 78, y: 15 }, 150, 50);
  }

  return Buffer.from(await pdf.save());
};

module.exports = {
  fillCertificateOfTransfer,
  drawStamp,
  splitStreet,
  TEMPLATE_PATH,
};
