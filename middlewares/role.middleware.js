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

module.exports = {
  authorize,
  adminOnly: authorize('admin'),
  vendeurOnly: authorize('vendeur'),
  acheteurOnly: authorize('acheteur'),
  vendeurOrAdmin: authorize('vendeur', 'admin'),
  acheteurOrAdmin: authorize('acheteur', 'admin')
};
