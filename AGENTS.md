# AGENTS.md

Instructions for coding agents working in this repository. `CLAUDE.md` imports
this file; other tools read it directly. Two other developers work here and may
not use the same assistant, so the content lives in the tool-neutral file.

Per-directory detail lives beside the code:
[`firmware/AGENTS.md`](firmware/AGENTS.md) and
[`webapp/AGENTS.md`](webapp/AGENTS.md). This file covers only what is invisible
from inside any one directory — the seams. That is where this project's
expensive bugs have actually lived.

## What this is

An ESP32-S3 board drives a rotation target system for Malmö Skyttegille
Pistolsektionen, and serves the web app that operates it. See
[`README.md`](README.md) for the layout and
[`docs/DECISIONS.md`](docs/DECISIONS.md) for the decisions of record — cite
D-numbers when a change touches one.

## The seams

**`contracts/` is canonical for both sides.** `openapi.yaml`, `asyncapi.yaml`
and `program.schema.json` describe one API that the firmware implements and the
web app consumes. A route, payload or status code changes in `contracts/` **in
the same PR** as the implementation. The web app's `src/api/generated.d.ts` is
generated from those files and CI fails on drift.

**The mock server mirrors the executor.** `webapp/test/mock-server/server.ts`
reimplements `rt::Executor` behaviour so that webapp tests mean something
without a device. When run behaviour changes in
`firmware/lib/rt_logic/executor.cpp`, the mock changes with it — otherwise the
tests keep passing against a device that no longer exists. This has been got
wrong twice: the `libraryChanged` event, and the target state at series
completion (#135). `webapp/src/lib/run-position.ts` mirrors
`firmware/lib/rt_logic/run_position.h` the same way.

**`webapp/dist` is staged into the firmware image, not rebuilt by it.** The
firmware build bakes whatever `dist` currently holds. A firmware build after a
web app change but without `npm run build` ships the old bundle, silently, and
the device looks like it ignored the change. Build the web app first:

```bash
cd webapp && npm run build
cd ../firmware && idf.py build
```

**`resources/` is flashed into that same image**, and `readonly` is a property
of the directory a program was loaded from, never of the document — an uploader
must not be able to claim its program is shipped.

**One version covers all of it** (D-29). Firmware, web app and resources ship
under a single bare-semver tag, derived from git at build time. Never add a
version constant to any source file. See [`docs/RELEASING.md`](docs/RELEASING.md).

## Hardware rules that bite everyone

Full detail in [`firmware/AGENTS.md`](firmware/AGENTS.md); these two are worth
knowing before touching a board.

- **Flash with `--no-stub`.** esptool's stub flasher fails on this board and the
  failure presents exactly like a bad flash sector. `idf.py flash` uses the
  stub.
- **Never `idf.py set-target` on an existing clone.** It regenerates
  `sdkconfig`, which holds the WiFi credentials and is gitignored — there is no
  other copy. Use `idf.py reconfigure`.

## Conventions

- Conventional Commits for commit subjects and PR titles.
- Every commit is signed off (`git commit -s`).
- Work on a branch and open a PR; never push to `main`.
- Run `pre-commit run --all-files` before pushing — CI runs the same hooks.
- Vendored code (`firmware/lib/psychic_http/`, `arduinojson/`, `dns_server/`)
  and `resources/` are never reformatted; fixes go on our side of the boundary.
