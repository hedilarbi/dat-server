const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const { sendEmail } = require('../config/mail');
const { createAdminRegistrationNotification } = require('./notification.service');
const { normalizeLanguage, otpEmail, passwordResetEmail } = require('./emailTemplates.service');

/**
 * Génère un code OTP à 6 chiffres
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Génère un token JWT
 * @param {string} userId 
 */
const generateToken = (userId) => {
  const jwtSecret = process.env.JWT_SECRET || 'dealautopro_secret_jwt_key';
  return jwt.sign({ id: userId }, jwtSecret, {
    expiresIn: '30d', // Valide pendant 30 jours
  });
};

/**
 * Service pour l'étape 1 de l'inscription
 */
const registerStep1 = async (userData) => {
  const { email, password, firstName, lastName, companyName, activityType, phone, role } = userData;
  const language = normalizeLanguage(userData.language);

  // 1. Vérifier si l'utilisateur existe déjà
  const userExists = await User.findOne({ email });
  if (userExists) {
    const err = new Error('Cet e-mail est déjà utilisé.');
    err.codeName = 'auth.email_already_exists';
    throw err;
  }

  // 2. Générer l'OTP et sa date d'expiration (15 minutes)
  const otpCode = generateOTP();
  const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

  // 3. Créer l'utilisateur en statut brouillon
  const user = new User({
    email,
    password,
    firstName,
    lastName,
    companyName,
    activityType,
    phone,
    role: role || 'acheteur',
    language,
    status: 'brouillon',
    emailVerified: false,
    otp: {
      code: otpCode,
      expiresAt: otpExpires
    }
  });

  await user.save();

  // 4. Envoyer l'OTP par e-mail
  try {
    await sendEmail({
      to: user.email,
      ...otpEmail({ language, firstName, lastName, otpCode })
    });
  } catch (emailError) {
    console.error(`Échec d'envoi du mail d'inscription : ${emailError.message}`);
    // On ne bloque pas l'inscription si l'email échoue en dev, mais on l'indique dans les logs
  }

  // Retourner l'utilisateur sans le mot de passe ni l'otp dans l'objet de réponse
  const userResponse = user.toObject();
  delete userResponse.password;
  delete userResponse.otp;

  return userResponse;
};

/**
 * Service de renvoi de l'OTP
 */
const resendOtp = async (email) => {
  const user = await User.findOne({ email });
  if (!user) {
    const err = new Error('Aucun utilisateur trouvé avec cet e-mail.');
    err.codeName = 'auth.user_not_found';
    throw err;
  }

  if (user.emailVerified) {
    const err = new Error('Cet e-mail est déjà vérifié.');
    err.codeName = 'auth.already_verified';
    throw err;
  }

  const otpCode = generateOTP();
  const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

  user.otp = {
    code: otpCode,
    expiresAt: otpExpires
  };

  await user.save();

  await sendEmail({
    to: user.email,
    ...otpEmail({
      language: user.language,
      firstName: user.firstName,
      lastName: user.lastName,
      otpCode,
      resend: true
    })
  });

  return { message: 'Nouveau code OTP envoyé.' };
};

/**
 * Service pour valider l'OTP
 */
const verifyOtp = async (email, code) => {
  const user = await User.findOne({ email });
  if (!user) {
    const err = new Error('Aucun utilisateur trouvé avec cet e-mail.');
    err.codeName = 'auth.user_not_found';
    throw err;
  }

  // Vérifier si déjà vérifié
  if (user.emailVerified) {
    const token = generateToken(user._id);
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.otp;
    return { user: userObj, token };
  }

  // Vérifier le code et l'expiration
  if (!user.otp || user.otp.code !== code) {
    const err = new Error('Code de vérification invalide.');
    err.codeName = 'auth.invalid_otp';
    throw err;
  }

  if (user.otp.expiresAt < new Date()) {
    const err = new Error('Le code de vérification a expiré.');
    err.codeName = 'auth.expired_otp';
    throw err;
  }

  // Valider l'e-mail
  user.emailVerified = true;
  user.otp = undefined; // Effacer le code OTP utilisé
  await user.save();

  const token = generateToken(user._id);

  const userObj = user.toObject();
  delete userObj.password;

  return { user: userObj, token };
};

/**
 * Service pour l'étape 2 : Profil complet et téléversement documents
 */
const registerStep2 = async (userId, profileData) => {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.codeName = 'auth.user_not_found';
    throw err;
  }

  if (!user.emailVerified) {
    const err = new Error('Veuillez d\'abord valider votre adresse e-mail.');
    err.codeName = 'auth.email_not_verified';
    throw err;
  }

  if (user.status === 'refuse') {
    const err = new Error('Votre inscription a été définitivement refusée. Veuillez contacter le support.');
    err.codeName = 'auth.registration_refused';
    throw err;
  }

  const { firstName, lastName, companyName, activityType, phone, address, kbisNumber, kbisUrl, cinRectoUrl, cinVersoUrl, vhuNumber, bankInfo } = profileData;

  // Validation des champs obligatoires pour l'étape 2
  if (!address || !address.street || !address.city || !address.country || !address.postalCode) {
    const err = new Error('L\'adresse complète est obligatoire.');
    err.codeName = 'auth.address_missing';
    throw err;
  }

  if (!kbisNumber) {
    const err = new Error('Le numéro de K-bis est obligatoire.');
    err.codeName = 'auth.kbis_number_missing';
    throw err;
  }

  if (!kbisUrl || !cinRectoUrl || !cinVersoUrl) {
    const err = new Error('Le document K-bis et la carte d\'identité (recto/verso) sont obligatoires.');
    err.codeName = 'auth.documents_missing';
    throw err;
  }

  // Si l'utilisateur est un vendeur, les infos bancaires sont obligatoires
  if (user.role === 'vendeur') {
    const ribRequired = user.status === 'brouillon';

    if (!bankInfo || !bankInfo.bankName || !bankInfo.accountHolder || !bankInfo.iban || !bankInfo.bic || (ribRequired && !bankInfo.ribUrl)) {
      const err = new Error('Les coordonnées bancaires complètes sont obligatoires pour un vendeur.');
      err.codeName = 'auth.bank_info_missing';
      throw err;
    }

    user.bankInfo = {
      bankName: bankInfo.bankName,
      accountHolder: bankInfo.accountHolder,
      iban: bankInfo.iban,
      bic: bankInfo.bic,
      ribUrl: bankInfo.ribUrl || user.bankInfo?.ribUrl
    };
    
    // VHU optionnel ou requis selon le profil (ici requis si spécifié dans l'activité ou optionnel)
    if (vhuNumber) {
      user.vhuNumber = vhuNumber;
    }
  }

  // Mettre à jour les informations professionnelles (email et mot de passe restent inchangeables ici)
  if (firstName) user.firstName = firstName;
  if (lastName) user.lastName = lastName;
  if (companyName) user.companyName = companyName;
  if (activityType) user.activityType = activityType;
  if (phone) user.phone = phone;

  // Mettre à jour l'utilisateur
  user.address = address;
  user.kbisNumber = kbisNumber;
  user.kbisUrl = kbisUrl;
  user.cinRectoUrl = cinRectoUrl;
  user.cinVersoUrl = cinVersoUrl;
  user.status = 'soumis'; // Passe à soumis pour validation par l'admin

  await user.save();
  await createAdminRegistrationNotification(user);

  const userObj = user.toObject();
  delete userObj.password;

  return userObj;
};

/**
 * Service de connexion (Login)
 */
const login = async (email, password, role) => {
  // Trouver l'utilisateur
  const user = await User.findOne({ email });
  if (!user) {
    const err = new Error('E-mail ou mot de passe incorrect.');
    err.codeName = 'auth.invalid_credentials';
    throw err;
  }

  // Vérifier le mot de passe
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const err = new Error('E-mail ou mot de passe incorrect.');
    err.codeName = 'auth.invalid_credentials';
    throw err;
  }

  // Chaque espace de connexion (acheteur / vendeur) ne doit accepter que les comptes du rôle
  // correspondant. Le paramètre role est optionnel pour ne pas affecter la connexion admin,
  // qui appelle ce même service sans le transmettre.
  if (role && user.role !== role) {
    const err = new Error('Ce compte ne correspond pas à cet espace de connexion.');
    err.codeName = 'auth.role_mismatch';
    throw err;
  }

  // Vérifier le statut du compte
  if (user.status === 'suspendu') {
    const err = new Error('Votre compte est suspendu. Veuillez contacter le support.');
    err.codeName = 'auth.account_suspended';
    throw err;
  }

  if (user.status === 'bloque') {
    const err = new Error('Votre compte est bloqué. Veuillez contacter le support.');
    err.codeName = 'auth.account_blocked';
    throw err;
  }

  // Si l'e-mail n'est pas vérifié, on refuse la connexion et on signale qu'il faut valider l'e-mail
  if (!user.emailVerified) {
    const err = new Error('Veuillez d\'abord valider votre adresse e-mail.');
    err.codeName = 'auth.email_not_verified';
    throw err;
  }

  // Générer le token
  const token = generateToken(user._id);

  const userObj = user.toObject();
  delete userObj.password;

  return { user: userObj, token };
};

/**
 * Demande de réinitialisation de mot de passe : génère et envoie un OTP
 */
const forgotPassword = async (email) => {
  const user = await User.findOne({ email });
  if (!user) {
    const err = new Error('Aucun utilisateur trouvé avec cet e-mail.');
    err.codeName = 'auth.user_not_found';
    throw err;
  }

  const otpCode = generateOTP();
  const otpExpires = new Date(Date.now() + 15 * 60 * 1000);

  user.otp = {
    code: otpCode,
    expiresAt: otpExpires
  };
  await user.save();

  await sendEmail({
    to: user.email,
    ...passwordResetEmail({
      language: user.language,
      firstName: user.firstName,
      lastName: user.lastName,
      otpCode
    })
  });

  return { message: 'Code de réinitialisation envoyé par e-mail.' };
};

/**
 * Réinitialise le mot de passe après validation du code OTP
 */
const resetPassword = async (email, code, newPassword) => {
  const user = await User.findOne({ email });
  if (!user) {
    const err = new Error('Aucun utilisateur trouvé avec cet e-mail.');
    err.codeName = 'auth.user_not_found';
    throw err;
  }

  if (!user.otp || user.otp.code !== code) {
    const err = new Error('Code de vérification invalide.');
    err.codeName = 'auth.invalid_otp';
    throw err;
  }

  if (user.otp.expiresAt < new Date()) {
    const err = new Error('Le code de vérification a expiré.');
    err.codeName = 'auth.expired_otp';
    throw err;
  }

  user.password = newPassword;
  user.otp = undefined;
  await user.save();

  const token = generateToken(user._id);

  const userObj = user.toObject();
  delete userObj.password;

  return { user: userObj, token };
};

/**
 * Mettre à jour la langue préférée de l'utilisateur connecté
 */
const updateLanguage = async (userId, language) => {
  const normalizedLanguage = normalizeLanguage(language);
  const user = await User.findById(userId);

  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.codeName = 'auth.user_not_found';
    throw err;
  }

  user.language = normalizedLanguage;
  await user.save();

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.otp;

  return userObj;
};

module.exports = {
  registerStep1,
  resendOtp,
  verifyOtp,
  registerStep2,
  login,
  forgotPassword,
  resetPassword,
  updateLanguage,
  generateToken
};
