require('dotenv').config();
const mongoose = require('mongoose');

const Sale = require('./models/sale.model');
const Offer = require('./models/offer.model');
const User = require('./models/user.model');
const VehicleDossier = require('./models/vehicleDossier.model');
const Session = require('./models/session.model');
const SessionConfig = require('./models/sessionConfig.model');

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to DB');

    // 1. Delete all offers
    const offersResult = await Offer.deleteMany({});
    console.log(`Deleted ${offersResult.deletedCount} offers.`);

    // 2. Delete all sales
    const salesResult = await Sale.deleteMany({});
    console.log(`Deleted ${salesResult.deletedCount} sales.`);

    // 3. Reset only the vehicle fields linked to sessions / sales.
    const vehiclesResult = await VehicleDossier.updateMany({}, {
      $set: {
        status: 'valide',
        session: null,
        lastListedSession: null,
        lotNumber: null,
        listingCount: 0,
      },
    });
    console.log(`Reset ${vehiclesResult.modifiedCount} vehicle sale states.`);

    // 4. Delete all sessions
    const sessionsResult = await Session.deleteMany({});
    console.log(`Deleted ${sessionsResult.deletedCount} sessions.`);

    // 5. Reset the user state left over by the sale flow : un acheteur suspendu pour
    //    un délai dépassé ou une annulation retrouve un compte 'valide' et perd la
    //    commission impayée qui le bloquait.
    const reactivatedResult = await User.updateMany(
      { status: { $in: ['suspendu', 'bloque'] } },
      { $set: { status: 'valide' } },
    );
    console.log(`Reactivated ${reactivatedResult.modifiedCount} suspended/blocked users.`);

    const commissionResult = await User.updateMany(
      { pendingCommission: { $exists: true } },
      { $unset: { pendingCommission: '' } },
    );
    console.log(`Cleared ${commissionResult.modifiedCount} pending commissions.`);

    // Prevent the running background job from recreating sessions immediately.
    await SessionConfig.updateMany({}, { $set: { autoGenerateWeeks: 0 } });
    console.log('Disabled automatic session generation.');

    await mongoose.disconnect();
    console.log('Done.');
  })
  .catch(err => {
    console.error(err);
    mongoose.disconnect();
    process.exitCode = 1;
  });
