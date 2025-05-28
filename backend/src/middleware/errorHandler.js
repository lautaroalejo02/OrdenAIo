// Middleware centralizado para manejo de errores en Express
export function errorHandler(err, req, res, next) {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || 'Error interno del servidor',
  });
} 