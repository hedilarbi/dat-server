require('dotenv').config();
const mongoose = require('mongoose');
require('./models/user.model');
require('./models/vehicleDossier.model');
const Sale = require('./models/sale.model');
const { createSignatureSession } = require('./services/esignature.service');

async function testApi() {
  await mongoose.connect(process.env.MONGODB_URI);
  const sales = await Sale.find({}).sort({ createdAt: -1 }).limit(1).populate('seller winner vehicle');
  const sale = sales[0];
  const { fillCertificateOfTransfer } = require('./services/certificateOfTransfer.service');
  const { generateBonEnlevement } = require('./services/handoverDocument.service');

  const pdf = await fillCertificateOfTransfer({
    vehicle: sale.vehicle,
    seller: { ...sale.seller.toObject(), stampUrl: null },
    buyer: { ...sale.winner.toObject(), stampUrl: null },
    transferredAt: new Date(),
  });
  const generatedBon = await generateBonEnlevement(sale, sale.vehicle, sale.seller, sale.winner);

  try {
    const rawResponse = await createSignatureSession({
      saleId: sale._id.toString(),
      seller: sale.seller,
      buyer: sale.winner,
      certificateBuffer: pdf,
      bonEnlevementBuffer: generatedBon.buffer
    });
    console.log("Raw Response Keys:", Object.keys(rawResponse));
    console.log("Raw Response id:", rawResponse.id);
    console.log("Raw Response data.id:", rawResponse.data?.id);
    console.log("Raw Response:", JSON.stringify(rawResponse, null, 2).substring(0, 500));
  } catch (e) {
    console.error(e.message);
  }
  process.exit(0);
}
testApi().catch(console.error);
