const { isValidPhoneNumber } = require('libphonenumber-js');
const authService = require('../services/auth.service');


const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
  sameSite: 'lax',
};

/**
 * Inscription Étape 1 : Infos de base et génération OTP
 */
const registerStep1 = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, companyName, activityType, phone, role, language } = req.body;

    if (!email || !password || !firstName || !lastName || !companyName || !activityType || !phone) {
      return res.status(400).json({
        error: 'auth.validation_error',
        message: 'Tous les champs obligatoires doivent être renseignés.'
      });
    }

    if (!isValidPhoneNumber(phone)) {
      return res.status(400).json({
        error: 'auth.validation_error',
        message: 'Le format du numéro de téléphone est invalide.'
      });
    }

    const user = await authService.registerStep1({
      email,
      password,
      firstName,
      lastName,
      companyName,
      activityType,
      phone,
      role,
      language
    });

    res.status(201).json({
      success: true,
      message: 'Inscription Étape 1 réussie. Code de validation OTP envoyé par e-mail.',
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Renvoyer le code OTP
 */
const resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'auth.validation_error', message: 'L\'e-mail est obligatoire.' });
    }

    const result = await authService.resendOtp(email);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * Validation de l'OTP
 */
const verifyOtp = async (req, res, next) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        error: 'auth.validation_error',
        message: 'L\'adresse e-mail et le code OTP sont obligatoires.'
      });
    }

    const { user, token } = await authService.verifyOtp(email, code);

    // Stockage du token dans un cookie HTTP-Only sécurisé
    res.cookie('token', token, cookieOptions);

    res.status(200).json({
      success: true,
      message: 'Adresse e-mail vérifiée avec succès. Utilisateur connecté.',
      user,
      token // Retourner aussi au cas où le mobile n'utilise pas les cookies
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Inscription Étape 2 : Profil complet (Adresse et documents)
 */
const registerStep2 = async (req, res, next) => {
  try {
    // req.user est déjà défini par le middleware de protection d'authentification
    const userId = req.user._id;
    const { firstName, lastName, companyName, activityType, phone, address, siret, kbisUrl, cinRectoUrl, cinVersoUrl, vhuNumber, bankInfo, stampUrl } = req.body;

    const user = await authService.registerStep2(userId, {
      firstName,
      lastName,
      companyName,
      activityType,
      phone,
      address,
      siret,
      stampUrl,
      kbisUrl,
      cinRectoUrl,
      cinVersoUrl,
      vhuNumber,
      bankInfo
    });

    res.status(200).json({
      success: true,
      message: 'Inscription Étape 2 réussie. Votre dossier a été soumis pour validation administrative.',
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Connexion (Login)
 */
const login = async (req, res, next) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'auth.validation_error',
        message: 'L\'adresse e-mail et le mot de passe sont obligatoires.'
      });
    }

    const { user, token } = await authService.login(email, password, role);

    // Stockage du token dans un cookie HTTP-Only sécurisé
    res.cookie('token', token, cookieOptions);

    res.status(200).json({
      success: true,
      message: 'Connexion réussie.',
      user,
      token
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Demande de réinitialisation de mot de passe (envoi OTP)
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'auth.validation_error', message: 'L\'e-mail est obligatoire.' });
    }

    const result = await authService.forgotPassword(email);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * Réinitialisation du mot de passe via le code OTP
 */
const resetPassword = async (req, res, next) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
      return res.status(400).json({
        error: 'auth.validation_error',
        message: 'L\'e-mail, le code et le nouveau mot de passe sont obligatoires.'
      });
    }

    const { user, token } = await authService.resetPassword(email, code, newPassword);

    res.cookie('token', token, cookieOptions);

    res.status(200).json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès.',
      user,
      token
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Déconnexion (Logout)
 */
const logout = async (req, res, next) => {
  try {
    // Effacer le cookie
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    res.status(200).json({
      success: true,
      message: 'Déconnexion réussie.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Obtenir l'utilisateur connecté actuel (Me)
 */
const getMe = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      user: req.user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mettre à jour le Push Token de l'utilisateur
 */
const updatePushToken = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { pushToken } = req.body;
    
    const User = require('../models/user.model');
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    }
    
    user.expoPushToken = pushToken;
    await user.save();
    
    res.status(200).json({
      success: true,
      message: 'Push token mis à jour avec succès'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mettre à jour la langue préférée de l'utilisateur
 */
const updateLanguage = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { language } = req.body;

    const user = await authService.updateLanguage(userId, language);

    res.status(200).json({
      success: true,
      message: 'Langue mise à jour avec succès.',
      user
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mettre à jour le tampon de l'utilisateur connecté
 */
const updateStamp = async (req, res, next) => {
  try {
    const user = await authService.updateStamp(req.user._id, req.body.stampUrl);

    res.status(200).json({
      success: true,
      message: 'Tampon mis à jour avec succès.',
      user
    });
  } catch (error) {
    next(error);
  }
};

const startPendingCommissionPayment = async (req, res, next) => {
  try {
    const data = await authService.startPendingCommissionPayment(req.user._id);
    res.status(200).json({ success: true, ...data });
  } catch (error) {
    next(error);
  }
};

const startPendingCommissionIntent = async (req, res, next) => {
  try {
    const data = await authService.startPendingCommissionIntent(req.user._id);
    res.status(200).json({ success: true, ...data });
  } catch (error) {
    next(error);
  }
};

const confirmPendingCommissionPayment = async (req, res, next) => {
  try {
    const user = await authService.confirmPendingCommissionPayment(req.user._id, req.body.checkoutSessionId);
    res.status(200).json({
      success: true,
      message: 'Commission réglée. Votre compte est réactivé.',
      user
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerStep1,
  resendOtp,
  verifyOtp,
  registerStep2,
  login,
  forgotPassword,
  resetPassword,
  logout,
  getMe,
  updatePushToken,
  updateLanguage,
  updateStamp,
  startPendingCommissionPayment,
  startPendingCommissionIntent,
  confirmPendingCommissionPayment
};
