# MSG Rotation Target Web App

A lightweight web application built for mobile devices, served by a C backend with limited flash memory.

This app controls a rotation target system via REST API calls, using a minimal and responsive Preact + Vite frontend.

---

## Features

- List available target programs
- Select a program
- Start and Stop selected programs
- Turn target manually
- Display version from `package.json`
- Mobile-first responsive design
- Fully offline-capable with locally hosted assets
- Mock server for local development testing

---

## Tech Stack

- [Preact](https://preactjs.com/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)
- [Shoelace](https://shoelace.style/) for UI components
- Local custom icons (`play.svg`, `stop.svg`)

---

## Development and Build Instructions

### Install Dependencies

First, install all required packages:

```bash
npm install
```

---

### Run Development Server (with mock API)

Start a local dev server at `http://localhost:5173`:

```bash
npm run dev
```

- Hot-reloads when you save changes.

---

### Build Production Files

Generate optimized static files for production deployment:

```bash
npm run build
```

Outputs everything into the `/dist` folder, ready for serving from your C application.

---

## API Endpoints (Mock Server)

> **NOTE:** Actual endpoints are TBD with @frazze


The mock server responds to these API calls:

| Endpoint | Method | Description |
|:---------|:-------|:------------|
| `/api/programs` | `GET` | Returns a list of available programs (`["10 seconds", "8 seconds", "6 seconds"]`) |
| `/api/target/turn` | `POST` | Triggers the target to turn |
| `/api/programs/:program/start` | `POST` | Starts the selected program |
| `/api/programs/:program/stop` | `POST` | Stops the selected program |

✅ These mock responses allow you to develop and test the web application without a real backend.

---

## Notes

- `__APP_VERSION__` is injected automatically from `package.json` using Vite during build and dev.
- Local icons (`play.svg`, `stop.svg`) are used to avoid external CDN dependencies — fully offline-ready.
- Responsive, mobile-first design.
- Footer text is pinned at the bottom even on tall screens.

---

## License

MIT License
