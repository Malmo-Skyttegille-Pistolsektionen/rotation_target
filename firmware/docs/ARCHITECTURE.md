# Architecture

## The split: `lib/rt_logic` is the tested core, `main/` is the firmware

Everything that decides *what should happen* lives in `lib/rt_logic/`, is free
of ESP-IDF and hardware, and is covered by the Unity suites in `host_test/`.
`main/` is the part that talks to the chip and the network.

| Layer | Holds |
|---|---|
| `lib/rt_logic/` | Program model + JSON (`program.*`), run state + `stateUpdate` serializer (`program_state.h`), run-position maths (`run_position.h`), the run state machine (`executor.*`), admin mode (`admin_mode.h`) |
| `main/io/` | `targets` (GPIO), `audio` (I2S WAV playback), `rgb_led` |
| `main/storage/` | LittleFS mount and directory helpers |
| `main/repositories/` | `programs`, `audios` — what is on the filesystem |
| `main/executor/` | The run-loop task and the real clock/effects behind `rt::Executor` |
| `main/net/` | `wifi_mgr`, `web_server` (REST), `sse_hub` (SSE + heartbeat) |
| `lib/psychic_http/`, `lib/arduinojson/` | Vendored third-party, never reformatted |

`rt::Executor` takes a `rt::Clock` and a `rt::Effects` by reference. The
firmware supplies `esp_timer_get_time()` and the real target/audio/SSE
side effects; the host tests supply a clock they advance by hand and an
effects recorder. That is what lets the whole run state machine — including
the exact `stateUpdate` sequence a client sees for a full series — be asserted
on the build machine with no sleeps and no hardware.

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

The filename is the authority on a program's id, not the `id` field inside it;
that is what keeps delete (which removes `<id>.json`) consistent with the
in-memory store.

Programs are held in a `std::map`, not an `unordered_map`: `ProgramState` holds
a bare `const rt::Program *` at whatever is loaded, and reference stability
across inserts is what keeps it from dangling.

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
