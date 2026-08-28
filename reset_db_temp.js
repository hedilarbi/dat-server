require('dotenv').config();
const mongoose = require('mongoose');

const Sale = require('./models/sale.model');
const Offer = require('./models/offer.model');
const VehicleDossier = require('./models/vehicleDossier.model');
const Session = require('./models/session.model');
const User = require('./models/user.model');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to DB');

    // 1. Delete all offers
    const offersResult = await Offer.deleteMany({});
    console.log(`Deleted ${offersResult.deletedCount} offers.`);

    // 2. Delete all sales
    const salesResult = await Sale.deleteMany({});
    console.log(`Deleted ${salesResult.deletedCount} sales.`);

    // 3. Reset vehicle dossiers to 'valide'
    const vehiclesResult = await VehicleDossier.updateMany({}, { status: 'valide' });
    console.log(`Reset ${vehiclesResult.modifiedCount} vehicles to "valide".`);

    // 4. Delete all sessions
    const sessionsResult = await Session.deleteMany({});
    console.log(`Deleted ${sessionsResult.deletedCount} sessions.`);

    // 5. Reactivate all suspended users to 'valide' and clear pending commission
    const userResult = await User.updateMany(
      { status: 'suspendu' },
      { status: 'valide', $unset: { pendingCommission: 1 } }
    );
    console.log(`Reactivated ${userResult.modifiedCount} suspended accounts to 'valide'.`);

    // 6. Also clear pending commission for any other users
    const clearCommissionResult = await User.updateMany(
      { pendingCommission: { $exists: true } },
      { $unset: { pendingCommission: 1 } }
    );
    console.log(`Cleared pending commissions for ${clearCommissionResult.modifiedCount} accounts.`);

    mongoose.disconnect();
    console.log('Done.');
  })
  .catch(err => {
    console.error(err);
    mongoose.disconnect();
  });
