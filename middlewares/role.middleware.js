const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'auth.unauthorized', message: 'Non autorisé.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'auth.forbidden',
        message: `Accès refusé. Ce service requiert l'un des rôles suivants : ${roles.join(', ')}.`
      });
    }

    next();
  };
};

const requireValidatedSeller = (allowAdmin = false) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'auth.unauthorized', message: 'Non autorisé.' });
  }
  if (allowAdmin && req.user.role === 'admin') return next();
  if (req.user.role !== 'vendeur' || req.user.status !== 'valide') {
    return res.status(403).json({
      error: 'auth.seller_not_validated',
      message: "Votre compte vendeur doit être validé pour accéder à cette fonctionnalité."
    });
  }
  next();
};

module.exports = {
  authorize,
  adminOnly: authorize('admin'),
  vendeurOnly: authorize('vendeur'),
  acheteurOnly: authorize('acheteur'),
  vendeurOrAdmin: authorize('vendeur', 'admin'),
  vendeurValideOnly: requireValidatedSeller(false),
  vendeurValideOrAdmin: requireValidatedSeller(true),
  acheteurOrAdmin: authorize('acheteur', 'admin')
};
