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
    const jwtSecret = process.env.JWT_SECRET || 'dealsautopro_secret_jwt_key';
    const decoded = jwt.verify(token, jwtSecret);

    // Récupérer l'utilisateur à partir du token en excluant le mot de passe
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'auth.user_not_found', message: 'Non autorisé, utilisateur introuvable.' });
    }

    // Vérifier si le compte est suspendu ou bloqué
    if (user.status === 'suspendu') {
      return res.status(403).json({ error: 'auth.account_suspended', message: 'Votre compte est suspendu.' });
    }
    if (user.status === 'bloque') {
      return res.status(403).json({ error: 'auth.account_blocked', message: 'Votre compte est bloqué.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error(`Erreur de validation JWT : ${error.message}`);
    return res.status(401).json({ error: 'auth.token_invalid', message: 'Non autorisé, jeton invalide ou expiré.' });
  }
};

module.exports = { protect };
