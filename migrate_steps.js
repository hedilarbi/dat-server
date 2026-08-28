require('dotenv').config();
const mongoose = require('mongoose');
const Sale = require('./models/sale.model');

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // Find sales that are active and currentStep >= 4
  const sales = await Sale.find({
    status: { $in: ['en_cours', 'en_attente_confirmation'] },
    currentStep: { $gte: 4 }
  });

  console.log(`Found ${sales.length} sales to migrate.`);

  for (const sale of sales) {
    sale.currentStep += 1;
    await sale.save();
    console.log(`Sale ${sale._id} currentStep migrated to ${sale.currentStep}`);
  }

  console.log('Migration completed.');
  process.exit(0);
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
