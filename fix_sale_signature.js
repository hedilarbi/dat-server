require('dotenv').config();
const mongoose = require('mongoose');
require('./models/user.model');
require('./models/vehicleDossier.model');
const Sale = require('./models/sale.model');
const { createSignatureSession } = require('./services/esignature.service');
const { fillPurchaseDeclaration } = require('./services/purchaseDeclaration.service');

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI);
  const sales = await Sale.find({}).sort({ createdAt: -1 }).limit(1).populate('seller winner vehicle');
  const sale = sales[0];
  const { fillCertificateOfTransfer } = require('./services/certificateOfTransfer.service');

  const pdfCert = await fillCertificateOfTransfer({
    vehicle: sale.vehicle,
    seller: { ...sale.seller.toObject(), stampUrl: null },
    buyer: { ...sale.winner.toObject(), stampUrl: null },
    transferredAt: new Date(),
  });

  const pdfDecl = await fillPurchaseDeclaration({
    vehicle: sale.vehicle,
    seller: { ...sale.seller.toObject(), stampUrl: null },
    buyer: { ...sale.winner.toObject(), stampUrl: null },
    purchasedAt: new Date(),
  });

  try {
    const signatureSession = await createSignatureSession({
      saleId: sale._id.toString(),
      seller: sale.seller,
      buyer: sale.winner,
      certificateBuffer: pdfCert,
      purchaseDeclarationBuffer: pdfDecl
    });

    const sellerSigner = signatureSession.signers?.find(s => s.email === sale.seller.email);
    const buyerSigner = signatureSession.signers?.find(s => s.email === sale.winner.email);

    sale.esignature = {
      operationId: signatureSession.id,
      status: signatureSession.state || 'WAIT_VALIDATION',
      sellerUrl: sellerSigner ? sellerSigner.url : null,
      buyerUrl: buyerSigner ? buyerSigner.url : null,
      initiatedAt: new Date()
    };

    sale.currentStep = 3;
    await sale.save();
    console.log("Fixed sale " + sale._id);
    console.log("Seller URL:", sale.esignature.sellerUrl);
  } catch (e) {
    console.error(e.message);
  }
  process.exit(0);
}
fix().catch(console.error);
