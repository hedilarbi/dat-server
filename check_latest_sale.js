require('dotenv').config();
const mongoose = require('mongoose');
require('./models/user.model');
require('./models/vehicleDossier.model');
const Sale = require('./models/sale.model');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const sales = await Sale.find({}).sort({ createdAt: -1 }).limit(10);
  console.log(`Found ${sales.length} sales`);
  for (const sale of sales) {
    console.log(`Sale ${sale._id} created at ${sale.createdAt}, step: ${sale.currentStep}`);
  }
  process.exit(0);
}
check().catch(console.error);
