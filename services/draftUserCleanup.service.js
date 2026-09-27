const cron = require('node-cron');
const User = require('../models/user.model');

const CLEANUP_SCHEDULE = process.env.DRAFT_USER_CLEANUP_CRON || '0 3 * * *';
const CLEANUP_TIMEZONE = process.env.DRAFT_USER_CLEANUP_TIMEZONE || 'Europe/Paris';

const deleteUnverifiedDraftUsers = async () => {
  const result = await User.deleteMany({
    status: 'brouillon',
    emailVerified: false
  });

  console.log(`[Nettoyage inscriptions] ${result.deletedCount} brouillon(s) non vérifié(s) supprimé(s).`);
  return result.deletedCount;
};

const scheduleDraftUserCleanup = () => cron.schedule(
  CLEANUP_SCHEDULE,
  () => {
    deleteUnverifiedDraftUsers().catch((error) => {
      console.error('[Nettoyage inscriptions] Échec du nettoyage :', error.message);
    });
  },
  { timezone: CLEANUP_TIMEZONE }
);

module.exports = {
  deleteUnverifiedDraftUsers,
  scheduleDraftUserCleanup
};
