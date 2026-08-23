# Contributing

> The rules that apply everywhere — branching, commits, sign-off, what never
> gets committed, and the seams between components — are in the root
> [`CONTRIBUTING.md`](../CONTRIBUTING.md). This file is the firmware-specific
> half: the safety rules, the hardware, and where firmware code goes.

Thanks for helping out. This firmware runs on a live shooting range, so a few
of the rules below are stricter than they would be for an ordinary hobby
project — please read the safety note before changing run or target behaviour.

## Safety first

> ⚠️ The target position and the audio commands are what tell shooters when to
> fire and when to stop. A bug here is not a cosmetic bug.

- Do not weaken the run loop's timing guarantees (`rt::kMaxSleepMs`, the
  wake-on-boundary logic in `rt::next_sleep_ms`).
- Do not change what `start` / `stop` / `reset` / `skip_to` do to the target
  position without updating [`docs/api-v2.md`](docs/api-v2.md) and the host
  tests that pin the behaviour down.
- `CONFIG_RT_TARGET_ACTIVE_LOW` must match the board. If it is wrong, the
  boot-time "hide" presents the targets instead of hiding them.
- Anything you cannot verify on hardware, say so in the PR. "Compile-verified
  only" is a perfectly acceptable statement; silence is not.

## Getting set up

```bash
git clone https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target.git
cd rotation_target/firmware
idf.py set-target esp32s3          # FIRST clone only - see the warning below
idf.py build
```

> ⚠️ **Never run `idf.py set-target` on a clone you have already built.** It
> regenerates `sdkconfig` from scratch, and `sdkconfig` is where the WiFi
> credentials live — it is gitignored, so there is no other copy and nothing
> will tell you they are gone until the device cannot join a network. Use
> **`idf.py reconfigure`** on an existing clone.
>
> Better still, keep the credentials outside the tree entirely and point the
> build at them, so regenerating `sdkconfig` costs nothing:
>
> ```bash
> idf.py -D SDKCONFIG=$HOME/agents/rotation_target/sdkconfig build
> ```

You need **ESP-IDF >= 6.0** (CI pins v6.0.2). The shipped audio and programs
live in the monorepo's sibling `resources/` directory; CMake fails at configure
time if `RT_RESOURCES_DIR` does not point at one.

See [`README.md`](README.md) for flashing and
[`docs/HARDWARE.md`](docs/HARDWARE.md) for board configuration and the esptool
quirk you will hit on this hardware.

## Before you push

```bash
# 1. Host tests - fast, no hardware
cd host_test && cmake -B build && cmake --build build -j && (cd build && ctest --output-on-failure)

# 2. Same suites under ASan + UBSan
cmake -B build-san -DRT_SANITIZE=ON && cmake --build build-san -j && (cd build-san && ctest --output-on-failure)

# 3. Formatting and hygiene
pre-commit run --all-files

# 4. Firmware still builds
idf.py build
```

CI runs all four. The clang-format hook rewrites files in place, so a first run
failing and a second passing is normal — re-stage what it changed.

## Where code goes

**`lib/rt_logic/` is the tested core; `main/` is the firmware.** If it decides
*what should happen*, it belongs in `rt_logic`, has no ESP-IDF dependency, and
gets a host test. If it talks to a peripheral, a socket or the filesystem, it
belongs in `main/`.

**Parsers always go in `rt_logic`.** Anything turning outside bytes into
meaning — WAV headers, URI path ids, uploaded program documents — is
attacker-reachable, and in `main/` it sits behind a `FILE*` or an HTTP request
where no test and no sanitizer can reach it. Take an abstraction
(`rt::ByteSource`) rather than a `FILE*`.

If a change cannot be tested in `host_test/`, that is usually a sign the logic
ended up on the wrong side of the line.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) has the task model, the locking
rules and the storage layout. Read it before touching the executor or anything
concurrent.

## Tests

Unity suites under `host_test/`, one directory per subject, picked up
automatically by the CMake glob — adding `host_test/test_foo/test_foo.cpp` is
all it takes.

Write tests that state a behaviour, not a line of code. The suite names come
from the MicroPython backend's pytest suite where they were ported, so the two
can be compared. Prefer a fake clock over a sleep: the executor takes its
`Clock` by reference precisely so the whole run state machine can be driven
deterministically.

## Commits and pull requests

Branching, Conventional Commits, sign-off and the breaking-change marker are in
the root [`CONTRIBUTING.md`](../CONTRIBUTING.md) and apply here unchanged. Two
things are firmware-specific:

- Explain *why* in the commit body, not just what. If a change is subtle, the
  reason it is that way is the part a future reader needs.
- **Say what you verified and what you did not.** "Compile-verified only, not
  run on hardware" is a perfectly acceptable statement; silence is not. Much of
  this cannot be proved without a board, and a reviewer needs to know which
  half they are reading.

## Comments

Comments explaining *why* non-obvious code is the way it is are welcome and
should not be trimmed. What to avoid is volume out of proportion to the code:

- Don't paste the commit message into the file. The argument belongs in the
  commit; the file keeps the one-line residue a reader needs.
- Don't restate the code.
- Prefer a pointer to a copy — "kept in step with `docs/api-v2.md`" beats
  reproducing that document.

## Vendored code

`lib/psychic_http/`, `lib/arduinojson/`, `lib/dns_server/` and the repository's
`resources/` tree are third-party and **must stay byte-identical to upstream**. They are
excluded from pre-commit; never reformat them. Where they need a fix — an
include order, a warning pragma — it goes on our side of the boundary, with a
comment saying why.

## The API contract

[`docs/api-v2.md`](docs/api-v2.md) is shared with the MicroPython backend and
the webapp. Changing a payload shape means changing it there too, and recording
any divergence in its "Deviations" section. The two backends are meant to stay
interchangeable from a client's point of view.

## Releases

Version is derived from git — ESP-IDF fills `esp_app_desc_t.version` from
`git describe --always --tags --dirty`, and `GET /api/v2/version` reports it.
There is no version constant in the source and there must not be one.

Releasing is **not** `git tag && git push --tags`: the `release` workflow is
dispatched manually, runs every check at the commit it is about to tag, waits
on an approval, and then tags, builds and publishes. Tagging by hand skips all
of that. Tags are **bare three-part semver** (`2.0.0`, never `v2.0.0`), and
cover firmware, web app and resources together (D-29). See
[`docs/RELEASING.md`](../docs/RELEASING.md).

## Reporting a problem

Open an issue with what you expected, what happened, and — if it came off a
device — the output of `GET /api/v2/diagnostics/info`, which carries the
firmware version, reset reason and heap state.

**Never paste WiFi credentials into an issue, a commit, or any file except the
gitignored `sdkconfig`.**
