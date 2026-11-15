
const express = require('express');

const {
  getServices,
  getServiceById
} = require('../services/fleet.service');
const { authenticateToken } = require('../middleware/auth.middleware');

const {
  getGlobalOffset,
  getReplayEvents,
  getServiceHistory
} = require('../services/stream.service');

const router = express.Router();

// GET /metrics/snapshot
router.get('/snapshot', authenticateToken, (req, res) => {
  try {
    const services = getServices();

    const metrics = services.map((service) => ({
      serviceId: service.id,
      p95: service.p95,
      errRate: service.errRate,
      rps: service.rps,
      status: service.status,
      ts: service.updatedAt
    }));

    res.json({
      offset: getGlobalOffset(),
      timestamp: Date.now(),
      total: metrics.length,
      metrics
    });
  } catch (error) {
    console.error('Snapshot API error:', error);

    res.status(500).json({
      error: {
        code: 'SNAPSHOT_ERROR',
        message: 'Unable to fetch metrics snapshot',
        details: []
      }
    });
  }
});


// GET /metrics/history?serviceId=svc-0001&minutes=15
router.get('/history', authenticateToken, (req, res) => {
  try {
    const { serviceId } = req.query;
    const minutesValue = req.query.minutes ?? '15';

    if (
      typeof serviceId !== 'string' ||
      !serviceId.trim()
    ) {
      return res.status(400).json({
        error: {
          code: 'INVALID_SERVICE_ID',
          message: 'A valid serviceId is required',
          details: []
        }
      });
    }

    if (
      typeof minutesValue !== 'string' ||
      !/^\d+$/.test(minutesValue)
    ) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MINUTES',
          message: 'Minutes must be a valid integer',
          details: []
        }
      });
    }

    const minutes = Number(minutesValue);

    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MINUTES',
          message: 'Minutes must be between 1 and 60',
          details: []
        }
      });
    }

    const service = getServiceById(serviceId);

    if (!service) {
      return res.status(404).json({
        error: {
          code: 'SERVICE_NOT_FOUND',
          message: 'Service not found',
          details: []
        }
      });
    }

    const points = getServiceHistory(serviceId, minutes);

    return res.json({
      serviceId,
      minutes,
      total: points.length,
      points
    });

  } catch (error) {
    console.error('History API error:', error);

    return res.status(500).json({
      error: {
        code: 'HISTORY_ERROR',
        message: 'Unable to fetch service history',
        details: []
      }
    });
  }
});


// GET /metrics/replay?since=12345
router.get('/replay', authenticateToken, (req, res) => {
  const sinceValue = req.query.since;

  if (
    typeof sinceValue !== 'string' ||
    !/^\d+$/.test(sinceValue)
  ) {
    return res.status(400).json({
      error: {
        code: 'INVALID_OFFSET',
        message: 'A valid since offset is required',
        details: []
      }
    });
  }

  const since = Number(sinceValue);

  if (!Number.isSafeInteger(since) || since < 0) {
    return res.status(400).json({
      error: {
        code: 'INVALID_OFFSET',
        message: 'The since offset must be a non-negative integer',
        details: []
      }
    });
  }

  const result = getReplayEvents(since);

  if (since > result.currentOffset) {
    return res.status(400).json({
      error: {
        code: 'INVALID_OFFSET',
        message: 'The requested offset is ahead of the current offset',
        details: []
      }
    });
  }

  if (result.expired) {
    return res.status(410).json({
      error: {
        code: 'REPLAY_EXPIRED',
        message: 'Requested events are older than the available replay window. Fetch a new snapshot.',
        details: []
      },
      oldestAvailableOffset: result.oldestOffset,
      currentOffset: result.currentOffset
    });
  }

  return res.json({
    since,
    offset: result.currentOffset,
    total: result.events.length,
    events: result.events
  });
});

module.exports = router;
