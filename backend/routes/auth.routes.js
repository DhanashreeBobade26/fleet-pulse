
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const router = express.Router();

const users = [
  {
    id: 'user-001',
    email: 'operator@pulse.dev',
    passwordHash: bcrypt.hashSync('pulse123', 10),
    role: 'operator'
  },
  {
    id: 'user-002',
    email: 'viewer@pulse.dev',
    passwordHash: bcrypt.hashSync('pulse123', 10),
    role: 'viewer'
  }
];

const refreshTokens = new Map();

function createTokenResponse(user) {
  const tokenId = crypto.randomUUID();

  const accessToken = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: Number(process.env.ACCESS_TOKEN_TTL || 60)
    }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.id,
      role: user.role,
      tokenId
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: '7d'
    }
  );

  refreshTokens.set(tokenId, {
    userId: user.id,
    role: user.role
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: Number(process.env.ACCESS_TOKEN_TTL || 60),
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  };
}

// POST /auth/login
router.post('/login', (req, res) => {
  const { email, username, password } = req.body || {};
  const loginEmail = email || username;

  if (!loginEmail || !password) {
    return res.status(400).json({
      error: {
        code: 'AUTH400',
        message: 'Email and password are required',
        details: []
      }
    });
  }

  const user = users.find(
    item => item.email.toLowerCase() === loginEmail.toLowerCase()
  );

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({
      error: {
        code: 'AUTH401',
        message: 'Invalid email or password',
        details: []
      }
    });
  }

  const tokens = createTokenResponse(user);

  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.json({
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    user: tokens.user
  });
});

// POST /auth/refresh
router.post('/refresh', (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({
      error: {
        code: 'AUTH401',
        message: 'Refresh token is required',
        details: []
      }
    });
  }

  try {
    const payload = jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const storedToken = refreshTokens.get(payload.tokenId);

    if (!storedToken || storedToken.userId !== payload.userId) {
      return res.status(401).json({
        error: {
          code: 'AUTH401',
          message: 'Refresh token is invalid or already used',
          details: []
        }
      });
    }

    refreshTokens.delete(payload.tokenId);

    const user = users.find(item => item.id === payload.userId);

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'AUTH401',
          message: 'User not found',
          details: []
        }
      });
    }

    const tokens = createTokenResponse(user);

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      user: tokens.user
    });

  } catch {
    return res.status(401).json({
      error: {
        code: 'AUTH401',
        message: 'Refresh token is invalid or expired',
        details: []
      }
    });
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    try {
      const payload = jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET
      );

      refreshTokens.delete(payload.tokenId);
    } catch {
      // Invalid or expired refresh token.
    }
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/auth'
  });

  return res.json({
    message: 'Logged out successfully'
  });
});

module.exports = router;
