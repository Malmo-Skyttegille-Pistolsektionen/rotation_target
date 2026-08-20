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
| D-15 | Program update is `PUT /programs/{id}`, refused while loaded | Decided | 2026-08-20 |

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

**Amended 2026-08-20 (implementation):** two emulator defects found while
bringing the variant up, both worked around in the repository rather than in
anyone's shell history. Details and symptoms in `firmware/docs/QEMU.md`;
remove the workarounds when the emulator is fixed.

- **The QEMU profile builds for quad PSRAM, not the board's octal.**
  qemu-xtensa 9.2.2 segfaults deterministically inside `psram_transfer()`
  during the octal driver's init transfer, with no guest output at all. The
  pool is still 8 MB and nothing above the driver can tell the difference, so
  the earlier "octal PSRAM emulated" note above holds for the emulator's
  capability but not for what we build against.
- **`scripts/run-qemu.sh` invokes `qemu-system-xtensa` directly.**
  `idf.py qemu` hardcodes `-m 32M`, at which PSRAM claims the whole
  external-memory virtual address range and every flash mmap after it fails;
  and it always attaches an eFuse image whose chip revision sends the PSRAM
  driver through MSPI timing tuning, another faulting path. The build half is
  still plain `idf.py`.

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

## D-09 — `backend_issue` SSE event returns in v2 *(Decided 2026-08-20; implemented)*

**Decision:** v2 SSE gains a third event (`{code, message, context?}`) for
device-side failures — clip failed to play, storage full, malformed program.

**Why:** v1 had it; v2's collapse to `stateUpdate` + `heartbeat` left the
device no way to report that something went wrong. Additive; breaks nothing.

**As implemented (2026-08-20):** two codes, not three —
`audio_playback_failed` and `program_invalid`. There is no storage-full code
because there is no storage failure outside a request: every write goes through
an upload or update handler and already answers `500`, and a filesystem that
will not mount reboots the device before the server starts. Inventing an
emission point for it would have put a code in the contract that nothing
raises.

The event is **fire-and-forget**: no buffering for late joiners, no replay on
reconnect, no endpoint listing past issues. The device log stays the record;
the event is the notification. `sse_hub` drops frames raised before the HTTP
server exists, which is what makes the boot-time program scan safe to emit
from.

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
strengths don't apply; the existing lockfile was Yarn 4 (Berry,
`packageManager: yarn@4.12.0`), which needs Corepack to reproduce the pinned
version; npm ships with Node and keeps CI and the firmware's
webapp-bundling step free of extra toolchain.

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
is the only implementation of both)

**Amended 2026-08-20:** the Audios tab and the Programs list/management
views are now ported to React (#71, #72). What still exists only in
`src_legacy` is the **WYSIWYG program editor** (#73) — so `src_legacy`
stays until that lands. See [D-18](#d-18--program-validation-without-ajv-the-editor-ports-later); CI enforces a gzip size budget.

## D-15 — Program update endpoint *(Decided 2026-08-20)*

**Decision:** add `PUT /api/v2/programs/{id}`. The path is the authority on
the id (as the filename is on flash), so a body declaring a different `id` is
a `400`, never a rename. Shipped programs are `409`. **A loaded program is
`409`** — the client unloads first.

**Why:** verification confirmed `POST /programs` has no replace path at all;
it always assigns a new id. The webapp's legacy program editor needs an update
path, and `/update` as a verb (v1's shape) is not what a REST client
generated from the contract expects.

Refusing while loaded is the substantive half. `ProgramState` holds a bare
`const rt::Program *` into the repository map, and the run loop reads the
series through it; replacing the value under a running program would swap the
series out mid-run and desynchronise the indices already published over
`stateUpdate`. Every alternative needs an invented policy — reset to event 0,
keep the elapsed time, abort the run — for a situation that has no good answer
during a range session.

**Rejected:** documenting `POST` with an id as the update path (it does not
replace); v1's `POST /programs/{id}/update`; silently renumbering a mismatched
body id; taking the executor lock and hot-swapping the loaded program.

## D-16 — `tickerMs` replaces `tickerSeconds` *(Decided 2026-08-20)*

**Decision:** `stateUpdate.programState` carries `tickerMs` — milliseconds
elapsed in the current series — and `tickerSeconds` is **removed**, not kept
alongside it. Whole seconds become a client-side derivation,
`Math.floor(tickerMs / 1000)`. The stream stays at `/sse/v2`; `asyncapi.yaml`
goes to `info.version: 3.0.0`.

**Why:** the time-scaled timeline positions its playhead from the ticker, and
whole seconds put it up to a second — a whole 3 s event on Fältträning — away
from where the targets actually are. The firmware already computes the exact
elapsed millisecond in `Executor::tick` and threw the sub-second part away.

Removing rather than adding is the substantive half. Two fields carrying the
same quantity is two sources of truth: they can disagree (which one does a
client trust when `tickerSeconds` is 7 and `tickerMs` is 6998?), every
mutation has to maintain both, and the redundancy is permanent while the
migration it exists for is not.

It is safe here because there is no deployed client to break: the webapp is
built into the LittleFS image and flashed with the firmware, so the two are
deployed atomically, and no `firmware-vX.Y.Z` tag has ever been cut. This is
a recorded exception to the contract's own "additive within a major version"
rule (`contracts/README.md`), and it stops being available the moment a
firmware is released.

**Note for the record:** the retired MicroPython backend
(`rotation_target_backend_app`) still emits `tickerSeconds`. It is not
imported, not maintained, and not a client of this contract; `contracts/history/`
keeps the v1 documents that describe it.

**Rejected:** publishing both fields through a deprecation window (no client
to deprecate for); `/sse/v3` (a whole new prefix for one field, and the only
client is in this tree); a millisecond *cadence* rather than millisecond
precision — the run loop already wakes at up to 200 ms and a frame per wake
would be 5× the SSE traffic to move a playhead nobody can see move that
finely. The frame cadence is unchanged: one per second, plus event
boundaries.

## D-17 — E2E runs against the firmware, in one CI job *(Decided 2026-08-20)*

**Decision:** the Playwright suite (`webapp/e2e/`) drives the webapp out of the
**LittleFS image**, served by the real firmware in QEMU — the bundle
`RT_WEBAPP_DIR` bakes in, not a dev-server proxy. It runs as its own workflow
(`webapp-e2e.yml`) in a **single job** inside `espressif/idf:v6.0.2`, with
Chromium installed into that container.

**Why:** testing the deployment artefact is the whole point — a proxy would
exercise a bundle nobody ships and would keep the mock in the loop. One job
because the emulator is Espressif's `qemu-xtensa` fork, which ships in the IDF
image and is not `apt`-installable on a bare runner: splitting the work would
mean installing that fork on the runner anyway, so adding a browser to the
container is the cheaper half. The image is Ubuntu 24.04, which Playwright
supports and installs its own deps for.

Own workflow rather than a job in `webapp-build` or `firmware-build`: its
`paths` filter is the union of both, it is allowed to take ~10 minutes where
those are kept fast, and its failures should not muddy either signal.

**Rejected:** a Vite dev server proxying to the emulator (tests a bundle that
is never shipped); two jobs passing `qemu_flash.bin` as an artefact (needs
qemu-xtensa on the runner regardless); `pytest-embedded-qemu` (a second test
framework for the same device).

**Not covered:** `backend_issue`, which needs audio hardware — QEMU emulates
no I2S, so the simulator profile builds with `RT_AUDIO_ENABLED` off and the
event cannot be provoked from outside the device.

## D-18 — Program validation without ajv; the editor ports later *(Decided 2026-08-20)*

**Decision:** the React Programs tab validates program documents with a
hand-written validator (`webapp/src/lib/program-document.ts`) written against
**`parse_program` in `firmware/lib/rt_logic/program.cpp`** — the firmware's
actual parsing, not the JSON Schema — instead of shipping ajv and Prism in the
React bundle. It is deliberately laxer than `contracts/program.schema.json` in
three places where the schema is stricter than the device: unknown fields are
warned-and-dropped rather than refused, only `title` and `series` are required,
and a negative duration is clamped rather than rejected. The **WYSIWYG program editor stays in the legacy app** until it
is ported (#73); `src_legacy` is not deleted before that lands.

**Why:** ajv plus Prism costs roughly 45 KB gz for what is, on this device, one
form. The hand-written validator also does something the schema cannot: it
reports what the firmware will *silently change* — clamped durations, dropped
unknown fields, an ignored `readonly` — before the upload rather than after.

The editor is deferred because it is 2688 lines of legacy JS whose Form, Events
and Timeline views are three renderings of the same edit operations, with the
reordering, context-menu and selection logic triplicated. A faithful port is
~1000–1200 lines of TSX after deduplication; folded into the list PR it would
land as one unreviewable squash commit. What shipped is complete on its own
terms — every operation the legacy tab performs against the device is present,
and programs can be created and replaced by file — so there is no half-built
editor in the new app.

**Rejected:** ajv in standalone (build-time compiled) mode — still a build
complication for one form; porting the editor partially; deleting `src_legacy`
before authoring exists in React.

**Known cost:** the validator and the schema are now two hand-maintained
descriptions of one document, which is the drift shape that produced the 100x
`duration` bug (D-01). A comment is the only thing holding them together today.
Close it structurally before the editor lands (#73) — either generate the
validator from the schema so drift is a build failure, or cross-check the two
in a test over the shipped programs plus hostile inputs.

## D-19 — REST errors become RFC 9457 problem details *(Decided 2026-08-20, implementation pending)*

**Decision:** every REST error response becomes an RFC 9457 problem detail
served as `application/problem+json`, carrying `type`, `title`, `status` and
`detail`. `instance` is omitted — it identifies a single occurrence, which
means nothing on a device with no request ids. `type` is a stable relative URI
(`/problems/<slug>`) that is never dereferenced.

**The slug vocabulary is shared with the SSE `backend_issue` codes**, so the
system speaks one error language on both channels rather than two.

**Why:** the API has 39 error sites and the shape is `{"error": "prose"}`.
Four distinct reasons already answer `409` — admin not enabled, audio playing,
program loaded, program read-only — and the audio-deletion guard adds three
more. A client that must react differently to them (the Programs tab does:
"loaded" means offer to load another, "read-only" means offer upload-as-new)
can only tell them apart by **string-matching English prose**. That breaks on
any rewording and cannot be localised for a Swedish club. The SSE side already
solved this with `backend_issue`'s `{code, message, context}`; REST never got
the same treatment.

RFC 9457 over a home-grown `code` field: the discriminator is where the value
is, but the standard costs little more, ends the field-naming argument, and the
existing tooling understands it — Redocly lints `application/problem+json`, and
`openapi-typescript` gives the webapp a discriminated union to switch on.

**Why now:** the same window that made D-16 safe is still open. No `firmware-v*`
tag has been cut, and the webapp ships inside the firmware image, so producer
and consumer deploy atomically — there is no skew period where an old client
meets a new error shape. After the first release this becomes a breaking change
with deprecation cost, and the error surface grows every week.

**Rejected:** a bespoke `{"error", "code"}` pair (cheaper, but a convention
every future contributor must be taught); `instance` (no request ids);
converting piecemeal (would leave a half-and-half API — one focused PR changes
the helper, all 39 sites, the contract, the webapp and the mock together).

## D-20 — `Event.command` is a closed vocabulary *(Decided 2026-08-20)*

**Decision:** `command` stays optional, but a value the device does not
recognise is now a **parse error**, not a no-op. `parse_program` accepts an
absent key, JSON `null` and `""` as "leave the targets where they are", accepts
`"show"` and `"hide"`, and refuses anything else — a non-string, a misspelling,
a different case — failing the whole program the way malformed JSON does.
`POST /programs` and `PUT /programs/{id}` therefore answer `400 Invalid
program`. The contract loses the sentence that blessed the old behaviour
("Omitted, or **any other string**, leaves them where they are"), which
contradicted the `enum: [show, hide]` three lines above it.

`null` and `""` are accepted rather than refused because both are in-tree
spellings of absence: the legacy program editor writes `command: null` for its
"no change" radio button (`program_editor.js:1263`), and `""` was the parser's
own default for a missing key. Neither is ever emitted — `event_json` omits the
key — so nothing round-trips either back out, and refusing them would break the
editor for no gain in safety. Neither is in the schema.

**Why:** a typo made the target silently not turn. `{"command": "shwo"}`
uploaded happily, and the failure surfaced mid-exercise as a target that just
did not move — the same class of quiet failure as a clip that fails to play,
which D-09 and #79 already treated as a range-safety problem rather than a UX
one. **Both clients were already strict** (the React validator in
`webapp/src/lib/program-document.ts`, the legacy editor's ajv schema); only the
device was lax, so the enum was already the de-facto contract and nothing
depended on the laxness. Across all seven shipped programs the only values are
`show` (300), `hide` (186) and absent (125) — no empty strings and no other
values — so strictness breaks nothing shipped.

**Migration:** a stored upload with a bad command stops loading at boot.
`programs::load_dir` skips the file, logs `W programs: Malformed program
<path>`, and raises the `program_invalid` `backend_issue` naming it — but that
frame is **dropped**: `load_all()` runs at `app_main.cpp:58`, `web_server::start()`
at `:76`, and `sse_hub::enqueue` returns early while there is no server, exactly
as its comment says. So today a bad stored program is visible on the serial log
and by its absence from `GET /programs`, and *not* to a browser. Verified in
QEMU with a hand-planted `uploads/programs/200.json`.

That is a pre-existing gap in the `program_invalid` path, not one this change
introduces — it just gives it its first likely trigger. Closing it wants a
boot-issue buffer replayed to the first SSE client, or a rescan on connect;
either is its own change. In the meantime the club-visible symptom of a typo is
a program that fails to upload (`400`, at the moment of the typo), which is the
case this decision is actually about.

**Rejected:** *deleting the enum* and blessing the lax behaviour — it makes the
contract self-consistent by writing the hazard into it, and forces both clients
to loosen. *Accept but warn* (parse it, emit a `backend_issue`) — the program
still runs wrong, and the warning arrives on a channel nobody is watching at
upload time; a `400` at the moment of upload is the only feedback that reaches
the person who made the typo. *Normalising unknown values to "no command"* —
same silent-no-op outcome, just spelled deliberately.

**Follow-up (webapp, required):** #72 (React Programs tab) is unmerged and its
mock server and one E2E test deliberately assert that `command: 'sideways'`
survives a round trip. That assertion is false after this change and must be
inverted once #72 lands; `program-document.ts`'s header note, which records
that it is deliberately stricter than the firmware on `command`, must say that
the two now agree.

## Open questions

- **Are `app` / `x86_linux` used by anyone?** (asked — drives D-03's
  archive-or-keep follow-up)
- **LICENSE / copyright unification** across the imported repos (org vs
  individual).
- **Admin mode is off after every boot** — acceptable security posture, or a
  cross-component contract change?
- **CORS:** firmware allowlist vs MicroPython reflect-any — the contract
  must pick one.
- **Reinstate `GET /status`** as a v2-shaped snapshot for debugging?
