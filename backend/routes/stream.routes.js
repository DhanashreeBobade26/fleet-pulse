
const express = require('express');
const jwt = require('jsonwebtoken');
const { addSseClient } = require('../services/stream.service');
const { getChaosSettings } = require('./chaos.routes');
const router = express.Router();

router.get('/sse', (req, res) => {
  const token = req.query.token;

  // Verify the access token.
  try {
    if (typeof token !== 'string' || !token) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token is required'
        }
      });
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch (error) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token'
      }
    });
  }

  // Chaos switch: simulate SSE failure
  if (getChaosSettings().sse === 'down') {
    return res.status(503).json({
      error: {
        code: 'SSE_UNAVAILABLE',
        message: 'SSE disabled by chaos switch'
      }
    });
  }

  // Set headers required for SSE.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.flushHeaders();

  // Tell the browser that the SSE connection is ready.
  res.write(': SSE connection established\n\n');

  // Register this browser connection to receive metric events.
  addSseClient(res);

  // Send a heartbeat every 15 seconds.
  const heartbeat = setInterval(() => {
    if (!res.destroyed) {
      res.write(': heartbeat\n\n');
    }
  }, 15000);

  // Remove the connection when the browser disconnects.
  req.on('close', () => {
    clearInterval(heartbeat);
    addSseClient(res, true);
  });
});

module.exports = router;
