
# Fleet Pulse – Real-Time Ops Dashboard

## Project Overview

Fleet Pulse is a real-time operations dashboard that monitors service health and performance metrics.

The application provides:
- Live service monitoring.
- Real-time metrics using WebSocket and Server-Sent Events (SSE).
- HTTP polling as a fallback.
- Service details and historical charts.
- Alert rules and incident monitoring.
- Authentication and role-based access.

## Project Structure

```text
Technical Assignment/
├── README.md
├── backend/
└── fleet-pulse/
    └── frontend/
```

## Technology Stack

### Frontend
- Angular 21
- TypeScript
- Angular Material
- RxJS
- Chart.js
- ng2-charts

### Backend
- Node.js
- Express.js
- WebSocket
- Server-Sent Events (SSE)
- REST APIs
- JWT Authentication

## Prerequisites

Install the following:
- Node.js
- npm
- Angular CLI

## Setup Instructions

### 1. Backend

Open a terminal:

```bash
cd backend
npm install
npm start
```

Backend runs at:

http://localhost:4000

### 2. Frontend

Open another terminal:

```bash
cd fleet-pulse/frontend
npm install
npm start
```

Open the application:

http://localhost:4200

## Demo Login

**Operator**
- Email: operator@pulse.dev
- Password: pulse123

**Viewer**
- Email: viewer@pulse.dev
- Password: pulse123

## Resilience Implementation

### R1 – Real-Time Transport Resilience

The application uses a fallback transport strategy:

1. WebSocket is the primary connection.
2. SSE is used when WebSocket fails.
3. HTTP polling is used when SSE also fails.
4. The application periodically attempts to restore a higher-priority connection.
5. Reconnection uses exponential backoff and jitter.
6. Browser offline and online events are handled.
7. Stale connection status is displayed when metrics stop arriving.

### R2 – Event Ordering and Recovery

- Global event offsets are tracked.
- Duplicate events are detected.
- Out-of-order events are buffered.
- Missing events are recovered using the replay API.
- Snapshot reload is used when replay history expires.
- Malformed events are counted and logged.

### R3 – HTTP Resilience

- HTTP requests have a timeout.
- Retry logic is implemented for eligible requests.
- Retry delays use exponential backoff.
- Retry-After is respected for HTTP 429 responses.
- POST requests are retried only when an Idempotency-Key is present.

### R4 – Historical Chart Failure Isolation

- Historical chart loading is handled separately from service details.
- Chart errors are displayed inside the chart section.
- A Retry button allows historical metrics to be requested again.
- Service information remains available when historical chart loading fails.

## Testing

The following scenarios were manually tested:

| Scenario | Expected behavior |
|---|---|
| WebSocket disabled | Application falls back to SSE |
| WebSocket and SSE disabled | Application falls back to polling |
| WebSocket restored | Application attempts to reconnect |
| Missing event offsets | Replay is requested |
| Duplicate events | Duplicate counter increases |
| Malformed events | Malformed counter increases without crashing |
| Historical API failure | Chart error and Retry button are displayed |
| Historical API restored | Charts load successfully |

## Performance

Performance measurements should be added after testing with the required load and browser throttling.

## Architecture Decisions and Trade-offs

- WebSocket is preferred for real-time communication.
- SSE provides a simpler fallback transport.
- HTTP polling provides an additional recovery mechanism.
- Event buffering helps maintain global event ordering.
- Historical chart data is reduced to limit chart rendering overhead.
- Retry logic is restricted to eligible requests to avoid unnecessary duplicate operations.

## AI Usage

AI assistance was used during development for:
- Understanding assignment requirements.
- Debugging frontend and backend issues.
- Reviewing resilience logic.
- Improving error handling.
- Testing and troubleshooting.

All implementation and testing decisions were reviewed during development.

---

## Author

Fleet Pulse – Real-Time Ops Dashboard
