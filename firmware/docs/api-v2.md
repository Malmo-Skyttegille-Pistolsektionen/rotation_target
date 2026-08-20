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
    "tickerSeconds": 7         // whole seconds elapsed in the current series
  },
  "targetStatus": "shown"      // "shown" | "hidden"
}
```

`currentEventIndex` is derived from elapsed series time rather than tracked per
event, so a paused run resumes at whatever event `tickerSeconds` lands in.

`heartbeat` (`{"id": n}`) is emitted every 10 seconds.

`backend_issue` (`{"code", "message", "context"?}`) is the third event, and the
only one that is not about run state: it reports a failure the device noticed
on its own, where no request exists to answer with an error. Today that is a
clip that would not play (`audio_playback_failed`, raised from the playback
task) and a stored program file that would not parse (`program_invalid`, raised
by the boot scan).

It is fire-and-forget by design. Nothing is buffered for a client that connects
later and nothing is replayed on reconnect, so the event is a notification and
the device log remains the record. That also means the boot-scan emissions
reach nobody: `load_all()` runs before the HTTP server exists, and `sse_hub`
drops frames raised before it has a server to send them through. The code is
specified anyway, so that a rescan added later reports a bad file rather than
silently listing one program fewer.

## Execution semantics

| Call | Effect |
|------|--------|
| `load` | Selects the program, series 0, event 0, `tickerSeconds` `null` |
| `start` | Resumes from `tickerSeconds`, or runs the series from 0 |
| `stop` | Pauses and keeps the position |
| `reset` | Rewinds to the start of the current series |
| `skip_to` | Selects a series, paused at its first event |

When a series finishes and another follows, execution pauses at the start of the
next series and the targets are hidden. When the last series finishes, execution
stops with the series still selected.

Audio attached to an event plays when the run loop enters that event. Resuming
into the middle of an event does not replay its audio.

Because `tickerSeconds` is whole seconds, a pause less than a second into a
series resumes from 0. Real programs have multi-second events, so this is not
observable in practice — but it is why `host_test/test_executor` asserts a
resume 250 ms in returns to event 0.

## Auth

Admin mode is off until a client enables it, and it lives in RAM only — a
reboot returns the device to the unprotected state. The rule is simple enough
to state once: **every `GET` is public; every mutating endpoint is protected
while admin mode is on, except the three that have to work without a session —
`admin-mode/enable`, `admin-mode/login` and `admin-mode/logout`.**

- `Authorization: Bearer <token>`, or `Cookie: admin=<token>`. The header is
  checked first; the cookie is the fallback
- `POST /api/v2/admin-mode/enable` sets the password (any non-empty string) and
  returns a token; `409` if admin mode is already on
- `POST /api/v2/admin-mode/login` exchanges the active password for another
  token; `409` if admin mode is off
- Both send `Set-Cookie: admin=<token>; Path=/; SameSite=Lax`
- `POST /api/v2/admin-mode/disable` clears the password and invalidates every
  issued token — note this turns protection *off*, it is not "log out"
- `POST /api/v2/admin-mode/logout` invalidates only the presenting token and
  clears the cookie, leaving admin mode on. This is what a client leaving a
  shared range laptop wants. It is itself unprotected, and answers `200`
  whether or not the token it was given was live: there is nothing to protect,
  since all it can do is invalidate a credential the caller already holds
- Tokens expire 12 hours after they are issued, and at most 8 sessions are
  held at once (oldest evicted first)

Tokens are 16 bytes from `esp_fill_random()`, hex-encoded.

**CORS allows credentials, against an allowlist.** The webapp sends the admin
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
  "adminModeEnabled": false
}
```

It is public, like every other `GET`: it carries no credential and no program
data. `minFreeHeapBytes` is the low-water mark since boot — a leak that has
already been reclaimed is invisible in the current figure. `targetGpioLevel` is
read back off the pad rather than remembered, so the pair with `targetGpio`
distinguishes "the firmware never drove it" from "something else is holding it".

**The coredump itself is deliberately not exposed.** It is a raw RAM snapshot
and can contain the WiFi password in plaintext, so retrieving one stays an
out-of-band job needing physical access. `coredumpPresent` only tells you there
is something to go and fetch.

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

**A loaded program cannot be updated** (`409`; unload or load another first).
Run state holds a bare pointer into the stored program, so replacing one
mid-run would swap the series out from beneath the run loop and beneath the
series and event indices already published over SSE. Refusing keeps that case
out of existence rather than inventing a policy — reset to event 0? keep the
elapsed time? — for a situation nobody wants during a range session. The
replacement is staged through a temporary file and renamed into place, so a
write that fails leaves the previous document intact.

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
the partition. There is one staging slot, so a second concurrent upload is
refused.

Uploads and request bodies alike are bounded by `kMaxUploadBytes` (1 MB),
applied to the HTTP layer — not just when reading files back. That check lives
above every handler, in the vendored HTTP layer, and is the one failure that
does **not** answer in the `{"error": ...}` shape: it sends `400` with a
`text/html` body.

`DELETE /api/v2/audios/{id}/delete` answers `409` if the clip is playing:
LittleFS has no unlink-while-open, so deleting it would corrupt the read.

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
