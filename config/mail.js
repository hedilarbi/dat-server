const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true pour le port 465, false pour les autres ports
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
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
  try {
    const mailOptions = {
      from: `"DealAutoPro" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (error) {
    console.error(`Erreur d'envoi d'e-mail à ${to} : ${error.message}`);
    throw error;
  }
};

module.exports = { transporter, sendEmail };
