# Architecture

## The split: `lib/rt_logic` is the tested core, `main/` is the firmware

Everything that decides *what should happen* lives in `lib/rt_logic/`, is free
of ESP-IDF and hardware, and is covered by the Unity suites in `host_test/`.
`main/` is the part that talks to the chip and the network.

| Layer | Holds |
|---|---|
| `lib/rt_logic/` | Program model + JSON (`program.*`), run state + `stateUpdate` serializer (`program_state.h`), run-position maths (`run_position.h`), the run state machine (`executor.*`), admin mode (`admin_mode.h`), WAV header parsing (`wav_header.*`), URI path ids (`uri_path.h`) |
| `main/io/` | `targets` (GPIO), `audio` (I2S WAV playback), `rgb_led` |
| `main/storage/` | LittleFS mount and directory helpers |
| `main/repositories/` | `programs`, `audios` — what is on the filesystem |
| `main/executor/` | The run-loop task and the real clock/effects behind `rt::Executor` |
| `main/net/` | `wifi_mgr`, `wifi_store` (NVS credentials), `setup_portal` (SoftAP fallback), `web_server` (REST), `sse_hub` (SSE: state, heartbeat, issues) |
| `lib/psychic_http/`, `lib/arduinojson/`, `lib/dns_server/` | Vendored third-party, never reformatted |

`rt::Executor` takes a `rt::Clock` and a `rt::Effects` by reference. The
firmware supplies `esp_timer_get_time()` and the real target/audio/SSE
side effects; the host tests supply a clock they advance by hand and an
effects recorder. That is what lets the whole run state machine — including
the exact `stateUpdate` sequence a client sees for a full series — be asserted
on the build machine with no sleeps and no hardware.

### Every parser belongs in `rt_logic`

**If it takes bytes from outside the device and turns them into meaning, it goes
in `rt_logic`, not `main/`.** That covers the WAV header (`wav_header.*`), URI
path ids (`uri_path.h`), program documents and program filenames (`program.*`).

This is not tidiness. Those parsers are the attacker-reachable surface — an
uploaded WAV, a URI, an uploaded program — and in `main/` they sit behind a
`FILE*` or an HTTP request in an anonymous namespace, where no host test can
reach them and neither ASan nor UBSan ever sees them. In `rt_logic` they are
covered by `host_test/` and run under both sanitizers in CI on every push.

`wav_header.h` shows the shape: it takes a `ByteSource` (absolute `uint64_t`
offsets) rather than a `FILE*`. The firmware adapts stdio to it in
`main/io/audio.cpp`; the tests adapt a `std::vector`. The abstraction also
makes a whole bug class unrepresentable — the relative-seek form it replaced
could seek *backwards* on a crafted chunk size and loop forever.

## Concurrency

Three tasks touch run state:

- **`run_loop`** (priority 4, `main/executor/program_executor.cpp`) — calls
  `rt::Executor::tick()`, then waits for however long `tick()` asked, or until
  a control call notifies it. `tick()` returns at most 200 ms
  (`rt::kMaxSleepMs`), so `stop` takes effect promptly even mid-event.
- **`httpd`** — REST handlers, calling the same `executor::` functions.
- **`audio`** (priority 5) — plays queued clips. Above the run loop
  deliberately: an underrun is audible on the range, a few ms of added REST
  latency is not.

A single recursive mutex guards `rt::ProgramState` and the executor. It is
recursive because `set_targets()` is reached both directly (the `/targets/*`
endpoints) and from inside the executor's own locked section.

**SSE broadcasts happen outside that lock.** `rt::Effects::state_changed()`
only sets a flag; the payload is serialized under the lock and sent after
releasing it. Fanning out to every connected client while holding the run-state
lock would let one slow socket stall the run loop.

## Storage

One LittleFS partition (`storage`, 9.75 MB — see `partitions.csv`), built from
`resources/` at compile time and flashed with the firmware:

```
/storage/shipped/audio/     audios.json + 77 WAVs   read-only
/storage/shipped/programs/  <id>.json               read-only
/storage/uploads/audio/     audios.json + WAVs      writable
/storage/uploads/programs/  <id>.json               writable
/storage/webapp/            the built frontend, if uploaded
```

**Read-only is a property of the directory, not the document.** A program's
`readonly` flag is imposed by the loader from where the file came from, never
read from the file — an uploader must not be able to claim its program is
shipped and thereby undeletable. `host_test/test_program_json` asserts this.

**Shipped and uploaded ids are two disjoint ranges, not one shared space
(#129).** `kFirstUploadId` (`main/config.h`) is where `add_uploaded()` starts
assigning; every shipped id must sit below it —
`resources/programs/validate_programs.sh` enforces that on the program side.
Both `programs::load_all()` and `audios::load_all()` load the shipped
directory first, so if the ranges were ever violated an uploaded id landing on
a shipped one would silently win the collision — the shipped copy is what the
loader keeps instead, logging the collision and raising a
`program_id_collision`/`audio_id_collision` `backend_issue` (into
`startupIssues`, since this can only be discovered before the server exists).
`lib/rt_logic/id_range.h` is the host-tested logic behind both the id
assignment and the collision check.

The filename is the authority on a program's id, not the `id` field inside it;
that is what keeps delete (which removes `<id>.json`) consistent with the
in-memory store.

Programs are held in a `std::map`, not an `unordered_map`: `ProgramState` holds
a bare `const rt::Program *` at whatever is loaded, and reference stability
across inserts is what keeps it from dangling.

## Getting on the network

Credentials come from NVS, falling back to the Kconfig seed values. The retry
budget (`CONFIG_RT_WIFI_MAX_RETRIES`) bounds the **initial** association only —
once joined, reconnection is unbounded, because a device that gave up mid-session
would sit powered on and unreachable until someone walked to it.

If the initial join fails, `setup_portal::run()` takes over: a SoftAP, a
wildcard DNS responder (`lib/dns_server/`) so captive-portal probes land on the
setup page, and a form that writes credentials to NVS and reboots. It runs its
own minimal `esp_http_server` rather than the API server — nothing else on the
device is meaningful in that state, and keeping them apart means no API route
can ever be exposed on an open setup AP.

## Boot order

`app_main()` brings things up in dependency order — NVS, LED, target GPIO,
storage, repositories, audio, executor, WiFi, HTTP server — and reboots rather
than coming up degraded if storage or the network is unavailable. A device on a
range that looks healthy but serves nothing is worse than one that restarts.

The target pin powers up **low**, which is the *shown* position. `executor::init()`
drives it to hidden before the server starts, so the hardware matches the first
`stateUpdate` a client receives. This was a real bug in the MicroPython backend
before its v2 rework.

## Relationship to the MicroPython backend

This is a port of `rotation_target_backend_esp32_micropython` at its
"SSE-first API v2" revision, route for route and semantic for semantic. Where
behaviour is subtle, the host tests name the MicroPython test they came from.
Both backends are meant to be interchangeable from the webapp's point of view;
`docs/api-v2.md` is the contract that has to stay true of both.
