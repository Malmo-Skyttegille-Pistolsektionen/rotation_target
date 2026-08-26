# API v2

The device serves the SSE-first contract the React webapp speaks:

- REST base: `/api/v2`
- SSE endpoint: `/sse/v2`

There is no v1 on this firmware.

**The canonical machine-readable contract is [`../../contracts/`](../../contracts/README.md)**
— `openapi.yaml` for REST, `asyncapi.yaml` for SSE, `program.schema.json` for
the program document. Those files are authoritative on routes, shapes and
status codes, and a change to any of them lands in the same PR as the firmware
change it describes.

This document is the prose companion: the *why* behind the contract, and the
execution semantics no schema can express. It deliberately does not repeat the
route list.

## Errors

Every REST failure is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
problem detail, served as `application/problem+json` (D-19):

```jsonc
{
  "type": "/problems/program_readonly",   // the discriminator
  "title": "Program is read-only",        // stable, one per type
  "status": 409,                          // same as the response line
  "detail": "Program is read-only and cannot be deleted"
}
```

**`type` is the only member to branch on.** It is a relative URI and is never
dereferenced — nothing is served at `/problems/`; it is an identifier that
happens to be spelled as a URI, which is what RFC 9457 asks for. `title` is
short and identical for every occurrence of a type, so it says nothing about
*this* one; `detail` is the sentence to put in front of a user, and its wording
may change at any time. `instance` is omitted: it identifies a single
occurrence and there are no request ids on this device.

The reason this exists is that four distinct refusals answer `409` and a client
has to react differently to each. Before D-19 the only way to tell them apart
was to string-match English prose — which broke on any rewording and could
never be translated for a Swedish club.

One status per type, always. `rt::ProblemType` (`lib/rt_logic/problem.h`)
carries the status next to the slug and the title, so a type and the status it
is answered with cannot drift apart, and `contracts/openapi.yaml` can therefore
list exactly which types each operation produces under each status code.

### The vocabulary is shared with `backend_issue`

A failure that means the same thing on both channels is spelled the same way:
a program that will not parse is `/problems/program_invalid` over REST and
`program_invalid` in a `backend_issue` frame. `host_test/test_problem` asserts
the two constants stay equal, so renaming one without the other fails the
build.

`audio_playback_failed` has no REST counterpart, because playback is
acknowledged before the clip is read — a failure after that point has no
request left to answer.

### For clients

Branch on `type`, and **fall back to `status` and `detail` for a type you do
not recognise**. New types are additive: a client may be older than the
firmware it is talking to, and a problem it cannot classify is still a problem
it can display. The full list lives in one place, the `enum` on
`Problem.type` in `contracts/openapi.yaml`, and reaches the webapp as a
generated TypeScript union — so a renamed slug is a `tsc` failure at every
comparison site rather than a branch that quietly stops matching.

## State model

`stateUpdate` is the only channel run state is published on. There is no
`/status` endpoint — a client connects to `/sse/v2`, receives the full state
immediately, and receives it again after every change.

```jsonc
{
  "loadedProgramId": 1,        // null when nothing is loaded
  "programState": {            // null when nothing is loaded
    "running": true,
    "currentSeriesIndex": 0,
    "currentEventIndex": 2,
    "tickerMs": 7480           // milliseconds elapsed in the current series
  },
  "targetStatus": "shown"      // "shown" | "hidden"
}
```

`currentEventIndex` is derived from elapsed series time rather than tracked per
event, so a paused run resumes at whatever event `tickerMs` lands in.

`heartbeat` (`{"id": n}`) is emitted every 10 seconds.

`backend_issue` (`{"code", "message", "context"?}`) is the third event, and the
only one that is not about run state: it reports a failure the device noticed
on its own, where no request exists to answer with an error. Today that is a
clip that would not play (`audio_playback_failed`, raised from the playback
task) and a stored program file that would not parse (`program_invalid`, raised
by the boot scan).

It is fire-and-forget by design. Nothing is buffered for a client that connects
later and nothing is replayed on reconnect, so the event is a notification and
the device log remains the record.

The boot scan is the exception, because it runs before there is anything to
notify: `load_all()` is several steps ahead of the HTTP server, so a
`program_invalid` raised there has no client and never will. Those frames are
kept instead of dropped and served by `GET /api/v2/diagnostics/info` as
`startupIssues` — see below.

`libraryChanged` (`{"kind": "audio" | "program"}`) is the fourth, and says the
stored library is no longer what the client last fetched: refetch the list
`kind` names. It is emitted after a program is created, replaced or deleted and
after a clip is uploaded or deleted — that is, from the REST handlers, once the
change is on flash and the response is decided.

It is a cache-invalidation signal, not a delta: no id, no operation. The client
re-issues the GET it would have made anyway, which is the same reason
`stateUpdate` carries the whole state. Without it a laptop and a phone open at
the same range only saw their own uploads, and the other list stayed stale
until somebody reloaded the page.

**Loading, starting, stopping, resetting and skipping emit nothing here.** They
change what the device is doing, not what it stores, and `stateUpdate` already
covers them. Deleting the *loaded* program emits both events, for the two
different reasons.

## Execution semantics

| Call | Effect |
|------|--------|
| `load` | Selects the program, series 0, event 0, `tickerMs` `null` |
| `start` | Resumes from `tickerMs`, or runs the series from 0; `409` for another program |
| `stop` | Pauses and keeps the position |
| `reset` | Rewinds to the start of the current series |
| `skip_to` | Selects a series, paused at its first event; `409` for another program |
| `unload` | Clears the selection; `409` while running |

When a series finishes and another follows, execution pauses at the start of the
next series and the targets are hidden. When the last series finishes, execution
stops with the series still selected.

`start` carries `{"id": N}` — the program the caller decided to start — and a
device holding a different one answers `409 /problems/start_program_mismatch`,
with `detail` naming both ids so the operator knows what the device actually
holds. A body that does not name an integer id is
`400 /problems/start_id_required`. The id is required: an id-less start asks for whatever
happens to be loaded when the request lands, and that is the ambiguity the body
exists to remove. No client-side check can close it — between a client's last
`stateUpdate` and its start arriving, any other client can load something else —
and on a range the consequence is wrong target timing and wrong spoken commands.
So the device refuses and the client only explains, the same division as the
audio-delete guard and the strict `command` vocabulary. A refused start
publishes nothing and changes nothing. Nothing loaded stays `400`
(`No program loaded`): it is the more precise diagnosis, and it tells the client
to load rather than to re-read what is loaded.

`skip_to` carries `{"id": N}` too, for the same reason and in the same shape
(D-27, #105): it decides where the next `start` begins, so a program switched
underneath it would silently re-aim that start at a series of a program nobody
chose. A device holding a different program answers
`409 /problems/skip_program_mismatch`, naming both ids; a body that does not
name an integer id is `400 /problems/skip_id_required`. "Nothing is loaded, or
the index is out of range" still answers `400 /problems/series_index_invalid`,
checked after the id and unchanged by #105.

`reset` and `stop` do **not** take an id. Both are recoverable in one call and
neither decides what runs next: `stop` only pauses whatever is running, and
`reset` only rewinds whatever is loaded to the start of its current series -
neither can aim a run at a program the operator did not choose. `start` and
`skip_to` are id-checked because each is the one call that decides where
execution goes next; `reset` and `stop` never make that decision, so an id on
them would only add client complexity without closing a window that exists.

`unload` is the one control call that can be refused for reasons other than
"nothing is loaded". A run in progress answers `409` (`A program is running -
stop it before unloading`): clearing the selection is bookkeeping, and
bookkeeping must not end a series mid-range. `stop` is a pause, so the refusal
lifts as soon as the run is paused — the escape is always one call away. It is
also **idempotent**: unloading nothing answers `200` with the same message and
publishes nothing, since the `stateUpdate` would repeat what clients already
hold. That makes `200` mean "nothing is loaded now", never "something was
unloaded just now".

Deleting the loaded program still unloads it whatever the run state — the run
loop holds a bare pointer into the stored program, so there the choice is
between unloading and dangling, not between unloading and refusing.

Audio attached to an event plays when the run loop enters that event. Resuming
into the middle of an event does not replay its audio.

`tickerMs` is milliseconds at millisecond *precision*, not millisecond
*cadence*: a frame still goes out once a second and on every event boundary,
and the value it carries is the exact elapsed time at that moment. That is
what lets the webapp's playhead sit where the run is rather than up to a
second behind it, without multiplying the SSE traffic. Whole seconds, where a
client wants them, are `Math.floor(tickerMs / 1000)`.

The resume point is the last *published* ticker, so `stop` resumes from the
last frame rather than from the instant the pause arrived. Before D-16 that
was rounded down to a whole second as well, and a pause 250 ms into a series
rewound to event 0 with the targets shown again;
`host_test/test_executor` now asserts it stays in the event it paused in.

## Auth

The control lock is off until a client enables it, and it lives in RAM only — a
reboot returns the device to the unprotected state. The rule is simple enough
to state once: **every `GET` is public; every mutating endpoint is protected
while the control lock is on, except the three that have to work without a session —
`control-lock/enable`, `control-lock/login` and `control-lock/logout`.**

- `Authorization: Bearer <token>`, or `Cookie: control_lock=<token>`. The header is
  checked first; the cookie is the fallback
- `POST /api/v2/control-lock/enable` sets the password (any non-empty string) and
  returns a token; `409` if the control lock is already on
- `POST /api/v2/control-lock/login` exchanges the active password for another
  token; `409` if the control lock is off
- Both send `Set-Cookie: control_lock=<token>; Path=/; SameSite=Lax`
- `POST /api/v2/control-lock/disable` clears the password and invalidates every
  issued token — note this turns protection *off*, it is not "log out"
- `POST /api/v2/control-lock/logout` invalidates only the presenting token and
  clears the cookie, leaving the control lock on. This is what a client leaving a
  shared range laptop wants. It is itself unprotected, and answers `200`
  whether or not the token it was given was live: there is nothing to protect,
  since all it can do is invalidate a credential the caller already holds
- Tokens expire 12 hours after they are issued, and at most 8 sessions are
  held at once (oldest evicted first)

Tokens are 16 bytes from `esp_fill_random()`, hex-encoded.

**CORS allows credentials, against an allowlist.** The webapp sends the control lock
cookie and bearer token with every call, and a browser refuses
`Access-Control-Allow-Origin: *` on a credentialed request — so the origin is
echoed rather than wildcarded. It is echoed only if it matches the device's own
mDNS name or current IP, or `CONFIG_RT_DEV_ORIGIN`. Any other origin gets no
CORS headers, so a page the operator happens to be visiting cannot script the
device or read its responses.

Note that `SameSite=Lax` means the cookie is only sent when the webapp is served
from the device itself. A webapp on another origin authenticates with the bearer
token instead.

## Diagnostics

`GET /api/v2/diagnostics/info` reports firmware identity and health, so a range
incident is diagnosable without a USB cable:

```jsonc
{
  "version": "0.1.0-3-gab12cde", "idfVersion": "v6.0.2",
  "buildDate": "Aug 19 2026 11:42:03",
  "resetReason": "task_watchdog",   // poweron | panic | brownout | ...
  "uptimeSeconds": 5231,
  "freeHeapBytes": 214512, "minFreeHeapBytes": 198320,
  "freePsramBytes": 8210432,
  "runningPartition": "ota_0",
  "coredumpPresent": true,
  "storageTotalBytes": 10223616, "storageUsedBytes": 7812096,
  "programCount": 7, "audioCount": 77,
  "ipAddress": "192.168.1.42",
  "targetGpio": 5, "targetGpioLevel": 1,
  "controlLockEnabled": false,
  "startupIssues": [                // empty on a clean boot
    {
      "code": "program_invalid",
      "message": "Program file is malformed and was skipped",
      "context": { "file": "/userdata/programs/200.json" }
    }
  ]
}
```

It is public, like every other `GET`: it carries no credential and no program
data. `minFreeHeapBytes` is the low-water mark since boot — a leak that has
already been reclaimed is invisible in the current figure. `targetGpioLevel` is
read back off the pad rather than remembered, so the pair with `targetGpio`
distinguishes "the firmware never drove it" from "something else is holding it".

**The coredump is not in this response and never will be.** It is a raw RAM
snapshot and can contain the WiFi password in plaintext. It is served, bundled
with this response, by `GET /api/v2/diagnostics/bundle` below;
`coredumpPresent` says whether that bundle would carry one.

### `startupIssues`

The `backend_issue` events raised before the HTTP server existed, in the same
`{code, message, context}` shape the SSE stream uses — one vocabulary for a
device failure, not two. Today the only code that can appear is
`program_invalid`: a stored program that would not read or parse. Before this
the file was skipped, the program vanished from `GET /api/v2/programs`, and the
only trace was a `W programs: Malformed program <path>` line on a serial
console nobody at a range is watching. Since the device rejects an unrecognised
`command`, a club-uploaded program with a typo disappears exactly that way at
the next boot.

**At most 8 are kept, oldest dropped** (`kMaxStartupIssues`, `main/config.h`),
so an array of exactly 8 may be a truncated one and the log stays the complete
record. The bound is what keeps a directory full of unparsable files from being
an unbounded allocation at boot.

The list is **written during boot and read-only afterwards** — `sse_hub` keeps
an issue only while it has no server to send it through, and it has a server
from `web_server::start()` onwards. Nothing appears in it while the device is
up, so polling gains nothing; run-time failures such as `audio_playback_failed`
have a client to reach and go out over SSE as before. That single-writer,
publish-then-read shape is also why the store needs no lock: every write
happens before the server can accept the request that reads it. A program
rescan, or any other pre-server emitter on a second task, would change that.

### `GET /api/v2/diagnostics/bundle`

A `application/zip` holding `diagnostics.json` — the response above, byte for
byte — and `coredump.bin`, the raw coredump partition, when there is one. One
file to attach to a message; the diagnostics are what makes the dump decodable
once the board has been reflashed (D-39, #201).

Behind an open configuration window — three presses of the BOOT button within
ten seconds, the gesture Expert mode is behind — and behind nothing else. This
is the one response that can carry the WiFi password, so what has to be
established is that whoever collects it is standing at the board. A run holds
that window shut, so `403 /problems/hardware_config_window_closed` is also the
answer while a program is running. That 403 is the only refusal; there is no
`401`.

**Not behind `require_control_lock`, unlike every other guarded route.** The control lock is
write protection — one operator running a competition without others
interfering — and it is off by default, so requiring it would add nothing in
the state where the dump is exposed while blocking a fault report during the
event where a fault matters most. It locks writing; this is a read (D-39).

`Content-Disposition` names it `<hostname>-<version>-<resetReason>.zip`, with no
date: the device has no clock. Served chunked, so there is no `Content-Length`.

## Uploads

`POST /api/v2/programs` takes a JSON body. The id in the document is ignored:
the device assigns the next free id from 100 and rewrites the file from the
parsed program, so what is persisted is what will come back on the next boot.
Unknown fields are dropped in that rewrite, and each `duration` is clamped to
1…3600000 ms. Posting a document that carries an existing id creates a second
program rather than replacing the first — replacing is `PUT`.

`PUT /api/v2/programs/{id}` replaces one, parsed and rewritten by the same
rules. The path is the authority on the id, exactly as the filename is on
flash, so a body declaring a different `id` is a `400` rather than a rename; a
body with no `id` keeps the one in the path. Shipped programs answer `409` —
`readonly` follows from the directory they live in, and there is no writable
file behind them.

**A loaded program cannot be updated** (`409`; `POST /api/v2/programs/unload`,
or load another, first).
Run state holds a bare pointer into the stored program, so replacing one
mid-run would swap the series out from beneath the run loop and beneath the
series and event indices already published over SSE. Refusing keeps that case
out of existence rather than inventing a policy — reset to event 0? keep the
elapsed time? — for a situation nobody wants during a range session. The
replacement is staged through a temporary file and renamed into place, so a
write that fails leaves the previous document intact.

**A shipped program answers `409` to `DELETE` as well as to `PUT`** — `Program
is read-only and cannot be deleted`. Both write paths refuse the same program
for the same reason, so they say so the same way; `404` is reserved for a
program that is genuinely not there. There is nothing to hide behind the `404`:
`GET /api/v2/programs` lists every shipped program, ids included.

`POST /api/v2/audios` takes a multipart body with a file part and a `title`
field. The clip is streamed to a staging file, validated as PCM 16-bit
mono/stereo WAV, and only then renamed to `<id>.wav`. Two details fall out of
the vendored HTTP layer rather than being designed: the name of the file part
is not inspected, and `title` is looked up as a non-`POST` parameter, so a
`?title=` query parameter works just as well as the form field.

**The client's filename is never used on disk** — only its `.wav` extension is
checked, as an early reject. A client-chosen name could collide with the
repository's own `audios.json` index (destroying it) or with an existing clip
(leaving two ids sharing one file, so deleting either broke the other). Every
failure path removes the staging file, so a repeated failed upload cannot fill
the partition. There is one staging slot, and nothing is refused for it: the
HTTP server runs on a single task, so two uploads never overlap. An upload
whose connection dies mid-body never reaches `onRequest`, which is where that
cleanup lives, so the next upload — and every boot — starts by discarding
whatever is still staged.

Uploads and request bodies alike are bounded by `kMaxUploadBytes` (1 MB),
applied to the HTTP layer — not just when reading files back. That check lives
above every handler, in the vendored HTTP layer, and is the one failure that
is **not** a problem detail: it sends `400` with a `text/html` body.

`DELETE /api/v2/audios/{id}/delete` refuses to remove a clip that still matters
to a run — on a range, a spoken command that silently fails mid-exercise is a
safety problem, not an inconvenience. Existence is checked first, so a bogus id
is the only `404`; the four `409` reasons then apply in order, most specific
first:

1. **It is shipped with the firmware** — `/problems/audio_readonly`. First,
   because it is the one reason that never lifts.
2. **The loaded program plays it** — `/problems/audio_in_use`; the escape is
   `POST /api/v2/programs/unload`. Refused
   whether or not a run is in progress:
   `stop` is a pause, so a clip deleted between two runs would be missing when
   the program is resumed. The check is `rt::program_uses_audio`
   (`lib/rt_logic/program.h`, covered by `host_test/test_program_json`), read
   through the executor so the program pointer stays behind its lock.
3. **A run is in progress** — `/problems/program_running`, the same type
   `POST /api/v2/programs/unload` answers, because it is the same condition.
   Blunt on purpose: it holds for every clip, referenced or not.
4. **The clip is playing right now** — `/problems/audio_playing`. LittleFS
   has no unlink-while-open, so deleting it would corrupt the read.

## Static assets and the SPA fallback

Everything that is not `/api/v2` or `/sse/v2` is the bundled webapp, served
from `/embedded/webapp/` — inside the app image, pre-compressed at build time,
so the handler answers
with the `.gz` and `Content-Encoding: gzip`.

The webapp routes client-side, so `/run` and `/settings` are pages it owns and
files the image does not have. A `GET` that finds no file is answered with
`index.html` and `200` instead of a 404, which is what makes a reload or a
shared link land where it should. Three things are deliberately outside that:

- anything under `/api` or `/sse` — a miss there is a client error and keeps
  the `/problems/route_not_found` 404, or a browser gets HTML where it asked
  for JSON;
- a path whose last segment has a file extension — a missing bundle chunk must
  stay a 404, not become a script that will not parse;
- any method other than `GET`, and any build with no webapp in the image (an
  API-only build has no `index.html` to answer with).

The eligibility rule is `rt::spa_fallback_eligible` in `lib/rt_logic/uri_path.h`,
covered by `host_test/test_uri_path`.

## Endpoints kept beyond what the webapp calls

- **Program and audio CRUD.** `POST`/`PUT`/`DELETE` for programs and
  `POST`/`DELETE` for audios are more than the webapp needs, and are carried
  over so uploading programs and audio to the device keeps working. They are
  treated as protected mutations.
- **`GET /api/v2/version`** reports the three-part split of the firmware
  version, which is derived from `git describe` at build time rather than a
  hand-maintained constant; a tag that is not three-part semver degrades to
  zeroes rather than failing.
- **`POST /api/v2/audios/{id}/play` returns immediately** and plays on the
  audio task, rather than holding the response open for the length of the clip.
