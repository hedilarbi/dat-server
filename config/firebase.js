const admin = require('firebase-admin');
const { getApps } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');

// On remplace les caractères '\\n' saisis dans le .env pour qu'ils soient correctement interprétés
const privateKey = process.env.FIREBASE_PRIVATE_KEY 
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
  : undefined;

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
