# API v2

The device serves the SSE-first contract the React webapp
(`rotation_target_frontend_webapp`) speaks:

- REST base: `/api/v2`
- SSE endpoint: `/sse/v2`

There is no v1 on this firmware. The canonical machine-readable contract is
`docs/mock-api-v2.openapi.json` in the frontend repository; this document
records the device's implementation of it and where it deliberately goes
further. It is the ESP-IDF port of the same contract the MicroPython backend
serves, and the two are intended to stay interchangeable from a client's point
of view.

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
reboot returns the device to the unprotected state. `GET` endpoints stay public
either way; the mutating endpoints below require credentials only while admin
mode is on.

- `Authorization: Bearer <token>`, or `Cookie: admin=<token>`
- `POST /api/v2/admin-mode/enable` sets the password (any non-empty string) and
  returns a token; `409` if admin mode is already on
- `POST /api/v2/admin-mode/login` exchanges the active password for another
  token; `409` if admin mode is off
- Both send `Set-Cookie: admin=<token>; Path=/; SameSite=Lax`
- `POST /api/v2/admin-mode/disable` clears the password and invalidates every
  issued token — note this turns protection *off*, it is not "log out"
- `POST /api/v2/admin-mode/logout` invalidates only the presenting token and
  clears the cookie, leaving admin mode on. This is what a client leaving a
  shared range laptop wants
- Tokens expire 12 hours after they are issued, and at most 8 sessions are
  held at once (oldest evicted first)

Tokens are 16 bytes from `esp_fill_random()`, hex-encoded.

## Endpoints

### Public

| Method | Path |
|--------|------|
| `GET` | `/sse/v2` |
| `GET` | `/api/v2/version` |
| `GET` | `/api/v2/diagnostics/info` |
| `GET` | `/api/v2/admin-mode/status` |
| `POST` | `/api/v2/admin-mode/enable` |
| `POST` | `/api/v2/admin-mode/login` |
| `GET` | `/api/v2/programs` |
| `GET` | `/api/v2/programs/{id}` |
| `GET` | `/api/v2/audios` |

### Protected while admin mode is enabled

| Method | Path |
|--------|------|
| `POST` | `/api/v2/admin-mode/disable` |
| `POST` | `/api/v2/admin-mode/logout` |
| `POST` | `/api/v2/programs/{id}/load` |
| `POST` | `/api/v2/programs/start` |
| `POST` | `/api/v2/programs/stop` |
| `POST` | `/api/v2/programs/reset` |
| `POST` | `/api/v2/programs/series/{index}/skip_to` |
| `POST` | `/api/v2/targets/show` |
| `POST` | `/api/v2/targets/hide` |
| `POST` | `/api/v2/targets/toggle` |
| `POST` | `/api/v2/audios/{id}/play` |
| `POST` | `/api/v2/programs` |
| `DELETE` | `/api/v2/programs/{id}/delete` |
| `POST` | `/api/v2/audios` |
| `DELETE` | `/api/v2/audios/{id}/delete` |

## Deviations from the mock contract

- **Program and audio CRUD is kept.** `POST`/`DELETE` for programs and audios
  are not in the mock spec, which describes only what the webapp calls. They are
  carried over so uploading programs and audio to the device keeps working, and
  they are treated as protected mutations.
- **`GET /api/v2/version` is kept** for the same reason. It reports the
  three-part split of the firmware version, which is derived from
  `git describe` at build time rather than a hand-maintained constant; a tag
  that is not three-part semver degrades to zeroes rather than failing.
- **`POST /api/v2/audios/{id}/play` returns immediately** and plays on the
  audio task, rather than holding the response open for the length of the clip.
- **CORS allows credentials, against an allowlist.** The webapp sends the admin
  cookie and bearer token with every call, and a browser refuses
  `Access-Control-Allow-Origin: *` on a credentialed request — so the origin is
  echoed rather than wildcarded. It is echoed only if it matches the device's
  own mDNS name or current IP, or `CONFIG_RT_DEV_ORIGIN`. Any other origin gets
  no CORS headers, so a page the operator happens to be visiting cannot script
  the device or read its responses.

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
  "adminModeEnabled": false
}
```

It is public, like every other `GET`: it carries no credential and no program
data. `minFreeHeapBytes` is the low-water mark since boot — a leak that has
already been reclaimed is invisible in the current figure.

**The coredump itself is deliberately not exposed.** It is a raw RAM snapshot
and can contain the WiFi password in plaintext, so retrieving one stays an
out-of-band job needing physical access. `coredumpPresent` only tells you there
is something to go and fetch.

## Uploads

`POST /api/v2/programs` takes a JSON body. The id in the document is ignored:
the device assigns the next free id from 100 and rewrites the file from the
parsed program, so what is persisted is what will come back on the next boot.

`POST /api/v2/audios` takes a multipart body with a `file` part and a `title`
field. The clip is streamed to a staging file, validated as PCM 16-bit
mono/stereo WAV, and only then renamed to `<id>.wav`.

**The client's filename is never used on disk** — only its `.wav` extension is
checked, as an early reject. A client-chosen name could collide with the
repository's own `audios.json` index (destroying it) or with an existing clip
(leaving two ids sharing one file, so deleting either broke the other). Every
failure path removes the staging file, so a repeated failed upload cannot fill
the partition.

Uploads are bounded by `kMaxUploadBytes` (1 MB), applied to the HTTP layer —
not just when reading files back.

`DELETE /api/v2/audios/{id}/delete` answers `409` if the clip is playing:
LittleFS has no unlink-while-open, so deleting it would corrupt the read.
