const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

const protect = async (req, res, next) => {
  let token;

  // Récupérer le token depuis les cookies (ou depuis les headers d'autorisation si nécessaire)
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'auth.unauthorized', message: 'Non autorisé, aucun jeton fourni.' });
  }

  try {
    const jwtSecret = process.env.JWT_SECRET || 'dealautopro_secret_jwt_key';
    const decoded = jwt.verify(token, jwtSecret);

    // Récupérer l'utilisateur à partir du token en excluant le mot de passe
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'auth.user_not_found', message: 'Non autorisé, utilisateur introuvable.' });
    }

    // Un compte bloqué est totalement interdit
    if (user.status === 'bloque') {
      return res.status(403).json({ error: 'auth.account_blocked', message: 'Votre compte est bloqué.' });
    }

    // Un compte suspendu a un accès restreint :
    // - auth/me + logout + règlement commission impayée + support : toujours autorisés
    // - routes /sales : autorisées pour poursuivre les ventes conservées dès l'étape 2
    // - tout le reste : bloqué
    if (user.status === 'suspendu') {
      const fullPath = (req.baseUrl || '') + (req.path || '');
      const isAuthOrCommission = fullPath.includes('/auth/me') || fullPath.includes('/auth/logout') || fullPath.includes('/pending-commission');
      const isSupportTicket = fullPath.includes('/tickets') || fullPath.includes('/support');
      // Les ventes en cours (étape ≥ 3) doivent rester accessibles ; le service bloquera
      // spécifiquement les étapes 1-2 si le compte est suspendu.
      const isSaleRoute = fullPath.includes('/sales');
      const isVehicleDossierRoute = fullPath.includes('/vehicle-dossiers') && req.method === 'GET';

      if (!isAuthOrCommission && !isSupportTicket && !isSaleRoute && !isVehicleDossierRoute) {
        return res.status(403).json({ error: 'auth.account_suspended', message: 'Votre compte est suspendu. Seuls le règlement de votre commission, vos ventes en cours et le support sont autorisés.' });
      }
    }


    req.user = user;
    next();
  } catch (error) {
    console.error(`Erreur de validation JWT : ${error.message}`);
    return res.status(401).json({ error: 'auth.token_invalid', message: 'Non autorisé, jeton invalide ou expiré.' });
  }
};

/**
 * Authentification facultative : renseigne req.user si un jeton valide est présent, sans jamais
 * bloquer la requête. Utilisé par les pages publiques dont le contenu s'élargit pour un
 * utilisateur connecté et validé (ex. liste des ventes en cours).
 */
const attachUserIfAuthenticated = async (req, res, next) => {
  const token = req.cookies?.token
    || (req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);

  if (!token) return next();

  try {
    const jwtSecret = process.env.JWT_SECRET || 'dealautopro_secret_jwt_key';
    const decoded = jwt.verify(token, jwtSecret);
    const user = await User.findById(decoded.id).select('-password');
    // Un compte bloqué est traité comme un visiteur anonyme
    if (user && user.status !== 'bloque') {
      req.user = user;
    }
  } catch {
    // Jeton absent, expiré ou invalide : on poursuit en visiteur anonyme
  }

  next();
};

module.exports = { protect, attachUserIfAuthenticated };
