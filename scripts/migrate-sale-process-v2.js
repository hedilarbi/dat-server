/**
 * Passage des ventes existantes au nouveau processus (étapes 1, 2, 3.1, 3.2, 3.3).
 *
 *   node scripts/migrate-sale-process-v2.js           affiche ce qui serait modifié
 *   node scripts/migrate-sale-process-v2.js --apply   applique les modifications
 *
 * - Ventes en cours au-delà du virement (anciennes étapes 3 à 8) : elles reprennent au début de
 *   l'étape 3.1 ; les documents, la vérification et la signature de l'ancien circuit sont effacés.
 * - Ventes clôturées ou annulées avec un numéro d'étape de l'ancien circuit (6 à 8) : ramenées à
 *   la dernière étape (3.3), pour rester valides au regard du modèle.
 * - Champs de l'ancien circuit (remise par code, refus de certificats) retirés de toutes les ventes.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Sale = require('../models/sale.model');

const APPLY = process.argv.includes('--apply');
const LAST_STEP = Sale.PURCHASE_STEPS.length;
const PREPARATION_STEP = Sale.PURCHASE_STEPS.indexOf('preparation_documents') + 1;

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const collection = Sale.collection;

  const ongoing = await collection.find({ status: 'en_cours', currentStep: { $gte: PREPARATION_STEP } })
    .project({ currentStep: 1 }).toArray();
  const beyondLastStep = await collection.find({ status: { $ne: 'en_cours' }, currentStep: { $gt: LAST_STEP } })
    .project({ currentStep: 1, status: 1 }).toArray();
  const withLegacyFields = await collection.countDocuments({ $or: [{ handover: { $exists: true } }, { 'certificate.rejections': { $exists: true } }] });

  console.log(`Ventes en cours ramenées à l'étape 3.1 : ${ongoing.length}`);
  ongoing.forEach((sale) => console.log(`  ${sale._id} (ancienne étape ${sale.currentStep})`));
  console.log(`Ventes terminées ramenées à l'étape ${LAST_STEP} : ${beyondLastStep.length}`);
  beyondLastStep.forEach((sale) => console.log(`  ${sale._id} (${sale.status}, ancienne étape ${sale.currentStep})`));
  console.log(`Ventes portant des champs de l'ancien circuit : ${withLegacyFields}`);

  if (!APPLY) {
    console.log('\nAucune modification (relancer avec --apply pour appliquer).');
    return;
  }

  const now = new Date();
  if (ongoing.length) {
    await collection.updateMany({ _id: { $in: ongoing.map((sale) => sale._id) } }, {
      $set: {
        currentStep: PREPARATION_STEP,
        currentStepStartedAt: now,
        currentStepDueAt: null,
        stepRemindersSent: [],
        registrationCardSubmittedAt: null,
        documentsReview: { version: 0, correctionOpen: false, seller: null, buyer: null, history: [] },
      },
      $unset: { certificate: '', purchaseDeclaration: '', esignature: '', bonEnlevement: '' },
    });
  }
  if (beyondLastStep.length) {
    await collection.updateMany({ _id: { $in: beyondLastStep.map((sale) => sale._id) } }, { $set: { currentStep: LAST_STEP } });
  }
  await collection.updateMany({}, { $unset: { handover: '', 'certificate.rejections': '', 'certificate.lastRejection': '', 'certificate.rejectionCount': '' } });
  console.log('\nModifications appliquées.');
};

run()
  .catch((error) => {
    console.error('Migration impossible :', error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
