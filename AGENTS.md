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

### How the contracts are versioned

Three numbers exist and only one of them is a version anybody should read:

- **The path prefix — `/api/v2`, `/sse/v2` — is the contract version.** It is
  what clients branch on, and the only one that carries meaning.
- **`info.version` in each document is pinned at `1.0.0` and does not move.**
  Nothing reads it: it is not emitted into the webapp's generated types, no
  workflow inspects it, and the firmware never sees it. Both specs require the
  field to exist, so it stays — pinned, so it cannot drift. It previously
  tracked the shape history of the documents and reached 5.0.0 and 3.1.1, the
  latter a digit away from the AsyncAPI spec version on the line above it.
- **The product ships under one bare-semver git tag** covering firmware, webapp
  and resources together (D-29). That is the number a release is called.

**Changes within a major must be additive** — a new endpoint, a new optional
field, a new enum member a client can ignore. Anything a deployed client could
break on (a removed field, a narrowed type, a changed status code) is a new
path prefix, not a version bump. `docs/DECISIONS.md` records four exceptions
(D-16, D-19, D-23, D-27) taken while no release had been cut; **they stop being
available once 1.0.0 ships**, because from then on there is a deployed client.

Nothing enforces the additive rule today — it is prose. `contracts/validate.sh`
lints both documents (Redocly and the AsyncAPI CLI) but is not wired into CI,
and lint is not breaking-change detection.

`contracts/history/` holds the v1 documents as an archaeological record. They
are unmaintained and nothing implements them.

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

## Never commit

- **Stage explicit paths. Do not use `git add -A`, `git add .` or `commit -a`.**
  This is not style. Twice now a generated file has been swept into a commit
  that way, and one of them — `firmware/sdkconfig.bak-<timestamp>`, written by
  `idf.py` beside the gitignored `sdkconfig` — carried the WiFi SSID and
  password into a **public** repository. A `.gitignore` rule cannot save you:
  it does not apply to a file that is already tracked, and it did not exist
  when that file first landed.
- **Credentials of any kind.** The WiFi credentials live in `firmware/sdkconfig`
  and nowhere else. There is no second copy, which is also why regenerating it
  destroys them (see below).
- **Generated build configuration.** `sdkconfig`, `sdkconfig.bak-*`, and any
  ad-hoc `sdkconfig.<profile>` from `idf.py -D SDKCONFIG=…`. Only
  `sdkconfig.defaults` and its per-profile siblings are tracked.

A pre-commit hook refuses a file carrying a real `CONFIG_RT_WIFI_SSID` or
`CONFIG_RT_WIFI_PASSWORD`, but it is the last line, not the first. Removing a
secret from the tip does not unpublish it — it stays in the pushed history, and
the credential has to be rotated.

## Conventions

- Conventional Commits for commit subjects and PR titles.
- Every commit is signed off (`git commit -s`).
- Work on a branch and open a PR; never push to `main`.
- Run `pre-commit run --all-files` before pushing — CI runs the same hooks.
- Vendored code (`firmware/lib/psychic_http/`, `arduinojson/`, `dns_server/`)
  and `resources/` are never reformatted; fixes go on our side of the boundary.
