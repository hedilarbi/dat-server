const errorHandler = (err, req, res, next) => {
  console.error(`[Erreur Globale] : ${err.message}`);
  console.error(err.stack);

  const statusCode = err.statusCode || err.status || (err.codeName ? 400 : (res.statusCode === 200 ? 500 : res.statusCode));
  
  res.status(statusCode).json({
    error: err.codeName || 'server.internal_error',
    message: err.message || 'Une erreur interne est survenue sur le serveur.',
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
};

module.exports = { errorHandler };
