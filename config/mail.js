const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

let expoModulePromise = null;
const getExpoModule = async () => {
  if (!expoModulePromise) {
    expoModulePromise = import('expo-server-sdk');
  }
  return expoModulePromise;
};

const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
const smtpPassword = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpSecure = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE === 'true'
  : smtpPort === 465;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: smtpUser,
    pass: smtpPassword,
  },
});

// Vérification de la configuration d'envoi d'e-mails
transporter.verify((error, success) => {
  if (error) {
    console.error(`Erreur de configuration SMTP Nodemailer : ${error.message}`);
  } else {
    console.log("SMTP Nodemailer prêt à envoyer des e-mails.");
  }
});

/**
 * Fonction générique pour envoyer un e-mail
 * @param {string} to - Destinataire
 * @param {string} subject - Sujet
 * @param {string} text - Message texte brut
 * @param {string} html - Message HTML
 */
const sendEmail = async ({ to, subject, text, html }) => {
  if (!smtpUser || !smtpPassword) {
    const error = new Error('Configuration SMTP absente (SMTP_USER/SMTP_PASS ou GMAIL_USER/GMAIL_APP_PASSWORD).');
    error.code = 'SMTP_CONFIG_MISSING';
    throw error;
  }
  if (!to) {
    const error = new Error("L'adresse e-mail du destinataire est absente.");
    error.code = 'EMAIL_RECIPIENT_MISSING';
    throw error;
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || `"DealAutoPro" <${smtpUser}>`,
    to,
    subject,
    text,
    html,
  };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`E-mail accepté par le serveur SMTP pour ${to} (messageId=${info.messageId}, tentative=${attempt}).`);
      return info;
    } catch (error) {
      lastError = error;
      console.error(`Échec d'envoi d'e-mail à ${to} (tentative ${attempt}/3) : ${error.message}`);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }

  // Interceptor: Send Expo Push Notification if user has push token
  try {
    const User = mongoose.model('User');
    const user = await User.findOne({ email: to });
    if (user && user.expoPushToken) {
      const { Expo } = await getExpoModule();
      if (Expo.isExpoPushToken(user.expoPushToken)) {
        const expo = new Expo();
        const shortText = text ? text.substring(0, 150) + (text.length > 150 ? '...' : '') : 'Nouveau message de DealAutoPro';
        
        // Extract the first http/https URL from text
        const urlMatch = text ? text.match(/(https?:\/\/[^\s]+)/) : null;
        const pushUrl = urlMatch ? urlMatch[0] : null;
        
        await expo.sendPushNotificationsAsync([{
          to: user.expoPushToken,
          sound: 'default',
          title: subject,
          body: shortText,
          data: pushUrl ? { url: pushUrl } : {}
        }]);
        console.log(`Notification Push envoyée avec succès à ${to}`);
      }
    }
  } catch (pushErr) {
    console.error(`Erreur lors de l'envoi de la notification Push à ${to}:`, pushErr.message);
  }

  throw lastError;
};

module.exports = { transporter, sendEmail };
