const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { saveBuffer } = require('./storage.service');

const generateBonEnlevement = async (sale, vehicle, seller, buyer) => {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 50;
  let cursorY = height - margin;

  const drawText = (text, size, isBold = false, x = margin) => {
    const activeFont = isBold ? fontBold : font;
    page.drawText(text || '', {
      x,
      y: cursorY,
      size,
      font: activeFont,
      color: rgb(0, 0, 0),
    });
    cursorY -= (size + 10);
  };

  // Titre
  cursorY -= 20;
  page.drawText("BON D'ENLÈVEMENT", {
    x: width / 2 - 100,
    y: cursorY,
    size: 20,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  cursorY -= 40;

  // Date
  drawText(`Fait le : ${new Date().toLocaleDateString('fr-FR')}`, 12);
  cursorY -= 20;

  // Véhicule
  drawText("DÉSIGNATION DU VÉHICULE", 14, true);
  drawText(`Marque : ${vehicle.brand || ''}`, 12);
  drawText(`Modèle : ${vehicle.model || ''}`, 12);
  drawText(`Année : ${vehicle.year || ''}`, 12);
  drawText(`Numéro de série (VIN) : ${vehicle.vin || ''}`, 12);
  drawText(`Immatriculation : ${vehicle.registrationNumber || ''}`, 12);
  cursorY -= 20;

  // Vendeur
  drawText("VENDEUR", 14, true);
  drawText(`Nom / Société : ${seller.companyName || seller.firstName + ' ' + seller.lastName}`, 12);
  drawText(`Adresse : ${seller.address || ''}`, 12);
  if (seller.siret) drawText(`SIRET : ${seller.siret}`, 12);
  cursorY -= 20;

  // Acheteur
  drawText("ACHETEUR", 14, true);
  drawText(`Nom / Société : ${buyer.companyName || buyer.firstName + ' ' + buyer.lastName}`, 12);
  drawText(`Adresse : ${buyer.address || ''}`, 12);
  if (buyer.siret) drawText(`SIRET : ${buyer.siret}`, 12);
  cursorY -= 30;

  // Déclaration
  const declarationText = `Je soussigné, ${buyer.companyName || buyer.firstName + ' ' + buyer.lastName}, déclare avoir pris livraison\ndu véhicule désigné ci-dessus, et en assumer l'entière responsabilité à compter de ce jour.`;
  page.drawText(declarationText, {
    x: margin,
    y: cursorY,
    size: 12,
    font,
    color: rgb(0, 0, 0),
    lineHeight: 16
  });
  cursorY -= 60;

  // Signatures
  drawText("Signature du vendeur :", 12, true, margin);
  drawText("Signature de l'acheteur :", 12, true, width / 2 + 20);

  // Sauvegarder
  const pdfBytes = await pdfDoc.save();
  const filename = `ventes/bon-enlevement/${sale._id}_bon-enlevement.pdf`;
  const stored = await saveBuffer({ buffer: Buffer.from(pdfBytes), filename, contentType: 'application/pdf' });

  return {
    url: stored.url,
    filename: stored.filename,
    buffer: Buffer.from(pdfBytes)
  };
};

module.exports = {
  generateBonEnlevement
};
