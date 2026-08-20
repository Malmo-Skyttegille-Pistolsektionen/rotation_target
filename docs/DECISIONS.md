# Rotation Target — Decision Log

Decisions of record for the rotation target system (Malmö Skyttegille
Pistolsektionen, Eigenbrod TP2). Maintained by Jimisola + agents; every new
decision of record gets an entry. This file is the canonical copy.

Statuses: **Decided** · **Deferred** (intentionally postponed) · **Open**
(not yet decided). Dates: "Aug 2026" = earlier sessions; exact date where known.

| ID | Decision | Status | Date |
|----|----------|--------|------|
| D-01 | Merge into a monorepo | Decided | Aug 2026 |
| D-02 | ESP-IDF firmware is the core backend | Decided | Aug 2026 |
| D-03 | `app` + `x86_linux` stay out of the monorepo | Decided | 2026-08-20 |
| D-04 | One backend tree; QEMU is a build variant | Decided | 2026-08-20 |
| D-05 | QEMU replaces the Linux port | Decided | 2026-08-20 |
| D-06 | E2E runs against the real backend, no mock | Decided | 2026-08-20 |
| D-07 | TUI is an SSE client, not backend-embedded | Decided | 2026-08-20 |
| D-08 | Target banks (A/B) deferred | Deferred | 2026-08-20 |
| D-09 | `backend_issue` SSE event returns in v2 | Decided | 2026-08-20 |
| D-10 | Monorepo imports open PR branches, not main | Decided | 2026-08-20 |
| D-11 | Prefixed tags + dynamic versioning | Decided | Aug 2026 |
| D-12 | Webapp package manager: npm | Decided | 2026-08-20 |
| D-13 | Agent roles & review policy | Decided | 2026-08-20 |
| D-14 | Webapp guardrails (devtools, src_legacy, size budget) | Decided | Aug 2026 |

## D-01 — Merge into a monorepo *(Decided, Aug 2026)*

**Decision:** `contracts/`, `firmware/`, `webapp/`, `resources/` merge into
one repository — **`rotation_target`** — with full git history preserved.
MicroPython backend is archived (still the behavioural reference);
`webshooter-cli` stays out.

**Why:** changes that must be atomic kept getting split across repos:
program `duration` documented as tenths-of-a-second while every backend used
milliseconds (100× off, in a third repo); the webapp hardcoding
`http://localhost:8080`; the shipped admin-mode API absent from the canonical
spec.

**Rejected:** git submodules (ruled out); a release-artifact pipeline (work
that the monorepo makes obsolete). The "resources repo is 6 GB" objection was
disproven — `origin/main` is 7.4 MB.

## D-02 — ESP-IDF firmware is the core backend *(Decided, Aug 2026; confirmed 2026-08-20)*

**Decision:** `rotation_target_backend_esp32_espidf` (REST API v2 + SSE) is
the single backend going forward.

**Why:** complete v2 implementation verified on hardware; 113 host tests
under ASan+UBSan; a genuinely portable core (`lib/rt_logic`, zero
ESP/FreeRTOS dependencies). The 2026-08-20 analysis confirmed the alternative
`app` C backend is a strict functional subset: read-only program storage,
stubbed target endpoints, no working audio on Linux.

**Rejected:** `rotation_target_backend_app` as core; continuing the
MicroPython backend.

## D-03 — `app` + `x86_linux` stay out of the monorepo *(Decided 2026-08-20; one open sub-question)*

**Decision:** both repos are left untouched — not imported, not archived.

**Why:** nothing in them is worth porting as code (subset API, stub
endpoints, unimplemented audio, executor running in a POSIX signal handler).
Their good *ideas* — the ncurses target rendering, millisecond chrono,
discrete SSE lifecycle events — are recorded in the implementation plan.

**Open:** whether anyone on the team still uses them (being asked); the
archive-or-keep call follows from the answer.

## D-04 — One backend tree; QEMU is a build variant *(Decided 2026-08-20)*

**Decision:** no separate `linux/` directory. Host execution is a build
variant inside `firmware/` (`sdkconfig.defaults.qemu` + a network bring-up
switch), compiling the same sources as the device build.

## D-05 — QEMU replaces the Linux port *(Decided 2026-08-20)*

**Decision:** the firmware runs in Espressif QEMU (esp32s3 target); the
webapp in a browser is the graphical target display; the native Linux port is
**deferred** to an optional future phase requiring a fresh go-decision.

**Why:** QEMU exercises the shipped stack — real `esp_http_server`, LittleFS,
FreeRTOS timing — at higher fidelity than a reimplemented port, for days of
work instead of weeks. Verified: octal PSRAM emulated (auto-configured),
16 MB flash incl. the LittleFS image, wall-clock timers. Known limits: audio
is silent (no I2S emulation), no mDNS from the host (use
`localhost:<port>`), GPIO writes are no-ops.

**Deferred, not rejected:** the Linux port's unique payoffs — real audio
from a laptop, an internals-driven TUI, sanitizers over the integration
layers — are documented as plan Phase 5.2.

## D-06 — E2E runs against the real backend, no mock *(Decided 2026-08-20)*

**Decision:** webapp E2E (Playwright) runs against the QEMU-hosted firmware
with the webapp bundled into the LittleFS image; the Vite mock server is
demoted to a fast unit fixture.

**Why:** makes mock/API drift structurally impossible — drift was the
project's repeated failure mode.

## D-07 — TUI is an SSE client, not backend-embedded *(Decided 2026-08-20; optional)*

**Decision:** an optional terminal target-viewer is a standalone client of
`/sse/v2` + REST, working identically against QEMU and the real board. An
internals-driven TUI belongs to the deferred Linux port, where it would *be*
the Linux targets implementation.

**Why:** under QEMU a host process cannot share memory with the firmware,
and the SSE payload is serialized from the authoritative executor state under
the same lock — it *is* the internal state, one serialization away.

## D-08 — Target banks (A/B) deferred *(Deferred 2026-08-20)*

**Decision:** no bank work in the current plan.

**Why:** banks exist only as an unused enum in the old HAL — no wire format,
no program uses them, no consumer anywhere. Adding them is contract design
first (target endpoints, `stateUpdate` shape, program schema, per-bank GPIO)
— a separate effort.

## D-09 — `backend_issue` SSE event returns in v2 *(Decided 2026-08-20; planned)*

**Decision:** v2 SSE gains a second event (`{code, message, context?}`) for
device-side failures — clip failed to play, storage full, malformed program.

**Why:** v1 had it; v2's collapse to `stateUpdate` + `heartbeat` left the
device no way to report that something went wrong. Additive; breaks nothing.

## D-10 — Monorepo imports open PR branches, not main *(Decided 2026-08-20)*

**Decision:** firmware is imported at the PR #2 branch tip, webapp at the
PR #58 branch tip (resources at `main`); #2/#58/#48 are closed as
"superseded by the monorepo" once it is live. Where `main` is newer for repo
settings or `.github/` workflows, the newer side wins, compared per file.

**Why:** the entire ESP-IDF port exists only on the #2 branch; merging PRs
into repos about to be superseded adds no value.

## D-11 — Prefixed tags + dynamic versioning *(Decided, Aug 2026)*

**Decision:** per-component releases via tag prefixes (`firmware-vX.Y.Z`,
`webapp-vX.Y.Z`, …); version resolved from `git describe` at build time;
artifacts attach to GitHub releases; reuse the reqstool `common-release-*`
reusable workflows.

**Constraints of record:** no version-bump commits, no git submodules, no
committed manifest of asset versions — pin in the *output* (artifact +
`GET /api/v2/diagnostics/info`), not the input.

**Amended 2026-08-20 (implementation):** only `common-release-assets` is
reusable as-is. `common-release-prepare`, `-tag` and `-promote` assume bare
`X.Y.Z` tags — they validate the version as semver and tag it unprefixed — so
they are ported into `.github/workflows/firmware-release.yml` rather than
called. Releases are also **not** marked "latest": with three tag lines in one
repository that flag would name a webapp release as the newest firmware.
See `docs/RELEASING.md`.

## D-12 — Webapp package manager: npm *(Decided 2026-08-20)*

**Decision:** npm. Generate `package-lock.json`, delete `yarn.lock`,
`npm ci` in CI.

**Why:** the monorepo has exactly one JS package, so pnpm's workspace
strengths don't apply; the existing lockfile is Yarn 1 (maintenance mode) and
Yarn Berry adds Corepack friction; npm ships with Node and keeps CI and the
firmware's webapp-bundling step free of extra toolchain.

**Rejected:** yarn; pnpm (revisit if the monorepo ever grows multiple JS
packages).

## D-13 — Agent roles & review policy *(Decided 2026-08-20)*

**Decision:** Fable 5 orchestrates and reviews design-critical PRs
(monorepo assembly, versioning, openeth variant, contracts, E2E); Opus and
Sonnet implement; **the reviewer is never the implementer**; routine PRs are
reviewed by a fresh Opus agent (`/code-review`); attack-surface PRs
additionally get `/security-review`; the deep multi-agent review is reserved
for at most the assembly and openeth PRs. Jimisola merges every PR by hand.

**Amended 2026-08-20:** dependent PRs are **stacked** (GitHub native
stacked PRs via `gh stack`) so a pending merge never blocks downstream
tasks; merging is bottom-up with server-side retargeting. The
monorepo-assembly layer must be merged with a merge commit (squash would
discard imported history).

## D-14 — Webapp guardrails *(Decided, Aug 2026)*

**Decision:** devtools never ship in a stable release (dev-only lazy
import); `src_legacy` stays until its Audio and Programs tabs are ported (it
is the only implementation of both); CI enforces a gzip size budget.

## Open questions

- **Are `app` / `x86_linux` used by anyone?** (asked — drives D-03's
  archive-or-keep follow-up)
- **Program update endpoint shape:** does `POST /programs` replace by id, or
  do we add `PUT /programs/{id}`? (verification task in the plan; the legacy
  program editor needs one of them)
- **LICENSE / copyright unification** across the imported repos (org vs
  individual).
- **Admin mode is off after every boot** — acceptable security posture, or a
  cross-component contract change?
- **CORS:** firmware allowlist vs MicroPython reflect-any — the contract
  must pick one.
- **Reinstate `GET /status`** as a v2-shaped snapshot for debugging?
- **Millisecond-resolution elapsed** in `stateUpdate` (v1's chrono had it;
  v2 has whole seconds) — decide when the timeline test work lands.
