const { verifyToken } = require('../core/security');
const { AppError } = require('../core/errors');

function protect(req, res, next) {
  let token;

  // 1. Check Authorization header (Bearer token)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  // 2. Fallback to cookie token
  else if (req.cookies?.token || req.cookies?.jwt) {
    token = req.cookies.token || req.cookies.jwt;
  }

  // If no token is provided
  if (!token) {
    return next(new AppError('You are not logged in. Please log in to continue.', 401));
  }

  try {
    const decoded = verifyToken(token);
    // Support both decoded.id and decoded.ownerId shapes
    const resolvedId = decoded.id || decoded.ownerId;
    if (!resolvedId) {
      return next(new AppError('Invalid token: missing owner identity.', 401));
    }
    req.ownerId = resolvedId;
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Session expired. Please log in again.', 401));
    }
    return next(new AppError('Invalid authentication token.', 401));
  }
}

module.exports = { protect };