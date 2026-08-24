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
    - List the programs on the device, shipped and uploaded.
    - Load a program, upload one from a file, replace one, delete one.
    - Inspect a program's timeline and download its JSON.
    - Author a program in the editor: series and events, durations, target
      commands and audio clips, with a JSON view and a timeline preview.

4.  **Settings Tab:**
    - Configure backend IP address.
    - Admin mode.

5.  **Program editor, off the device (GitHub Pages):** the same `ProgramEditor`
    component as the Programs tab, in a "no device" mode — open a program from
    this repo, another repo, or a local file (or start empty), edit it, then
    download it or send it back as a pull request. See
    [Standalone program editor](#standalone-program-editor-github-pages)
    below.

## Development

### Start dev server

```bash
npm run dev
```

This starts the Vite server at `http://localhost:8080`.
A built-in **Mock Server** simulates the hardware API and SSE streams, so you can develop without physical hardware. It lives in `test/mock-server/`;
`vite-plugins/mock-server-v2.ts` only mounts it on the dev server. Interim —
E2E is moving to the real firmware under QEMU.

### Tests

```bash
npm run test        # once, as CI runs it
npm run test:watch
```

Vitest, with happy-dom for the suites that touch the DOM (opted into per file
with `@vitest-environment happy-dom`). Suites that need an API construct the
mock server with a **fake clock**, so a 28-second series is simulated in
microseconds instead of 28 seconds of wall clock.

### Build for production

```bash
npm run build
```

This generates an optimized build in the `dist/` folder.

### Version

The bundle's version is the release tag, resolved at build time by
`vite.config.ts` from the same `git describe` the firmware's CMake runs and
injected as `__APP_VERSION__` (read it through `src/appVersion.ts`). The webapp
ships inside the firmware image, so the two report identical strings; the
Settings page shows both, and flags a disagreement.

`package.json`'s `"version": "0.0.0"` is a **placeholder**. npm wants the field;
nothing reads it and nothing bumps it. A release is a tag — see
[`docs/RELEASING.md`](../docs/RELEASING.md) and D-29 in the decision log.

### Code style

The project uses strict ESLint and Prettier.

```bash
npm run lint
npm run format
```

### Size budget

CI fails the build if the gzipped total of `dist/**/*.{js,css}` exceeds the
ceiling in `webapp/size-budget` (the same check as
`.github/workflows/webapp-build.yml`). To regenerate it after a deliberate
size change (current total + 5%):

```bash
npm run build
total=0
while IFS= read -r -d '' f; do
  total=$((total + $(gzip -nc "$f" | wc -c)))
done < <(find dist -type f \( -name '*.js' -o -name '*.css' \) -print0)
echo "$total * 1.05" | bc | cut -d. -f1 > size-budget
```

This measures `dist/`, produced by `npm run build` (`vite.config.ts`) only.
The standalone program editor below is a **separate build**
(`vite.editor.config.ts`, output `dist-editor/`) precisely so that adding to
it never grows this number — see the comment on `ProgramEditor`'s
`renderExport` prop for how the device build avoids even importing that code.

### Standalone program editor (GitHub Pages)

```bash
npm run dev:pages-editor          # http://localhost:8080, no mock API mounted
npm run build:pages-editor        # -> dist-editor/, base /rotation_target/editor/
```

`editor.html` / `src/editor-main.tsx` build the same `ProgramEditor` component
the Programs tab uses, in a mode with no device: it opens a program from a
GitHub repo's `resources/programs/files/` (via the contents API, no auth
needed for a public repo), from a local file, or empty; downloads the result;
and can hand it back as a pull request through a prefilled
`github.com/<owner>/<repo>/new/main` URL — no OAuth, no token, nothing to
leak. See [`src/lib/pr-url.ts`](src/lib/pr-url.ts) and
[`src/lib/github-contents.ts`](src/lib/github-contents.ts).

`.github/workflows/pages.yml` builds this alongside the MkDocs docs site
(`#134`) and deploys both as one GitHub Pages artifact, the editor nested
under `/editor/` — GitHub Pages has one deployment target per repo, so two
workflows both calling `deploy-pages` would race each other for it.

## End-to-end tests

The E2E suite (`e2e/`, Playwright) runs against the **real firmware** booted in
QEMU — not the mock server, and not a dev-server proxy. The webapp is built,
its `dist` is baked into the LittleFS image through `RT_WEBAPP_DIR`, that image
is booted, and the browser is pointed at the forwarded guest port. The bundle
under test is the artefact the board actually serves, so the webapp cannot
drift away from the backend without a red build.

```bash
. <esp-idf>/export.sh               # QEMU needs the ESP-IDF toolchain
npm ci
npx playwright install chromium     # `.npmrc` sets ignore-scripts; not automatic
npm run e2e:local                   # build -> boot QEMU -> test -> tear down
```

`e2e/run-local.sh` takes `--skip-build` (reuse the existing `dist` and
`build-qemu`) and `--port N`, and passes anything after `--` to
`playwright test`. It always kills QEMU on the way out, and prints the tail of
the guest serial log when something fails.

`npm run e2e` runs the tests alone, against whatever is already serving on
`RT_E2E_BASE_URL` (default `http://localhost:8080`) — a QEMU instance you
started yourself, or a real board.

Notes for writing tests:

- There is **one device** and its state persists across tests, so the config
  pins `workers: 1` and every spec calls `resetDevice()` in `beforeEach`.
- Deep links are fine to navigate to: the firmware answers a non-API `GET` miss
  with `index.html`, so `/run` reloads as the page it is.
- `backend_issue` is not covered — it needs audio hardware, and QEMU emulates
  no I2S.

CI runs the same thing in `.github/workflows/webapp-e2e.yml`.

## API types

`src/api/generated.d.ts` is generated from the canonical REST contract
(`../contracts/openapi.yaml`) by `openapi-typescript`:

```bash
npm run generate:api
```

The output is committed, and CI re-runs the generator and fails the build on
`git diff` — so a merged contract change that the webapp hasn't caught up
with is a red build, not a silent runtime mismatch. `src/api/types.ts`
re-exports the shapes it actually uses from `components['schemas'][...]` in
the generated file; SSE payload types (`contracts/asyncapi.yaml` is not fed
to the generator) stay hand-written there.

The app does not ship a JSON Schema. `src/lib/program-document.ts` validates
program documents against what the firmware's `parse_program` actually does
(D-18); `test/program-document-schema.test.ts` cross-checks that against
`../contracts/program.schema.json` with ajv, which is why ajv is still a
devDependency.

## UI/UX

Primary audience is tablet and mobile, which requires larger, touch-friendly buttons and controls.

## Project Structure

- `src/`: Source code (React)
  - `routes/`: Application routes (TanStack Router)
  - `components/`: Reusable components
  - `hooks/`: Custom hooks (e.g. useSSE)
  - `api/`: API clients and types
  - `lib/`: Pure logic shared with the mock server (e.g. run-position, which
    mirrors `firmware/lib/rt_logic/run_position.h`)
- `vite-plugins/`: Dev-server plugins (the mock server adapter)
- `test/`: Unit tests, fixtures and the mock server implementation

## Security

The project is configured to minimize supply-chain attack risk:

- Dependencies are locked via `package-lock.json` (`npm ci` in CI).
- Install scripts are disabled via `.npmrc` (`ignore-scripts=true`); no
  package's `postinstall`/`preinstall` runs on `npm install` or `npm ci`.
- Yarn's `npmMinimalAgeGate` (a per-install minimum package age) has no npm
  equivalent; the managed path is instead covered by the org's shared
  Renovate config, `minimumReleaseAge` (3 days for minor/patch updates, 7
  days for major).

## Contact

Project maintained by MSG.
