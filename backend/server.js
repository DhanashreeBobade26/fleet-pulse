
require('dotenv').config();
const cookieParser = require('cookie-parser');
const express = require('express');
const cors = require('cors');
const http = require('http');

const authRoutes = require('./routes/auth.routes');
const servicesRoutes = require('./routes/services.routes');
const streamRoutes = require('./routes/stream.routes');
const metricsRoutes = require('./routes/metrics.routes');
const chaosRoutes = require('./routes/chaos.routes');
const rulesRoutes = require('./routes/rules.routes');
const { getChaosSettings } = require('./routes/chaos.routes');
const { attachMetricStream } = require('./services/stream.service');

const app = express();

app.use(cors({
    origin: 'http://localhost:4200',
    credentials: true
}));

app.use(express.json());

app.use(cookieParser());
// Simulate HTTP failures for resilience testing.
app.use((req, res, next) => {
    console.log('REQUEST:', req.method, req.originalUrl);
    const chaos = getChaosSettings();
    console.log('HTTP chaos check:', req.path, chaos);
    const isHistoryRequest = req.path === '/metrics/history';
    const httpChaos = isHistoryRequest ? chaos.history : chaos.http;

    if (typeof httpChaos === 'string' && httpChaos.startsWith('500:')) {
        const percentage = Number(httpChaos.split(':')[1]);

        if (
            Number.isFinite(percentage) &&
            Math.random() * 100 < percentage
        ) {
            return res.status(500).json({
                error: {
                    code: 'CHAOS_HTTP_500',
                    message: 'Simulated HTTP failure',
                    details: []
                }
            });
        }
    }

    next();
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Fleet Pulse backend is running'
    });
});

app.use('/auth', authRoutes);
app.use('/services', servicesRoutes);

// SSE endpoint: GET /stream/sse
app.use('/stream', streamRoutes);
app.use('/metrics', metricsRoutes);
app.use('/chaos', chaosRoutes);
app.use('/rules', rulesRoutes);
// Create HTTP server.
const server = http.createServer(app);

// WebSocket endpoint: ws://localhost:4000/stream
attachMetricStream(server);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
    console.log(`Fleet Pulse backend running on http://localhost:${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}/stream`);
    console.log(`SSE endpoint: http://localhost:${PORT}/stream/sse`);
});
