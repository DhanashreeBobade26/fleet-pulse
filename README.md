# Fleet Pulse – Real-Time Ops Dashboard

## 1. Project Overview

Fleet Pulse is a real-time operations dashboard for monitoring service health and performance.

Features include:
- Live fleet service monitoring
- WebSocket, Server-Sent Events (SSE), and HTTP polling transports
- Service details and historical charts
- Alert rules and incident monitoring
- JWT authentication and role-based access control

## 2. Technology Stack

**Frontend**
- Angular 21
- TypeScript
- Angular Material
- RxJS
- Chart.js and ng2-charts

**Backend**
- Node.js 20
- Express.js
- WebSocket
- Server-Sent Events
- REST APIs
- JWT authentication

## 3. Project Structure

```text
Technical Assignment/
├── backend/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── .env.example
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
├── fleet-pulse/
│   └── frontend/
│       ├── src/
│       ├── Dockerfile
│       ├── package.json
│       └── angular.json
├── docker-compose.yml
└── README.md
```

## 4. Prerequisites

For local development:
- Node.js 20
- npm
- Angular CLI compatible with the project

For containerized execution:
- Docker
- Docker Compose

## 5. Setup Instructions

### Backend

From the repository root:

```bash
cd backend
npm ci
```

Create a local `.env` file using `.env.example` as a template. Replace the example JWT secrets with your own values.

Start the backend:

```bash
npm start
```

Backend URL: `http://localhost:4000`

WebSocket endpoint: `ws://localhost:4000/stream`

SSE endpoint: `http://localhost:4000/stream/sse`

### Frontend

Open another terminal from the repository root:

```bash
cd fleet-pulse/frontend
npm ci
npm start
```

Frontend URL: `http://localhost:4200`

### Docker Compose

From the repository root, first create `backend/.env` using `backend/.env.example` and configure your own secrets.

Then run:

```bash
docker compose up --build
```

Frontend: `http://localhost:4200`

Backend: `http://localhost:4000`

To stop the containers:

```bash
docker compose down
```

## 6. Demo Login

**Operator**
- Email: `operator@pulse.dev`
- Password: `pulse123`

**Viewer**
- Email: `viewer@pulse.dev`
- Password: `pulse123`

Use these only with the local mock backend.

## 7. Architecture

```text
                 Angular Frontend
                        |
                 Authentication
                        |
                 Fleet Dashboard
                        |
                Stream Service
                        |
          +-------------+-------------+
          |             |             |
       WebSocket       SSE        HTTP Polling
       Primary       Fallback      Fallback
          |             |             |
          +-------------+-------------+
                        |
                 Event Processing
                        |
             Ordering and Deduplication
                        |
                Signals / UI Updates
                        |
              Dashboard and Charts
```

The backend provides REST APIs, streaming endpoints, authentication, and mock service data.

## 8. Resilience Decisions

### R1 – Real-Time Transport Resilience

The transport strategy prioritizes:
1. WebSocket as the primary connection.
2. SSE as the fallback transport.
3. HTTP polling when streaming transports are unavailable.
4. Reconnection attempts with backoff.
5. Browser online/offline handling.

### R2 – Event Ordering and Recovery

The stream processing logic handles:
- Global event offsets and sequence tracking
- Duplicate event detection
- Out-of-order event handling
- Replay requests for missing events
- Snapshot recovery when replay history is unavailable
- Malformed event handling

### R3 – HTTP Resilience

HTTP resilience includes:
- Request timeout handling
- Retry handling for eligible requests
- Backoff between retries
- Retry-After handling for HTTP 429 responses
- Protection against unsafe POST retries

### R4 – Historical Chart Failure Isolation

Historical chart loading is handled separately from the main service details. Chart errors can be displayed independently, with a retry option, so chart failures do not need to interrupt the rest of the detail view.

## 9. Testing and Verification

Verified during development:
- Angular production build completes successfully.
- Backend starts successfully on port 4000.
- Frontend starts successfully on port 4200.
- Login succeeds and opens the application.

The assignment's full failure-drill matrix and performance requirements have not been comprehensively measured. They should be considered outstanding verification rather than claimed as fully passed.

## 10. Performance

The production build generated an initial bundle of approximately 630.17 kB (raw size).

Angular reported that the configured initial bundle budget of 500 kB was exceeded by approximately 130.18 kB.

The required 2,000-services / 2,000-events-per-second test under 4x CPU throttling has not been measured. No FPS or long-task performance result is claimed.

## 11. Mock Backend

The backend is a Node.js and Express-based mock service.

It provides authentication, REST endpoints, WebSocket and SSE streaming, and mock data for frontend development and resilience testing.

Environment configuration is supplied through `backend/.env`. A safe template is provided in `backend/.env.example`.

## 12. Trade-offs and Limitations

- The backend is a mock implementation intended for the assignment.
- Performance under the full required load has not been benchmarked.
- The complete failure-drill matrix has not been independently verified.
- The Angular initial bundle exceeds the configured 500 kB budget.
- Production deployment, monitoring, and infrastructure hardening are outside the scope of this mock implementation.

## 13. AI Usage

AI assistance was used during development for:
- Understanding assignment requirements
- Debugging frontend and backend issues
- Reviewing implementation approaches
- Improving error handling
- Troubleshooting and documentation

Implementation decisions and final changes were reviewed during development.

---

**Project:** Fleet Pulse – Real-Time Ops Dashboard
