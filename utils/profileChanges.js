/**
 * Modifications de profil mises de côté (`user.pendingProfile.changes`) en attendant la décision de
 * l'administration. Le profil validé reste celui en vigueur ; les modifications ne s'y intègrent
 * qu'à l'approbation.
 *
 * `changes` ne contient que les champs réellement modifiés. `address` et `bankInfo` sont conservés
 * en entier dès qu'un de leurs sous-champs change.
 */

const SIMPLE_FIELDS = ['firstName', 'lastName', 'companyName', 'activityType', 'phone', 'siret', 'kbisUrl', 'cinRectoUrl', 'cinVersoUrl', 'vhuNumber', 'stampUrl'];
const ADDRESS_FIELDS = ['street', 'postalCode', 'city', 'country'];
const BANK_FIELDS = ['bankName', 'accountHolder', 'iban', 'bic', 'ribUrl'];

const clean = (value) => (value === null || value === undefined ? '' : String(value).trim());
const plain = (value) => (value && typeof value.toObject === 'function' ? value.toObject() : (value || {}));

/** Champs de `proposed` qui diffèrent de ceux du compte. Un champ absent de `proposed` est ignoré. */
const buildProfileChanges = (user, proposed) => {
  const changes = {};

  for (const field of SIMPLE_FIELDS) {
    if (proposed[field] === undefined) continue;
    if (clean(proposed[field]) !== clean(user[field])) changes[field] = proposed[field];
  }

  const compareGroup = (field, keys) => {
    if (!proposed[field]) return;
    const current = plain(user[field]);
    if (keys.some((key) => clean(proposed[field][key]) !== clean(current[key]))) {
      changes[field] = Object.fromEntries(keys.map((key) => [key, proposed[field][key] ?? current[key]]));
    }
  };
  compareGroup('address', ADDRESS_FIELDS);
  compareGroup('bankInfo', BANK_FIELDS);

  return changes;
};

/** Intègre les modifications au compte (sans l'enregistrer). */
const applyProfileChanges = (user, changes) => {
  for (const field of SIMPLE_FIELDS) {
    if (changes[field] !== undefined) user[field] = changes[field];
  }
  if (changes.address) user.address = { ...plain(user.address), ...changes.address };
  if (changes.bankInfo) user.bankInfo = { ...plain(user.bankInfo), ...changes.bankInfo };
};

/** Vue « avant → après » de chaque champ modifié, pour l'administration. */
const describeProfileChanges = (user, changes) => {
  const rows = [];
  for (const field of SIMPLE_FIELDS) {
    if (changes[field] !== undefined) rows.push({ field, before: clean(user[field]), after: clean(changes[field]) });
  }
  const group = (field, keys) => {
    if (!changes[field]) return;
    const current = plain(user[field]);
    for (const key of keys) {
      if (clean(changes[field][key]) !== clean(current[key])) rows.push({ field: `${field}.${key}`, before: clean(current[key]), after: clean(changes[field][key]) });
    }
  };
  group('address', ADDRESS_FIELDS);
  group('bankInfo', BANK_FIELDS);
  return rows;
};

module.exports = { buildProfileChanges, applyProfileChanges, describeProfileChanges };
