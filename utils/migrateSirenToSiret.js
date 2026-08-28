const crypto = require('crypto');
const User = require('../models/user.model');

const SIRET_LENGTH = 14;

/**
 * Le champ `kbisNumber` portait un SIREN. Il devient `siret` (14 chiffres).
 *
 * Pour les comptes déjà inscrits, les chiffres existants sont conservés comme préfixe et
 * complétés par des chiffres tirés aléatoirement jusqu'à atteindre 14 — le numéro
 * d'établissement réel n'étant pas connu de la plateforme. Un SIREN de 9 chiffres reçoit
 * donc bien un NIC de 5 chiffres ; les valeurs plus courtes déjà en base (saisies avant que
 * la validation ne soit stricte) sont complétées d'autant que nécessaire.
 *
 * Ces SIRET sont syntaxiquement valides mais fictifs : ils devront être corrigés par
 * l'utilisateur ou l'administrateur.
 *
 * La lecture passe par le driver natif : `kbisNumber` ne fait plus partie du schéma Mongoose,
 * qui l'ignorerait silencieusement.
 */
const migrateSirenToSiret = async () => {
  const collection = User.collection;

  const legacy = await collection.find(
    {
      kbisNumber: { $nin: [null, ''] },
      $or: [{ siret: { $exists: false } }, { siret: null }, { siret: '' }],
    },
    { projection: { kbisNumber: 1 } },
  ).toArray();

  if (legacy.length === 0) return;

  let migrated = 0;
  for (const user of legacy) {
    const digits = String(user.kbisNumber).replace(/\D/g, '');
    if (!digits) {
      console.warn(`SIREN illisible pour l'utilisateur ${user._id} ("${user.kbisNumber}") : migration ignorée.`);
      continue;
    }

    const prefix = digits.slice(0, SIRET_LENGTH);
    const missing = SIRET_LENGTH - prefix.length;
    const suffix = missing > 0
      ? String(crypto.randomInt(0, 10 ** missing)).padStart(missing, '0')
      : '';

    await collection.updateOne(
      { _id: user._id },
      { $set: { siret: `${prefix}${suffix}` }, $unset: { kbisNumber: '' } },
    );
    migrated += 1;
  }

  if (migrated > 0) {
    console.log(`${migrated} compte(s) migré(s) de SIREN vers SIRET (numéro complété aléatoirement).`);
  }
};

module.exports = migrateSirenToSiret;
