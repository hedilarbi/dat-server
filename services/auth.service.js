const User = require('../models/user.model');
const jwt = require('jsonwebtoken');
const { isValidPhoneNumber } = require('libphonenumber-js');
const { sendEmail } = require('../config/mail');
const { createAdminRegistrationNotification } = require('./notification.service');
const { normalizeLanguage, otpEmail, passwordResetEmail } = require('./emailTemplates.service');
const paymentService = require('./payment.service');
const { isStripeConfigured } = require('../config/stripe');
const Sale = require('../models/sale.model');
const Offer = require('../models/offer.model');
const generalConfigService = require('./generalConfig.service');

// SIRET : 14 chiffres (SIREN sur 9 + NIC sur 5)
const SIRET_REGEX = /^\d{14}$/;

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
 * Répare les dettes créées avant la distinction entre l'étape 1 et l'étape 2.
 * La liste d'attente conserve l'offre du candidat et le motif exact de son retrait.
 */
const normalizePendingCommission = async (user) => {
  if (!user?.pendingCommission?.saleId || !user.pendingCommission?.amount) return user;

  const sale = await Sale.findById(user.pendingCommission.saleId).select('waitingList').lean();
  const entry = sale?.waitingList?.find((candidate) => String(candidate.buyer) === String(user._id));
  if (!entry?.discardReason) return user;

  let reason;
  let amount;
  if (entry.discardReason.startsWith('virement_carte_grise')) {
    reason = 'penalite_etape_2';
    ({ accountReactivationFee: amount } = await generalConfigService.getConfig());
  } else if (entry.discardReason.startsWith('commission') || entry.discardReason === 'annulation_volontaire') {
    const offer = await Offer.findById(entry.offer).select('fees').lean();
    reason = 'commission_impayee';
    amount = Number(offer?.fees?.commission || 0) + Number(offer?.fees?.taxAmount || 0);
  }

  if (!reason || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return user;
  if (user.pendingCommission.reason !== reason || Number(user.pendingCommission.amount) !== Number(amount)) {
    user.pendingCommission.reason = reason;
    user.pendingCommission.amount = Number(amount);
    await user.save();
  }
  return user;
};

/**
 * Service pour l'étape 1 de l'inscription
 */
const registerStep1 = async (userData) => {
  const { email, password, firstName, lastName, companyName, activityType, phone, role } = userData;
  const language = normalizeLanguage(userData.language);

  // 1. Vérifier l'unicité de l'e-mail, de la raison sociale et du téléphone
  const userExists = await User.findOne({ email });
  if (userExists) {
    const err = new Error('Cet e-mail est déjà utilisé par un autre compte.');
    err.codeName = 'auth.email_already_exists';
    throw err;
  }

  if (companyName) {
    const escapedCompany = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const companyExists = await User.findOne({ companyName: new RegExp(`^${escapedCompany}$`, 'i') });
    if (companyExists) {
      const err = new Error('Cette raison sociale (nom d’entreprise) est déjà enregistrée par un autre compte.');
      err.codeName = 'auth.company_name_already_exists';
      throw err;
    }
  }

  if (phone) {
    const phoneExists = await User.findOne({ phone: phone.trim() });
    if (phoneExists) {
      const err = new Error('Ce numéro de téléphone est déjà utilisé par un autre compte.');
      err.codeName = 'auth.phone_already_exists';
      throw err;
    }
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

  await normalizePendingCommission(user);

  if (user.status === 'refuse') {
    const err = new Error('Votre inscription a été définitivement refusée. Veuillez contacter le support.');
    err.codeName = 'auth.registration_refused';
    throw err;
  }

  const { firstName, lastName, companyName, activityType, phone, address, siret, kbisUrl, cinRectoUrl, cinVersoUrl, vhuNumber, bankInfo, stampUrl } = profileData;

  // Validation des champs obligatoires pour l'étape 2
  if (!address || !address.street || !address.city || !address.country || !address.postalCode) {
    const err = new Error('L\'adresse complète est obligatoire.');
    err.codeName = 'auth.address_missing';
    throw err;
  }

  if (!siret) {
    const err = new Error('Le numéro SIRET est obligatoire.');
    err.codeName = 'auth.siret_missing';
    throw err;
  }

  const cleanSiret = siret.replace(/\s/g, '');
  if (!SIRET_REGEX.test(cleanSiret)) {
    const err = new Error('Le numéro SIRET doit contenir exactement 14 chiffres.');
    err.codeName = 'auth.siret_invalid';
    throw err;
  }

  const existingSiret = await User.findOne({ siret: cleanSiret, _id: { $ne: user._id } });
  if (existingSiret) {
    const err = new Error('Ce numéro SIRET est déjà enregistré par un autre compte.');
    err.codeName = 'auth.siret_already_exists';
    throw err;
  }

  if (companyName && companyName.trim() !== user.companyName) {
    const escapedCompany = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const companyExists = await User.findOne({
      companyName: new RegExp(`^${escapedCompany}$`, 'i'),
      _id: { $ne: user._id }
    });
    if (companyExists) {
      const err = new Error('Cette raison sociale (nom d’entreprise) est déjà enregistrée par un autre compte.');
      err.codeName = 'auth.company_name_already_exists';
      throw err;
    }
  }

  if (phone && phone.trim() !== user.phone) {
    const phoneExists = await User.findOne({ phone: phone.trim(), _id: { $ne: user._id } });
    if (phoneExists) {
      const err = new Error('Ce numéro de téléphone est déjà utilisé par un autre compte.');
      err.codeName = 'auth.phone_already_exists';
      throw err;
    }
  }

  if (phone && !isValidPhoneNumber(phone)) {
    const err = new Error('Le format du numéro de téléphone est invalide.');
    err.codeName = 'auth.phone_invalid';
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
  user.siret = siret.replace(/\s/g, '');
  user.kbisUrl = kbisUrl;
  // Le tampon est facultatif : une valeur absente ne doit pas effacer celui déjà déposé
  if (stampUrl !== undefined) user.stampUrl = stampUrl;
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

/**
 * Enregistre (ou remplace) le tampon d'un compte déjà inscrit.
 *
 * L'image a déjà été détourée par POST /api/upload/stamp : on ne stocke ici que l'URL
 * du PNG transparent produit. Une chaîne vide permet de retirer le tampon.
 */
const updateStamp = async (userId, stampUrl) => {
  const user = await User.findById(userId);

  if (!user) {
    const err = new Error('Utilisateur introuvable.');
    err.codeName = 'auth.user_not_found';
    throw err;
  }

  const normalized = typeof stampUrl === 'string' ? stampUrl.trim() : '';
  if (normalized && !/^https?:\/\//i.test(normalized)) {
    const err = new Error('URL de tampon invalide.');
    err.codeName = 'auth.invalid_stamp_url';
    err.statusCode = 400;
    throw err;
  }

  user.stampUrl = normalized;
  await user.save();

  const userObj = user.toObject();
  delete userObj.password;
  delete userObj.otp;

  return userObj;
};

const startPendingCommissionPayment = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.pendingCommission?.amount) {
    throw new Error('Aucune commission en attente.');
  }
  await normalizePendingCommission(user);
  if (!isStripeConfigured()) throw new Error('Paiement indisponible (Stripe non configuré).');

  const { session, amount } = await paymentService.createPendingCommissionCheckout({
    amount: user.pendingCommission.amount,
    reason: user.pendingCommission.reason,
    user,
    language: user.language
  });

  return { clientSecret: session.client_secret, amount };
};

const startPendingCommissionIntent = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !user.pendingCommission?.amount) {
    throw new Error('Aucune commission en attente.');
  }
  await normalizePendingCommission(user);
  if (!isStripeConfigured()) throw new Error('Paiement indisponible (Stripe non configuré).');

  return paymentService.createPendingCommissionPaymentIntent({
    amount: user.pendingCommission.amount,
    reason: user.pendingCommission.reason,
    user
  });
};

const confirmPendingCommissionPayment = async (userId, checkoutSessionId, paymentIntentId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('Utilisateur introuvable.');
  if (!user.pendingCommission?.amount) {
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.otp;
    return userObj; // Déjà réglée
  }
  await normalizePendingCommission(user);

  if (!checkoutSessionId && !paymentIntentId) {
    const debtSale = user.pendingCommission.saleId
      ? await Sale.findById(user.pendingCommission.saleId).select('waitingList').lean()
      : null;
    const discardedAt = debtSale?.waitingList?.find((entry) => String(entry.buyer) === String(userId))?.discardedAt;
    const candidates = await paymentService.findPaidPendingCommissionIntents(
      userId, user.pendingCommission.amount, user.pendingCommission.reason || 'commission_impayee',
      user.pendingCommission.saleId, discardedAt
    );
    const Payment = require('../models/payment.model');
    for (const candidateId of candidates) {
      if (!await Payment.exists({ stripePaymentIntentId: candidateId, status: 'paye' })) {
        paymentIntentId = candidateId;
        break;
      }
    }
    if (!paymentIntentId) {
      throw paymentService.paymentError('Aucun paiement confirmé trouvé.', 'payment.not_found', 404);
    }
  }
  const payment = paymentIntentId
    ? await paymentService.retrievePendingCommissionPaymentIntent(paymentIntentId)
    : await paymentService.retrieveCommissionCheckout(checkoutSessionId);
  if (payment.purpose !== 'pending_commission' || String(payment.userId) !== String(userId)) {
    const err = new Error('Session de paiement invalide.');
    err.codeName = 'payment.invalid_session';
    err.statusCode = 400;
    throw err;
  }
  if (paymentIntentId && (payment.debtReason !== (user.pendingCommission.reason || 'commission_impayee')
    || (payment.saleId && String(payment.saleId) !== String(user.pendingCommission.saleId)))) {
    throw paymentService.paymentError('Paiement lié à une autre dette.', 'payment.invalid_debt', 400);
  }
  if (!payment.paid) {
    const err = new Error('Paiement non abouti.');
    err.codeName = 'payment.not_paid';
    err.statusCode = 400;
    throw err;
  }
  const expectedAmount = paymentService.toMinorUnits(user.pendingCommission.amount);
  if (Number(payment.amount) !== expectedAmount || payment.currency !== 'eur') {
    const err = new Error('Le montant payé ne correspond pas à la commission due. Veuillez relancer le paiement.');
    err.codeName = 'payment.invalid_amount';
    err.statusCode = 400;
    throw err;
  }

  try {
    const Payment = require('../models/payment.model');
    await Payment.create({
      user: user._id,
      sale: user.pendingCommission?.saleId || null,
      type: 'reactivation_compte',
      debtReason: user.pendingCommission.reason || 'commission_impayee',
      amount: user.pendingCommission.amount,
      currency: 'eur',
      stripeSessionId: checkoutSessionId || null,
      stripePaymentIntentId: paymentIntentId || payment.paymentIntentId || null,
      mode: paymentIntentId ? 'payment_intent' : 'checkout',
      status: 'paye',
      paidAt: new Date(),
    });
  } catch (err) {
    console.error('Erreur enregistrement Payment réactivation:', err.message);
  }

  user.pendingCommission = undefined;
  if (user.status === 'suspendu') {
    user.status = 'valide';
  }
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
  updateStamp,
  normalizePendingCommission,
  startPendingCommissionPayment,
  startPendingCommissionIntent,
  confirmPendingCommissionPayment,
  generateToken
};
