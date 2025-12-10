# MSG Shooting Target Frontend - Web App

This is a development setup for the MSG rotation target system frontend using:

- REST API (OpenAPI 3.1.0)
- Server-Sent Events (SSE) for real-time updates
- Mock backend using Vite middleware

## Features

- Load and run shooting programs
- Upload and delete audio files
- View and track real-time program status
- Built-in mock server for development

## File Overview

| File              | Purpose                                                   |
|-------------------|-----------------------------------------------------------|
| `vite.config.ts`  | Vite plugin with REST and SSE mock logic                  |
| `main.js`         | Application shell wiring up program selection and control |
| `rest-client.js`  | All REST API interactions from OpenAPI spec               |
| `sse-client.js`   | SSE connection + event type map                           |
| `integration-ui.js` | UI logic for audio uploads, status rendering, etc.       |

## SSE Events Handled

- `program_loaded`
- `series_started`
- `event_started`
- `series_completed`
- `series_skipped`
- `program_completed`
- `sts_status`

## Development

Start your Vite dev server and the mock server will intercept requests automatically.

```
npm run dev
```

Then access the web application on http://localhost:5173/
=======
# rotation_target_frontend
