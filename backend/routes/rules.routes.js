
const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const {
  authenticateToken,
  authorizeRoles
} = require('../middleware/auth.middleware');

// Temporary in-memory rules storage.
const rules = [];

const validMetrics = ['p95', 'errRate', 'rps'];
const validOperators = ['>', '>=', '<', '<='];

// GET /rules
router.get('/', authenticateToken, (req, res) => {
  res.json({
    total: rules.length,
    rules
  });
});

// GET /rules/check-name
router.get('/check-name', authenticateToken, (req, res) => {
  const name = String(req.query.name || '').trim().toLowerCase();
  const excludeId = req.query.excludeId;

  if (!name) {
    return res.status(400).json({
      available: false,
      message: 'Rule name is required'
    });
  }

  const exists = rules.some(rule =>
    rule.name.toLowerCase() === name &&
    rule.id !== excludeId
  );

  res.json({
    available: !exists,
    message: exists ? 'Rule name already exists' : 'Rule name is available'
  });
});

// GET /rules/:id
router.get('/:id', authenticateToken, (req, res) => {
  const rule = rules.find(item => item.id === req.params.id);

  if (!rule) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Rule not found',
        details: []
      }
    });
  }

  res.json(rule);
});

// POST /rules
router.post(
  '/',
  authenticateToken,
  authorizeRoles('operator'),
  (req, res) => {
    const { name, conditions } = req.body || {};
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey) {
      return res.status(400).json({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key header is required',
          details: []
        }
      });
    }

    if (!name || !name.trim() || !Array.isArray(conditions) || !conditions.length) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Rule name and at least one condition are required',
          details: []
        }
      });
    }

    const existing = rules.find(rule => rule.idempotencyKey === idempotencyKey);

    if (existing) {
      return res.status(200).json(existing);
    }

    if (rules.some(rule => rule.name.toLowerCase() === name.trim().toLowerCase())) {
      return res.status(409).json({
        error: {
          code: 'DUPLICATE_RULE',
          message: 'Rule name already exists',
          details: []
        }
      });
    }

    const invalidCondition = conditions.some(condition =>
      !validMetrics.includes(condition.metric) ||
      !validOperators.includes(condition.operator) ||
      !Number.isFinite(Number(condition.threshold)) ||
      !Number.isInteger(Number(condition.durationSec)) ||
      Number(condition.durationSec) < 0
    );

    if (invalidCondition) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more conditions are invalid',
          details: []
        }
      });
    }

    const now = new Date().toISOString();

    const rule = {
      id: crypto.randomUUID(),
      name: name.trim(),
      conditions,
      createdAt: now,
      updatedAt: now,
      idempotencyKey
    };

    rules.push(rule);

    res.status(201).json(rule);
  }
);

// PUT /rules/:id
router.put(
  '/:id',
  authenticateToken,
  authorizeRoles('operator'),
  (req, res) => {
    const rule = rules.find(item => item.id === req.params.id);

    if (!rule) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Rule not found',
          details: []
        }
      });
    }

    const { name, conditions } = req.body || {};

    if (!name || !name.trim() || !Array.isArray(conditions) || !conditions.length) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Rule name and at least one condition are required',
          details: []
        }
      });
    }

    const duplicate = rules.some(item =>
      item.id !== rule.id &&
      item.name.toLowerCase() === name.trim().toLowerCase()
    );

    if (duplicate) {
      return res.status(409).json({
        error: {
          code: 'DUPLICATE_RULE',
          message: 'Rule name already exists',
          details: []
        }
      });
    }

    const invalidCondition = conditions.some(condition =>
      !validMetrics.includes(condition.metric) ||
      !validOperators.includes(condition.operator) ||
      !Number.isFinite(Number(condition.threshold)) ||
      !Number.isInteger(Number(condition.durationSec)) ||
      Number(condition.durationSec) < 0
    );

    if (invalidCondition) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more conditions are invalid',
          details: []
        }
      });
    }

    rule.name = name.trim();
    rule.conditions = conditions;
    rule.updatedAt = new Date().toISOString();

    res.json(rule);
  }
);

// DELETE /rules/:id
router.delete(
  '/:id',
  authenticateToken,
  authorizeRoles('operator'),
  (req, res) => {
    const index = rules.findIndex(item => item.id === req.params.id);

    if (index === -1) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Rule not found',
          details: []
        }
      });
    }

    rules.splice(index, 1);

    res.json({
      message: 'Rule deleted successfully'
    });
  }
);

module.exports = router;
