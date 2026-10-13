const axios = require('axios');
const IntegrationToken = require('../models/integrationToken.model');

/**
 * Jeton d'accès à l'API de signature électronique OpenAPI, renouvelé automatiquement.
 *
 * Les jetons OpenAPI expirent (48 h environ en sandbox, jusqu'à 1 an en production) et chaque
 * appel avec un jeton expiré répond 401 « Wrong Token » : les signatures s'arrêtent alors pour tous
 * les clients. Ce service garde le jeton en base et le renouvelle :
 *   1. avec le refresh token (PATCH /tokens/{token}, authentifié par ce refresh token) : renvoie
 *      un nouveau jeton et un nouveau refresh token avec les mêmes droits ;
 *   2. à défaut, en créant un nouveau jeton avec les identifiants du compte (e-mail + clé API),
 *      avec les mêmes droits que l'ancien.
 * Si le renouvellement est impossible, l'admin est alerté (au plus une fois toutes les 6 h).
 *
 * Variables d'environnement :
 *   ESIGNATURE_TOKEN             jeton initial (obligatoire)
 *   ESIGNATURE_REFRESH_TOKEN     refresh token du jeton initial (renouvellement 1)
 *   OPENAPI_ACCOUNT_EMAIL        e-mail du compte OpenAPI  } renouvellement 2
 *   ESIGNATURE_KEY               clé API du compte         }
 *   ESIGNATURE_TOKEN_TTL_SECONDS durée demandée à chaque renouvellement (30 jours par défaut)
 *   OPENAPI_OAUTH_URL            surcharge de l'URL du service OAuth (déduite de ESIGNATURE_BASE_URL)
 */

const KEY = 'esignature';
const REQUEST_TIMEOUT_MS = 15000;
// Renouvellement préventif quand il reste moins de 12 h
const RENEW_MARGIN_MS = 12 * 3600 * 1000;
const ALERT_INTERVAL_MS = 6 * 3600 * 1000;
const DEFAULT_TTL_SECONDS = 30 * 24 * 3600;

const oauthBaseUrl = () => {
  if (process.env.OPENAPI_OAUTH_URL) return process.env.OPENAPI_OAUTH_URL.replace(/\/+$/, '');
  const base = process.env.ESIGNATURE_BASE_URL || '';
  return /\/\/test\./i.test(base) ? 'https://test.oauth.openapi.com' : 'https://oauth.openapi.com';
};

const desiredTtl = () => Number(process.env.ESIGNATURE_TOKEN_TTL_SECONDS) || DEFAULT_TTL_SECONDS;
const basicAuth = () => {
  const email = process.env.OPENAPI_ACCOUNT_EMAIL?.trim();
  const key = process.env.ESIGNATURE_KEY?.trim();
  return email && key ? `Basic ${Buffer.from(`${email}:${key}`).toString('base64')}` : null;
};

const unwrap = (response) => response.data?.data ?? response.data;

/** Jeton enregistré ; initialisé depuis le .env, et réinitialisé si le .env a changé depuis. */
const loadRecord = async () => {
  const envToken = process.env.ESIGNATURE_TOKEN?.trim();
  let record = await IntegrationToken.findOne({ key: KEY });

  if (envToken && (!record || record.seededFrom !== envToken)) {
    record = await IntegrationToken.findOneAndUpdate(
      { key: KEY },
      {
        $set: {
          token: envToken,
          refreshToken: process.env.ESIGNATURE_REFRESH_TOKEN?.trim() || null,
          expireAt: null,
          seededFrom: envToken,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  }
  if (!record) throw new Error('ESIGNATURE_TOKEN manquant dans les variables d\'environnement');
  return record;
};

const canRenew = (record) => Boolean(record.refreshToken || basicAuth());

/** Alerte l'admin (limitée dans le temps) : sans renouvellement, plus aucune signature ne démarre. */
const alertAdmin = async (record, reason) => {
  try {
    if (record.lastAlertAt && Date.now() - record.lastAlertAt.getTime() < ALERT_INTERVAL_MS) return;
    const Notification = require('../models/notification.model');
    await Notification.create({
      recipientRole: 'admin',
      type: 'esignature_token_error',
      category: 'ventes',
      title: 'Signature électronique : jeton OpenAPI à renouveler',
      message: `${reason} Tant que ce n'est pas réglé, aucune signature ne peut démarrer ni se terminer.`,
    });
    await IntegrationToken.updateOne({ _id: record._id }, { $set: { lastAlertAt: new Date() } });
  } catch (error) {
    console.error(`Alerte admin (jeton de signature) impossible : ${error.message}`);
  }
};

const saveRenewed = async (record, data, source) => {
  const token = data?.token;
  if (!token) throw new Error('Réponse OpenAPI sans jeton.');
  await IntegrationToken.updateOne({ _id: record._id }, {
    $set: {
      token,
      refreshToken: data.refreshToken || null,
      expireAt: data.expireAt ? new Date(data.expireAt) : null,
      ...(Array.isArray(data.scopes) && data.scopes.length > 0 ? { scopes: data.scopes } : {}),
      renewedAt: new Date(),
    },
  });
  console.log(`Jeton de signature OpenAPI renouvelé (${source}), expire le ${data.expireAt || 'inconnu'}.`);
  return token;
};

const renewWithRefreshToken = async (record) => {
  const response = await axios.patch(
    `${oauthBaseUrl()}/tokens/${record.token}`,
    { ttl: desiredTtl() },
    { timeout: REQUEST_TIMEOUT_MS, headers: { Authorization: `Bearer ${record.refreshToken}`, 'Content-Type': 'application/json' } },
  );
  return saveRenewed(record, unwrap(response), 'refresh token');
};

const renewWithAccountCredentials = async (record) => {
  const auth = basicAuth();
  // Les droits du nouveau jeton sont ceux de l'ancien, relus sur le compte (aucune liste à maintenir)
  let scopes = record.scopes || [];
  try {
    if (scopes.length === 0) {
      const detail = await axios.get(`${oauthBaseUrl()}/tokens/${record.token}`, { timeout: REQUEST_TIMEOUT_MS, headers: { Authorization: auth } });
      scopes = unwrap(detail)?.scopes || [];
    }
  } catch (error) {
    // Jeton déjà supprimé côté OpenAPI : repli sur la liste fournie par l'environnement
  }
  if (scopes.length === 0 && process.env.ESIGNATURE_TOKEN_SCOPES) {
    scopes = process.env.ESIGNATURE_TOKEN_SCOPES.split(',').map((scope) => scope.trim()).filter(Boolean);
  }
  if (scopes.length === 0) throw new Error('droits de l\'ancien jeton introuvables (définir ESIGNATURE_TOKEN_SCOPES)');

  const response = await axios.post(
    `${oauthBaseUrl()}/tokens`,
    { name: 'DealAutoPro signature (renouvelé automatiquement)', scopes, ttl: desiredTtl() },
    { timeout: REQUEST_TIMEOUT_MS, headers: { Authorization: auth, 'Content-Type': 'application/json' } },
  );
  return saveRenewed(record, unwrap(response), 'identifiants du compte');
};

let renewing = null;

/**
 * Renouvelle le jeton. Plusieurs appels simultanés en échec partagent un seul renouvellement : un
 * refresh token ne sert qu'une fois (l'ancien jeton est supprimé).
 */
const renewAccessToken = (failedToken) => {
  if (!renewing) {
    renewing = (async () => {
      const record = await loadRecord();
      // Un autre appel a déjà renouvelé le jeton entre-temps
      if (failedToken && record.token !== failedToken) return record.token;

      if (!canRenew(record)) {
        await alertAdmin(record, 'Le jeton OpenAPI a expiré et aucun moyen de renouvellement n\'est configuré (ESIGNATURE_REFRESH_TOKEN, ou OPENAPI_ACCOUNT_EMAIL avec ESIGNATURE_KEY).');
        throw new Error('Jeton de signature expiré et renouvellement non configuré.');
      }

      const attempts = [];
      if (record.refreshToken) attempts.push(renewWithRefreshToken);
      if (basicAuth()) attempts.push(renewWithAccountCredentials);

      const errors = [];
      for (const attempt of attempts) {
        try {
          return await attempt(record);
        } catch (error) {
          errors.push(error.response?.data?.message || error.message);
        }
      }
      await alertAdmin(record, `Le renouvellement automatique du jeton OpenAPI a échoué (${errors.join(' ; ')}).`);
      throw new Error(`Renouvellement du jeton de signature impossible : ${errors.join(' ; ')}`);
    })().finally(() => { renewing = null; });
  }
  return renewing;
};

/** Jeton à utiliser pour un appel ; renouvelé d'avance s'il approche de son expiration. */
const getAccessToken = async () => {
  const record = await loadRecord();
  if (record.expireAt && record.expireAt.getTime() - Date.now() < RENEW_MARGIN_MS && canRenew(record)) {
    try {
      return await renewAccessToken(record.token);
    } catch (error) {
      console.error(`Renouvellement préventif du jeton de signature impossible : ${error.message}`);
    }
  }
  return record.token;
};

/**
 * Tâche de fond : renouvelle avant l'expiration. Pour un jeton saisi à la main, dont la date
 * d'expiration est inconnue, la relit sur le compte quand les identifiants sont disponibles.
 */
const ensureFreshToken = async () => {
  if (!process.env.ESIGNATURE_TOKEN && !(await IntegrationToken.exists({ key: KEY }))) return;
  const record = await loadRecord();
  if ((!record.expireAt || !(record.scopes || []).length) && basicAuth()) {
    try {
      const detail = await axios.get(`${oauthBaseUrl()}/tokens/${record.token}`, { timeout: REQUEST_TIMEOUT_MS, headers: { Authorization: basicAuth() } });
      const { expireAt, scopes } = unwrap(detail) || {};
      const update = {};
      if (expireAt) update.expireAt = new Date(expireAt);
      if (Array.isArray(scopes) && scopes.length > 0) update.scopes = scopes;
      if (Object.keys(update).length > 0) {
        await IntegrationToken.updateOne({ _id: record._id }, { $set: update });
        Object.assign(record, update);
      }
    } catch (error) {
      // Jeton déjà expiré ou illisible : le premier appel en 401 déclenchera le renouvellement
    }
  }
  if (record.expireAt && record.expireAt.getTime() - Date.now() < RENEW_MARGIN_MS) {
    await renewAccessToken(record.token);
  }
};

/**
 * Appel authentifié à l'API de signature. Un 401 (jeton expiré ou invalide) déclenche un
 * renouvellement, puis l'appel est rejoué une seule fois.
 */
const authorizedRequest = async (config) => {
  const send = (token) => axios({
    timeout: REQUEST_TIMEOUT_MS,
    ...config,
    headers: { ...(config.headers || {}), Authorization: `Bearer ${token}` },
  });

  const token = await getAccessToken();
  try {
    return await send(token);
  } catch (error) {
    if (error.response?.status !== 401) throw error;
    const renewed = await renewAccessToken(token);
    return send(renewed);
  }
};

module.exports = { authorizedRequest, getAccessToken, renewAccessToken, ensureFreshToken };
