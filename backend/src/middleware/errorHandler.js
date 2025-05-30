// Centralized error handling middleware for Express
export function errorHandler(err, req, res, next) {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || 'Internal server error',
  });
} 