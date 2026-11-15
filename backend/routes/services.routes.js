
const express = require('express');
const router = express.Router();

const {
  getServices,
  getServiceById
} = require('../services/fleet.service');

const {
  authenticateToken
} = require('../middleware/auth.middleware');

// GET /services
router.get('/', authenticateToken, (req, res) => {
  const services = getServices();

  res.json({
    total: services.length,
    services
  });
});

// GET /services/:id
router.get('/:id', authenticateToken, (req, res) => {
  const service = getServiceById(req.params.id);

  if (!service) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Service not found',
        details: []
      }
    });
  }

  res.json(service);
});

module.exports = router;
