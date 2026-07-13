const admin = require('firebase-admin');
const { getApps } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');

// On remplace les caractères '\\n' saisis dans le .env pour qu'ils soient correctement interprétés.
// On retire aussi d'éventuels guillemets englobants : contrairement à dotenv en local (qui les
// retire automatiquement en parsant le .env), l'UI de variables d'environnement de Vercel stocke
// la valeur telle quelle — un copier-coller de la ligne complète du .env (avec ses guillemets)
// laisse un caractère '"' au tout début/fin de la clé, ce qui invalide le PEM et fait échouer
// silencieusement toute opération Firebase Storage/Admin.
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.trim().replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n')
  : undefined;

if (privateKey && !privateKey.startsWith('-----BEGIN')) {
  console.warn("FIREBASE_PRIVATE_KEY ne ressemble pas à une clé PEM valide (elle ne commence pas par '-----BEGIN'). Vérifiez qu'aucun guillemet ou caractère superflu n'a été collé dans la variable d'environnement.");
}

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
  try {
    if (getApps().length === 0) {
      admin.initializeApp({
        credential: admin.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
    }
    console.log("Firebase Admin SDK initialisé avec succès.");
  } catch (error) {
    console.error(`Erreur d'initialisation Firebase Admin SDK : ${error.message}`);
  }
} else {
  console.warn("Firebase Admin SDK non configuré. Les uploads de fichiers seront indisponibles.");
}

const storageBucket = getApps().length > 0 ? getStorage().bucket() : null;

module.exports = { admin, storageBucket, getApps, getStorage };
