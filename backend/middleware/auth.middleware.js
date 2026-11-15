
const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'AUTH401',
        message: 'Access token is missing',
        details: []
      }
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET
    );

    next();
  } catch {
    return res.status(401).json({
      error: {
        code: 'AUTH401',
        message: 'Invalid or expired access token',
        details: []
      }
    });
  }
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: {
          code: 'AUTH403',
          message: 'You do not have permission',
          details: []
        }
      });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  authorizeRoles
};
