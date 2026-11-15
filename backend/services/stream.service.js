
const jwt = require('jsonwebtoken');
const { WebSocketServer, WebSocket } = require('ws');
const { getChaosSettings } = require('../routes/chaos.routes');
const { getServices } = require('./fleet.service');

const sseClients = new Set();

let globalOffset = 0;

// Keep the last five minutes of events.
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const MAX_REPLAY_EVENTS = 2000 * 5 * 60;

// Circular buffer for replay history.
const replayOffsets = new Float64Array(MAX_REPLAY_EVENTS);
const replayTimestamps = new Float64Array(MAX_REPLAY_EVENTS);
const replayMessages = new Array(MAX_REPLAY_EVENTS);

// Keep up to 60 minutes of history for each service.
const MAX_HISTORY_POINTS = 60 * 60;

const serviceHistory = new Map();

let replayStart = 0;
let replayCount = 0;

function addSseClient(response, remove = false) {
  if (remove) {
    sseClients.delete(response);
  } else {
    sseClients.add(response);
  }
}

// Remove events older than five minutes.
function pruneReplayHistory(currentTimestamp) {
  while (replayCount > 0) {
    const oldestIndex = replayStart;

    if (
      currentTimestamp - replayTimestamps[oldestIndex] <=
      REPLAY_WINDOW_MS
    ) {
      break;
    }

    replayMessages[oldestIndex] = undefined;
    replayStart = (replayStart + 1) % MAX_REPLAY_EVENTS;
    replayCount--;
  }
}

// Save each event for future replay.
function storeReplayEvent(event, message) {
  let index;

  if (replayCount < MAX_REPLAY_EVENTS) {
    index = (replayStart + replayCount) % MAX_REPLAY_EVENTS;
    replayCount++;
  } else {
    // Buffer is full: overwrite the oldest event.
    index = replayStart;
    replayStart = (replayStart + 1) % MAX_REPLAY_EVENTS;
  }

  replayOffsets[index] = event.offset;
  replayTimestamps[index] = event.ts;
  replayMessages[index] = message;

  pruneReplayHistory(event.ts);
}

// Store historical metrics for each service.
function storeMetricHistory(event) {
  let history = serviceHistory.get(event.serviceId);

  if (!history) {
    history = {
      timestamps: new Float64Array(MAX_HISTORY_POINTS),
      p95: new Float32Array(MAX_HISTORY_POINTS),
      errRate: new Float32Array(MAX_HISTORY_POINTS),
      rps: new Float32Array(MAX_HISTORY_POINTS),
      nextIndex: 0,
      count: 0
    };

    serviceHistory.set(event.serviceId, history);
  }

  const index = history.nextIndex;

  history.timestamps[index] = event.ts;
  history.p95[index] = event.p95;
  history.errRate[index] = event.errRate;
  history.rps[index] = event.rps;

  history.nextIndex =
    (history.nextIndex + 1) % MAX_HISTORY_POINTS;

  history.count = Math.min(
    history.count + 1,
    MAX_HISTORY_POINTS
  );
}

function getServiceHistory(serviceId, minutes = 15) {
  const history = serviceHistory.get(serviceId);

  if (!history) {
    return [];
  }

  const cutoff = Date.now() - minutes * 60 * 1000;
  const events = [];

  const oldestIndex =
    (history.nextIndex - history.count + MAX_HISTORY_POINTS) %
    MAX_HISTORY_POINTS;

  for (let i = 0; i < history.count; i++) {
    const index =
      (oldestIndex + i) % MAX_HISTORY_POINTS;

    const timestamp = history.timestamps[index];

    if (timestamp >= cutoff) {
      events.push({
        ts: timestamp,
        p95: history.p95[index],
        errRate: history.errRate[index],
        rps: history.rps[index]
      });
    }
  }

  return events;
}

// Return all available events after the requested offset.
function getReplayEvents(sinceOffset) {
  pruneReplayHistory(Date.now());

  const oldestOffset =
    replayCount > 0
      ? replayOffsets[replayStart]
      : globalOffset + 1;

  const expired = sinceOffset < oldestOffset - 1;

  const events = [];

  if (!expired) {
    for (let i = 0; i < replayCount; i++) {
      const index =
        (replayStart + i) % MAX_REPLAY_EVENTS;

      if (replayOffsets[index] > sinceOffset) {
        events.push(JSON.parse(replayMessages[index]));
      }
    }
  }

  return {
    expired,
    oldestOffset,
    currentOffset: globalOffset,
    events
  };
}

function attachMetricStream(server) {
  const wss = new WebSocketServer({
    server,
    path: '/stream'
  });

  const serviceSequences = new Map();

  // Authenticate WebSocket connections.
  wss.on('connection', (socket, request) => {
    const requestUrl = new URL(
      request.url,
      'http://localhost'
    );

    const token = requestUrl.searchParams.get('token');

    // Chaos switch: simulate WebSocket failure
    if (getChaosSettings().ws === 'down') {
      socket.close(1013, 'WebSocket disabled by chaos switch');
      return;
    }

    try {
      if (!token) {
        throw new Error('Missing access token');
      }

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (error) {
      socket.close(4401, 'Unauthorized');
      return;
    }

    socket.isAlive = true;

    socket.on('pong', () => {
      socket.isAlive = true;
    });
  });

  // Generate metrics once and send them to both transports.
  const metricsTimer = setInterval(() => {
    const services = getServices();
    const timestamp = Date.now();

    for (const service of services) {
      const serviceId = service.id;

      const previousSequence =
        serviceSequences.get(serviceId) || 0;

      const seq = previousSequence + 1;

      serviceSequences.set(serviceId, seq);

      const p95 = Math.max(
        1,
        Number(service.p95 || 100) +
        (Math.random() - 0.5) * 20
      );

      const errRate = Math.max(
        0,
        Number(service.errRate || 0) +
        (Math.random() - 0.5) * 0.2
      );

      const rps = Math.max(
        0,
        Number(service.rps || 10) +
        (Math.random() - 0.5) * 10
      );

      const roundedP95 = Number(p95.toFixed(2));
      const roundedErrRate = Number(errRate.toFixed(2));
      const roundedRps = Number(rps.toFixed(2));

      let status = 'healthy';

      if (roundedErrRate >= 5 || roundedP95 >= 1000) {
        status = 'critical';
      } else if (
        roundedErrRate >= 2 ||
        roundedP95 >= 500
      ) {
        status = 'warning';
      }

      service.p95 = roundedP95;
      service.errRate = roundedErrRate;
      service.rps = roundedRps;
      service.status = status;
      service.updatedAt = timestamp;

      globalOffset++;

      const event = {
        type: 'metric',
        offset: globalOffset,
        serviceId,
        seq,
        ts: timestamp,
        p95: roundedP95,
        errRate: roundedErrRate,
        rps: roundedRps,
        status
      };

      const message = JSON.stringify(event);

      const chaosSettings = getChaosSettings();
      let wsMessage = message;

      if (
        typeof chaosSettings.chaos === 'string' &&
        chaosSettings.chaos.startsWith('garbage:')
      ) {
        const percentage = Number(
          chaosSettings.chaos.split(':')[1]
        );

        if (
          Number.isFinite(percentage) &&
          Math.random() * 100 < percentage
        ) {
          wsMessage = '{invalid-json';
        }
      }

      // Save event before broadcasting it.
      storeReplayEvent(event, message);

      // Store historical metrics for charts.
      storeMetricHistory(event);

      // Send the event to WebSocket clients.
      const wsChaos = getChaosSettings().ws;

      wss.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
          return;
        }

        if (wsChaos === 'silent') {
          return;
        }

        if (
          typeof wsChaos === 'string' &&
          wsChaos.startsWith('drop:')
        ) {
          const dropPercentage = Number(wsChaos.split(':')[1]);

          if (
            Number.isFinite(dropPercentage) &&
            Math.random() * 100 < dropPercentage
          ) {
            return;
          }
        }

        const chaos = getChaosSettings().chaos;

        // Simulate shuffled and delayed events.
        if (
          typeof chaos === 'string' &&
          chaos.includes('shuffle') &&
          Math.random() < 0.5
        ) {
          setTimeout(() => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(wsMessage);
            }
          }, 500);
        } else {
          client.send(wsMessage);
        }

        // Simulate duplicate events.
        if (
          typeof chaos === 'string' &&
          chaos.includes('dupe') &&
          Math.random() < 0.5
        ) {
          client.send(wsMessage);
        }
      });

      // Send the same event to SSE clients.
      const sseMessage =
        `id: ${globalOffset}\n` +
        'event: metric\n' +
        `data: ${message}\n\n`;

      sseClients.forEach((client) => {
        if (client.destroyed || client.writableEnded) {
          sseClients.delete(client);
          return;
        }

        client.write(sseMessage);
      });
    }
  }, 1000);

  // WebSocket heartbeat every five seconds.
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.isAlive === false) {
        client.terminate();
        return;
      }

      client.isAlive = false;
      client.ping();
    });
  }, 5000);

  server.on('close', () => {
    clearInterval(metricsTimer);
    clearInterval(heartbeatTimer);
  });

  return wss;
}

module.exports = {
  attachMetricStream,
  addSseClient,
  getGlobalOffset: () => globalOffset,
  getReplayEvents,
  getServiceHistory
};
