const mongoose = require('mongoose');

/**
 * Compteurs incrémentaux partagés (numéros de lot, etc.).
 *
 * Un `findOneAndUpdate` avec `$inc` est atomique côté MongoDB : deux affectations
 * simultanées ne peuvent pas obtenir la même valeur, contrairement à un `max + 1` calculé
 * en deux temps.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

// Décalage appliqué à la lecture : le premier lot porte le numéro 12311. Un « lot #12311 »
// se lit et se dicte mieux qu'un « lot #1 », et la longueur reste stable très longtemps.
const LOT_NUMBER_START = 12310;

/**
 * Renvoie le prochain numéro de lot.
 *
 * Le décalage est ajouté APRÈS l'incrément, jamais écrit en base. Une version antérieure
 * amorçait le compteur par un second `$set` à valeur fixe lorsque la séquence était encore
 * basse : deux appels simultanés passaient alors tous les deux par cette branche et
 * recevaient le même numéro. Ici l'unicité ne repose que sur le `$inc` atomique.
 *
 * @returns {Promise<number>}
 */
const nextLotNumber = async () => {
  const counter = await Counter.findByIdAndUpdate(
    'lotNumber',
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );

  return LOT_NUMBER_START + counter.seq;
};

module.exports = Counter;
module.exports.nextLotNumber = nextLotNumber;
module.exports.LOT_NUMBER_START = LOT_NUMBER_START;
