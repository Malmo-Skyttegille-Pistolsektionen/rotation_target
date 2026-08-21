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
| D-16 | `tickerMs` replaces `tickerSeconds` | Decided | 2026-08-20 |
| D-17 | E2E runs against the firmware, in one CI job | Decided | 2026-08-20 |
| D-18 | Program validation without ajv; the editor ports later | Decided | 2026-08-20 |
| D-19 | REST errors become RFC 9457 problem details | Decided | 2026-08-20 |
| D-20 | `Event.command` is a closed vocabulary | Decided | 2026-08-20 |
| D-21 | An npm `override` must be truthful | Decided | 2026-08-20 |
| D-22 | `POST /programs/unload` | Decided | 2026-08-21 |
| D-23 | A refused delete is `409`, not `404` | Decided | 2026-08-21 |
| D-24 | One `libraryChanged` SSE event | Decided | 2026-08-21 |
| D-25 | Boot-time issues are served, not streamed | Decided | 2026-08-21 |
| D-26 | An audio upload is never refused for concurrency | Decided | 2026-08-21 |
| D-27 | A start names the program it is for | Decided | 2026-08-21 |

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

**Amended by D-24 (2026-08-21):** frames raised before the server exists are no
longer dropped — they are kept and served by `GET /api/v2/diagnostics/info`.
Fire-and-forget still describes the stream itself; what changed is that an
issue nobody could have been listening for is no longer lost.

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

**Amended 2026-08-21 (`src_legacy` removed):** the editor is ported (#73), so
the condition this guardrail was waiting on is met and `src_legacy` is
**deleted** — with `legacy.html`, the `/legacy` route and nav link, the v1 mock
`vite-plugins/mock-server.ts`, the schema-sync plugin and the icons only it
used. `prismjs` and `@types/prismjs` go with it; **`ajv` stays** as a
test-only devDependency, because `test/program-document-schema.test.ts` is the
cross-check D-18 asked for. The gzip total drops from 197 755 to 133 022 bytes
and the budget with it. The v1 implementation is in git history; there is no
second copy of anything left to keep in step. The rest of the guardrail —
devtools dev-only, CI size budget — is unchanged.

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

**Amended 2026-08-21 (#76):** "the client unloads first" was, when this was
decided, an instruction with no endpoint behind it — v2 had no unload verb, so
the only ways to clear the selection were to load a different program or delete
the loaded one. `POST /api/v2/programs/unload` (D-22) closes that; the `409` now
names a call the client can actually make.

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

**Amended 2026-08-21 (the editor is ported):** #73 landed, and it validates
with `src/lib/program-document.ts` as this decision required — no ajv, no
Prism in the bundle. The editor adds ~12 KB gz where the legacy one cost ~65 KB
gz including those two libraries. Two things this decision left open are now
settled by the port: the legacy editor's five view tabs became two (Form,
Events and Timeline were three renderings of the same edit operations), and
`authoringIssues` was added to the validator for the checks that only apply to
a document under edit — an unnamed series and an empty one, both of which the
device accepts and no author means. With the editor ported, `src_legacy` is
deleted; see the amendment on [D-14](#d-14--webapp-guardrails-decided-aug-2026).

**Known cost:** the validator and the schema are now two hand-maintained
descriptions of one document, which is the drift shape that produced the 100x
`duration` bug (D-01). A comment is the only thing holding them together today.
Close it structurally before the editor lands (#73) — either generate the
validator from the schema so drift is a build failure, or cross-check the two
in a test over the shipped programs plus hostile inputs.

**Amended 2026-08-20 (implementation):** the cross-check landed —
`webapp/test/program-document-schema.test.ts` compiles the schema with ajv (a
devDependency already, so nothing is shipped) and runs both descriptions over
the shipped programs and a hostile-input table. The divergences now live in one
`DIVERGENCES` table with the `program.cpp` behaviour that justifies each; a new
one fails the run until it is written down, and an entry nothing exercises
fails too. Generating the validator from the schema was rejected: the schema
cannot express what the *device* does, which is the whole point of the
validator.

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
introduces — it just gives it its first likely trigger. In the meantime the
club-visible symptom of a typo is a program that fails to upload (`400`, at the
moment of the typo), which is the case this decision is actually about.

**Closed by D-24 (2026-08-21):** the boot-time issues are kept and served as
`startupIssues` on `GET /api/v2/diagnostics/info`, so a stored program that
stops loading after this change names itself to a client rather than only to
the serial console.

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

## D-21 — An npm `override` must be truthful *(Decided 2026-08-20)*

**Decision:** `overrides` in `webapp/package.json` are allowed **only** to assert
that a declared peer range is *conservative* — i.e. the package genuinely works
with the overridden version, and we can show it. An override that papers over a
real incompatibility is not allowed, and **`--legacy-peer-deps` and `--force`
are rejected outright** (they relax every peer check in the tree, not the one
under discussion). Each override carries a comment naming the evidence.

**Why:** a green check over a knowingly broken dependency tree is worse than a
red one, because it removes the signal without removing the problem. Two
worked examples decided this rule:

- **Positive — TypeScript 6 (PR #67).** `openapi-typescript@7.13.0` peers
  `typescript@^5.x`, blocking the upgrade. The generator uses only TypeScript's
  stable AST factory and printer surface, never the program or checker APIs,
  and under TS 6 it regenerates `src/api/generated.d.ts` **byte-identically**.
  The peer range is merely conservative, so
  `"overrides": {"openapi-typescript": {"typescript": "$typescript"}}` states
  something true, scoped to that one package.
- **Negative — ESLint 10 (PR #69).** `eslint-plugin-react@7.37.5` peers
  `eslint ... || ^9.7`. Forcing it installs and then dies on the first file
  (`context.getFilename()` was removed in ESLint 10). The range is accurate;
  an override there would be a lie, so the dependency was dealt with instead.

The test is therefore not "does CI go green" but **"is the assertion the
override makes actually true, and what is the evidence?"**

**Rejected:** `--legacy-peer-deps` in `.npmrc` or CI; broad
`overrides` that retarget a package everywhere rather than under one parent;
pinning a dependency back to dodge the question without saying so.

## D-22 — `POST /programs/unload` *(Decided 2026-08-21)*

**Decision:** add `POST /api/v2/programs/unload`, admin-gated like every other
mutation. It clears the selection and publishes a `stateUpdate` with
`loadedProgramId: null`. **A run in progress is `409`** (`A program is running -
stop it before unloading`). **Unloading nothing is `200` and publishes
nothing.**

**Why the endpoint:** D-15's `409` on a loaded program, and #79's `409` on
deleting a clip the loaded program plays, both tell the client to "unload" —
a verb v2 did not have. The only ways to clear `loadedProgramId` were loading
some *other* program or deleting the loaded one, so the honest instruction was
"load something else first", which is a workaround standing in for a missing
operation, and the ported Programs tab had to say so out loud.

**Why `409` while running:** unloading is bookkeeping; a call that reads as
bookkeeping must not end a series mid-range. Every alternative is worse in the
same way D-15 found: unload-and-stop hides a range-visible side effect behind a
housekeeping verb, and a `force` flag invents a policy for a situation with no
good answer during a session. The refusal is never a dead end — `stop` is a
pause, so the escape is exactly one call away, and `stop` then `unload` is the
same two-step the run controls already use.

**Why `200` with no broadcast when nothing is loaded:** the endpoint states an
outcome ("nothing is loaded"), and a client that asks for a state the device is
already in has not made an error — so `200`, not `400`, and the same message
either way, which is what makes a retry after a dropped response safe. The
broadcast is skipped because the payload would be byte-identical to the one
already sent: SSE here is a change notification, and the firmware's `flush()`
has always been change-gated rather than request-gated. A repeat frame would
teach clients that a `stateUpdate` need not mean a state update.

**Where the refusal lives:** in `rt::Executor::unload()` (host-tested), not in
the handler, so the check and the clear happen inside one locked section — a run
starting between an `is_running()` probe and the clear would otherwise be
unloaded by a call that had already decided it was safe. The unconditional
`force_unload()` stays for the delete path, where the run loop's pointer into
the program would dangle and refusing is not an option.

**Rejected:** `DELETE /programs/loaded` (reads as deleting a program);
`POST /programs/0/load` or a null-bodied load (overloading the id space);
stopping the run as a side effect; a `force` query flag; `204 No Content`
(every other mutation here answers a `Message`); `404` or `400` for "nothing
loaded" (an idempotent operation has no error to report).

## D-23 — A refused delete is `409`, not `404` *(Decided 2026-08-21)*

**Decision:** `DELETE /programs/{id}/delete` and `DELETE /audios/{id}/delete`
answer **`409`** for a shipped (read-only) program or clip — `Program is
read-only and cannot be deleted`, `Audio is read-only and cannot be deleted`.
`404` is left meaning exactly one thing: it is not there. On the audio path the
read-only check goes ahead of the three run-safety `409`s from #79, because it
is the only reason that never lifts.

**Why:** the two write paths disagreed with each other. `PUT` on a shipped
program is already a `409` (D-15) while `DELETE` on the same program was a
`404`, so a client could not tell "refused because it is shipped" from "gone"
— and the Programs tab, which needs exactly that distinction to decide between
"offer upload-as-new" and "refresh the list", had to sidestep it by hiding
Delete on shipped rows. It is the same complaint D-19 makes about `409`s that
can only be told apart by string-matching prose, one level up: here even the
status code was ambiguous.

**There is no information-hiding argument to weigh.** Every shipped id is
public: `GET /programs` lists them, `GET /programs/{id}` serves them in full,
and `readonly: true` is in the payload. The `404` concealed nothing; it only
cost the client the reason.

**This is a changed status code**, which `contracts/README.md` reserves for a
new `/api/v3` prefix. Taken as the second exception to that rule, on D-16's
grounds and while the same window is open: the only client ships inside the
firmware image, so producer and consumer deploy atomically, and no
`firmware-v*` tag has been cut. `openapi.yaml`'s `info.version` goes to
`3.0.0` — the same way `asyncapi.yaml` went to `3.0.0` for D-16 while the path
prefix stayed `v2`. After the first release this would need a deprecation
path, which is the argument for doing it now rather than later.

**Rejected:** `403` (the request is well-formed and authorised — the *state* of
the resource is what refuses it, which is what `409` means, and it is already
what `PUT` answers); keeping `404` and adding a distinguishing body (a client
would have to parse prose to recover what the status line should have told it);
changing only the program path and leaving audio asymmetric (same issue class,
same fix, and the audio path was about to grow a fourth `409` next to a `404`
that meant two different things).

**Follow-up (webapp, required):** `webapp/test/mock-server/server.ts` still
models a shipped-program delete as `404`, and `mock-server.test.ts` asserts it
(`deletes an uploaded program and hides a shipped one behind the same 404`);
the comment at `webapp/e2e/audios.spec.ts:35` says shipped clips answer `404`
to a delete. All three must follow the firmware. Not done here: the React
Programs and Audios work owns those files in parallel.

## D-24 — One `libraryChanged` SSE event *(Decided 2026-08-21)*

**Decision:** v2 SSE gains a fourth event, `libraryChanged`, with the payload
`{"kind": "audio" | "program"}`. It is emitted from the REST handlers after a
program is created, replaced or deleted and after an audio clip is uploaded or
deleted; the client refetches the list `kind` names. No id, no operation, no
per-item delta. `kind` is a **closed** enum, unlike `backend_issue`'s `code`.

**Why:** the library is fetched over REST and published nowhere, so a client
only ever learned about its own mutations. With a laptop and a phone both open
at the range — the normal case — the second one shows a program that has been
uploaded but cannot be found, or offers a clip that is already deleted, until
somebody reloads the page. #71 shipped the ported Audios tab with exactly that
limitation written down.

One event rather than v1's four (`audio_added`, `audio_deleted`,
`program_added`, `program_deleted`): four events name an *operation*, which is
only worth knowing if the client applies a delta, and a delta needs the changed
document in the payload. The client already has a list endpoint that is cheap
and authoritative, and a refetch cannot drift from the device the way an
applied delta can — the same argument that makes `stateUpdate` a full snapshot
rather than a diff. Four events would also mean four contract entries, four
emission vocabularies and four chances for a client to handle three of them.

`{kind}` rather than an empty payload: the two lists are independent and audio
is the expensive one (77 clips shipped). An empty payload makes every program
upload refetch the clip list too, on a device with one HTTP task and twelve
sockets. One field removes that for free.

Closed `enum` rather than `x-extensible-enum`: D-09 argued the issue *codes*
are open because any future failure can raise one. Library kinds are not — the
set is exactly the collections this API exposes, so a third one arrives with
its own REST endpoints and a version bump of the document. A client should
still ignore a `kind` it does not know rather than refetch everything.

**Emitted from the handlers, not the repositories.** `programs::load_dir` is
also the boot scan, and `update_uploaded` has failure paths that leave the
store untouched; the handler is the one place that knows the change reached
flash and the response is a success. It also keeps "a client changed the
library" in the file that serves clients.

**Not emitted on `load`, `start`, `stop`, `reset`, `skip_to` or `unload`** —
those change what the device is doing, not what it stores, and `stateUpdate`
has always covered them. Deleting the loaded program emits both events, for
its two different reasons.

**Rejected:** *doing nothing* and documenting manual refresh (option 1 in #74)
— the staleness is silent and the person who needs to know is the one who did
not touch the device. *Reinstating the four v1 events* (option 3) — see above.
*Per-item deltas* — a second serialization of the program document to keep in
step with `GET /programs`, for a list that is seven entries long.

## D-25 — Boot-time issues are served, not streamed *(Decided 2026-08-21)*

**Decision:** `GET /api/v2/diagnostics/info` gains `startupIssues`, an array of
the `backend_issue` payloads raised before the HTTP server existed — same
`{code, message, context}` shape, same `code` vocabulary. `sse_hub` keeps them
instead of dropping them, bounded at **8** (`kMaxStartupIssues`), oldest
dropped. Empty on a clean boot. Nothing is pushed; a client that wants them
asks.

**Why:** `program_invalid` was a documented code that nothing could deliver.
`programs::load_all()` runs at `app_main.cpp:58` and `web_server::start()` at
`:76`, and `sse_hub::enqueue` returns early while there is no server — by
design, and its comment said so. So a stored program that would not parse was
skipped, vanished from `GET /programs`, and left one `W programs: Malformed
program <path>` line on a serial console nobody at a range is watching. To a
browser the program had simply ceased to exist. D-20 made that the migration
story for every club-uploaded program with a typo in `command`.

**Option 3 from #81, not option 1 (replay to the first SSE client).** Replay is
the more expensive shape and the less honest one: it would make the stream
carry history, which D-09 deliberately decided it does not, and it has to pick
a policy for the second client (replay again? never again?) that is wrong for
somebody. These issues are a *boot fact*, like `resetReason` and
`coredumpPresent` — they describe the state the device came up in, do not
change while it is up, and belong on the endpoint that already answers "what
happened to this device". Option 2 (rescan the directory when the server
starts) was rejected too: it re-reads and re-parses every stored program at
boot to produce information the first scan already had, and doubles a path
that must not disagree with itself.

**The store needs no lock, and that is structural rather than a bet.** The only
append is `broadcast_issue`'s existing `s_server == nullptr` branch, and
`s_server` is set once in `attach()` before the server can accept the request
that reads the list — every write happens-before every read. It is also
single-writer today: the boot scan is the only pre-server emitter, on the main
task, and the audio path cannot reach `broadcast_issue` before a run, which
needs a request. There is no rescan path. **Adding one, or any other pre-server
emitter on a second task, means revisiting this** — said so in the code, in
`docs/api-v2.md` and here, because it is the one assumption that would fail
quietly.

**Bounded at 8, oldest dropped.** The input is a directory of files, so an
unbounded list is an unbounded allocation at boot on a device with 512 KB of
heap. Oldest-dropped rather than newest-refused so the array reflects where the
scan finished; the consequence — an array of exactly 8 may be truncated — is
written into the contract rather than papered over with a count field nobody
would read. The bound and the ring live in `rt::IssueBuffer` in `rt_logic`, so
both are host-tested rather than asserted.

**Same shape as `backend_issue`, deliberately.** D-19 will formalise the slug
vocabulary across REST and SSE; a second spelling of "the device could not do
something" invented here would be one more thing for it to unify. The `code`
stays `x-extensible-enum` for the same reason it is one on the stream.

**Rejected:** *doing nothing* — leaves a code in the contract that nothing can
deliver, which is worse than not specifying it. *A dedicated
`GET /diagnostics/startup-issues`* — a second endpoint for a field, when the
client fetching diagnostics wants both. *Emitting them on SSE connect* — see
option 1 above.

## D-26 — An audio upload is never refused for concurrency *(Decided 2026-08-21)*

**Decision:** `POST /api/v2/audios` no longer refuses an upload because another
is "in flight". A new upload always proceeds, and it starts by discarding
whatever the previous one left in the single staging slot — from the upload
handler's middleware, which runs before the body is streamed, and again when
the audio routes are registered at boot. `s_upload_in_flight` survives only as
the marker that says the last request never reached `onRequest`; the log line
it now produces is the diagnostic that used to be a refusal.

**Why:** the guard modelled a situation that cannot occur and caused one that
can. `ENABLE_ASYNC` is off, so `esp_http_server` serves one request at a time
and two uploads never overlap — the only way the flag was set when a new upload
began was a *stuck* flag from an upload whose connection died mid-body, which
returns `ESP_FAIL` out of `MultipartProcessor::process()` and so never reaches
`onRequest`, the only reset. Vendored `_handleUploadByte` then discards the
upload callback's return value, so refusing skipped one 8 KiB chunk rather than
the request: a single-chunk clip vanished (`400 No file uploaded`), and a
multi-chunk clip lost its first 8 KiB and was appended to the dead upload's
leftovers, because the staging file is only truncated by the `index == 0` open
that the refusal returned before. Measured in QEMU on a 352 844 B WAV: `400
Unsupported audio format`, `400 No file uploaded`, or `201` on a file 8 192 B
short at the front and 16 384 B long at the back (#97).

**Rejected:** *patching `_handleUploadByte` to honour the callback's return* —
`lib/psychic_http` stays byte-identical to upstream
(`firmware/CONTRIBUTING.md`), and it would only
turn silent corruption into a clean refusal of an upload that has no reason to
be refused. *Keeping the refusal and clearing the flag on socket error* — there
is no error path in the vendored layer to hang it on. *Dropping the flag
entirely* — an interrupted upload is worth one warning line on the serial
console, and the staging file still has to be discarded for the same reason.

**Contract:** the `POST /audios` prose in `contracts/openapi.yaml` and
`firmware/docs/api-v2.md` claimed a second concurrent upload was refused, which
was never modelled by a response and is now wrong in a second way. Both now say
that no upload is refused for the staging slot and that an interrupted one
leaves nothing behind — closing the unresolved half of #75.

## D-27 — A start names the program it is for *(Decided 2026-08-21)*

**Decision:** `POST /api/v2/programs/start` takes a **required** body
`{"id": N}` — the program the caller decided to start. A device holding a
different one refuses with **`409`** and names both:
`Start refused: the device has program 1 loaded, not program 40`. A malformed or
absent body is `400`. Nothing loaded stays `400 No program loaded`, unchanged.
The comparison happens inside `rt::Executor::start(int32_t)`, so the check and
the start are one locked section.

**Why:** `start` carried no id, so it started whatever the device held when the
request landed. #92 closed every *client-side* window — the armed countdown, the
fire-time re-check against the query cache, the SSE-status guard — and none of
them can be airtight, because the ambiguity is in the request rather than in the
client: between a client's last knowledge and its start arriving, another client
on the range can always load something else. On a range that is wrong target
timing and wrong spoken range commands, with shooters acting on a sequence
nobody chose (#70 is the observed instance). Same class as #79's audio-delete
guard and #80's strict `command` vocabulary: **the device enforces the safety
invariant, clients merely explain it.**

**Why required, not optional:** an optional id keeps a spelling of the request
that means "run whatever you happen to hold", which is precisely what is being
removed — and it would be the spelling every future client reaches for first,
because it is shorter. The cost of requiring it is one caller (`run.tsx`, which
after #92 already computes the armed id at fire time and now sends it) and a
webapp that ships inside the LittleFS image, so there is no client that can be
left behind. Optional-with-a-warning would also mean the device cannot tell a
client that omitted the id from one that has not been updated, which is exactly
the distinction an operator would need if it ever went wrong.

**Why `409`, and why both ids:** the request is well-formed and authorised — the
*state* of the device is what refuses it, which is what `409` means, and it is
already the answer `PUT` (D-15), `DELETE` (D-23) and `unload` (D-22) give for
the same reason. Naming only the requested id would leave the operator with "not
that one" and no way to find out what the device does hold without a second
round trip; naming only the loaded one would not say which decision was
rejected. Both, in the order the operator needs them: what is loaded first.

**Why "nothing loaded" stays `400`:** it is the more precise diagnosis of two
that a `409` would blur together, and it is actionable in a different way — load
something, rather than re-read what is loaded. It is also the answer that
endpoint already gave, so nothing that is not the point of this change moves.

**Why in the executor rather than the handler:** an `is_loaded(id)` probe
followed by `start()` is two locked sections with a window between them, and a
load landing in that window starts the program the check had just cleared —
the same reasoning D-22 applied to `unload`. Returning the loaded id from
inside that same section is what lets the refusal name a program that is still
the one that refused it.

**This is a breaking change to an operation** — a new required body — which
`contracts/README.md` reserves for a new `/api/v3` prefix. Taken as the third
recorded exception, on D-16's grounds and while the same window is open: the
only client ships inside the firmware image, so producer and consumer deploy
atomically, and no `firmware-v*` tag has been cut. `openapi.yaml`'s
`info.version` goes to `4.0.0`. After the first release this would need a
deprecation path, which is the argument for doing it now rather than later.

**Rejected:** *an `If-Match` precondition on `loadedProgramId`* — a correct
shape, but it needs an ETag on a resource that is not fetched (run state is
published over SSE, and there is no `GET /status` to carry the header), and it
puts the safety-critical check in a place every HTTP intermediary is entitled to
touch. *An `id` query parameter* — the other mutations that carry data carry it
in a body, and a run-control call is not a lookup. *Refusing with `400`* — the
request is valid; it is the device's state that says no. *`412 Precondition
Failed`* — reserved for the header form, and `409` is what every other
state-refusal on this API already answers. *Keeping the client-side guards as
the whole answer* — they stay, because they explain the refusal before it
happens and cancel a countdown the operator can still see, but they are the
explanation, not the enforcement.

**Follow-up (`skip_to`, filed, not done here):** `POST /programs/series/{index}/skip_to`
has the same shape of ambiguity — it selects a series on whatever is loaded, and
a program switched underneath it silently re-aims the next start at a series of
a program nobody chose. It is a lesser instance (it arms rather than runs, and
the `start` that follows is now itself checked), so it is a separate issue
rather than scope creep here.

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
