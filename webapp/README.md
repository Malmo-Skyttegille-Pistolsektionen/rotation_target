# Rotation Target Frontend Webapp

This project is a frontend application for controlling rotating targets for Malmö Skyttegille shooting club. The system communicates with an ESP32 backend via REST API and Server-Sent Events (SSE).

## Tech Stack

- **Language:** TypeScript
- **Framework:** React 19
- **Routing:** TanStack Router
- **State/Data:** TanStack Query
- **Build Tool:** Vite
- **Package Manager:** npm
- **Styling:** CSS Modules (CLSX)
- **Linting/Formatting:** ESLint, Prettier

## Features

The web app has the following main features:

1.  **Run Tab:**
    - Load programs (shooting series).
    - Start/stop series.
    - Show timeline and stopwatch for series.
    - Manual target control (Show/Hide).
    - Real-time updates from hardware via SSE.

2.  **Audio Tab:**
    - Upload audio files to hardware.
    - Play audio (for testing).
    - Manage audio library.

3.  **Programs Tab:**
    - Create and edit shooting programs.
    - Upload programs to hardware.

4.  **Settings Tab:**
    - Configure backend IP address.
    - Admin mode.

## Development

### Start dev server

```bash
npm run dev
```

This starts the Vite server at `http://localhost:8080`.
A built-in **Mock Server** simulates the hardware API and SSE streams, so you can develop without physical hardware.

### Build for production

```bash
npm run build
```

This generates an optimized build in the `dist/` folder.

### Code style

The project uses strict ESLint and Prettier.

```bash
npm run lint
npm run format
```

## UI/UX

Primary audience is tablet and mobile, which requires larger, touch-friendly buttons and controls.

## Project Structure

- `src/`: Source code (React)
  - `routes/`: Application routes (TanStack Router)
  - `components/`: Reusable components
  - `hooks/`: Custom hooks (e.g. useSSE)
  - `api/`: API clients and types
- `vite-plugins/`: Mock server and other Vite plugins
- `src_legacy/`: Legacy codebase (reference)

## Security

The project is configured to minimize supply-chain attack risk:

- Dependencies are locked via `package-lock.json` (`npm ci` in CI).

## Contact

Project maintained by MSG.
