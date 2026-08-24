# Contributing

Thanks for looking. This is a small club project — an ESP32-S3 that turns
shooting targets, and the web app that operates it — so the rules here are the
few that have actually cost us something when they were not followed.

Component-specific detail lives beside the code:
[`firmware/CONTRIBUTING.md`](firmware/CONTRIBUTING.md),
[`webapp/README.md`](webapp/README.md),
[`contracts/README.md`](contracts/README.md). This file is what applies
everywhere.

## Safety first

The device moves steel while people are on a firing line. Read the safety
warning in [`README.md`](README.md) before you touch a board, then two
consequences for the code:

- **The targets' resting state is shown, and that is not a preference** (D-31).
  Somebody may be downrange when a board is powered; a target that turns of its
  own accord can injure them. Anything that changes what the targets do at boot,
  between series, or during an update needs to be argued, not just tested. It is
  why that one setting is reachable only over a serial cable and never from the
  web app.
- **Refuse rather than guess.** Where the device cannot be sure a change is
  safe — a program running, an image it cannot identify, a pin that would take
  away the serial console — it refuses and says why. That is a deliberate
  pattern, not caution to be optimised away.

## Getting set up

### The web app alone

Node 22+. Nothing else, and no device:

```bash
cd webapp
npm ci
npm run dev            # http://localhost:5173, against the mock server
```

### The firmware

Install ESP-IDF **6.0.2** — the version this is built against — following
[Espressif's setup guide](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32s3/get-started/).
The short form on Linux/macOS:

```bash
git clone -b v6.0.2 --recursive https://github.com/espressif/esp-idf.git ~/esp/esp-idf-6.0.2
~/esp/esp-idf-6.0.2/install.sh esp32s3
. ~/esp/esp-idf-6.0.2/export.sh          # every new shell
```

Then build. **The web app first** — the firmware bakes whatever `webapp/dist`
currently holds and does not rebuild it, so a firmware build after a web app
change but without `npm run build` silently ships the old bundle:

```bash
cd webapp && npm run build     # produces webapp/dist
cd ../firmware && idf.py build
```

### Flashing a board

`idf.py flash` works. If you would rather flash explicitly, the arguments are
printed at the end of `idf.py build`:

```bash
python -m esptool --chip esp32s3 --port /dev/ttyACM0 \
  --before default-reset --after hard-reset \
  write-flash --flash-mode dio --flash-freq 80m --flash-size 16MB \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0xf000 build/ota_data_initial.bin \
  0x20000 build/rotation_target_backend.bin \
  0x620000 build/storage.bin
```

**Reading the whole chip is the one operation that needs `--no-stub`** — the
stub fails on reads above roughly 3 MB. The measurements behind that, the
wiring and the partition layout are in
[`firmware/docs/HARDWARE.md`](firmware/docs/HARDWARE.md).

### Running it without a board

Two ways, and they answer different questions.

**QEMU** runs the real firmware — the real REST API, the real SSE stream, the
real web app out of the same LittleFS image a board is flashed with:

```bash
. ~/esp/esp-idf-6.0.2/export.sh
firmware/scripts/run-qemu.sh          # then http://localhost:8080
```

Ctrl-A X quits QEMU; Ctrl-C reaches the guest rather than the emulator. **QEMU
cannot verify anything that persists**: the flash image is rebuilt on every
launch and carries no NVS, so WiFi credentials, the hardware configuration and
the boot target state are blank at every boot. A save appears to work and is
gone after the "restart". Test persistence on real hardware.

**The mock server** reimplements the executor in TypeScript, and is what the
web app's tests run against:

```bash
cd webapp
npm run dev            # dev server, mock server started for you
npm run test           # vitest, against the mock
npm run e2e:local      # Playwright, against the mock
```

If you change run behaviour in `firmware/lib/rt_logic/executor.cpp`, change
`webapp/test/mock-server/server.ts` with it — see
[the seams](#the-seams-between-components).

## Before you push

```bash
pre-commit run --all-files          # CI runs exactly this
```

Then whatever your change touched:

```bash
cd webapp && npm run typecheck && npm run lint && npm run test && npm run build

cd firmware/host_test && cmake -S . -B build && cmake --build build && \
  (cd build && ctest --output-on-failure)

contracts/validate.sh               # if you touched the API
```

Every check runs on every pull request, deliberately — a required check that
does not run cannot gate anything.

### Style and linting

Formatting is not a matter of taste here; it is enforced, and the hooks will
rewrite your files:

- **C++** — clang-format, via pre-commit. Vendored code
  (`firmware/lib/psychic_http/`, `arduinojson/`, `dns_server/`) and
  `resources/` are never reformatted; fixes go on our side of the boundary.
- **TypeScript / React** — ESLint and Prettier (`npm run lint`,
  `npm run format`).
- **YAML** — yamllint.

If `pre-commit` reformats files, stage them again and re-run it before
committing — a hook that modified a file has not passed yet.

## Commits and pull requests

- **Work on a branch and open a pull request.** Never push to `main`.
- **[Conventional Commits](https://www.conventionalcommits.org/)** for the
  commit subject and the PR title. CI checks the title.
- **Sign off every commit**: `git commit -s`. See
  [Developer Certificate of Origin](#developer-certificate-of-origin) below.
- **A breaking API change must be marked** `!` or `BREAKING CHANGE:`. The
  release version is computed from the commits and nothing reads the specs, so
  an unmarked breaking change ships under a minor bump.
- **Stage explicit paths.** Never `git add -A`, `git add .` or `commit -a`.
  This is not style: a generated file carrying WiFi credentials reached this
  public repository that way.

## Developer Certificate of Origin

Every commit must carry a `Signed-off-by` line certifying that you wrote the
change, or otherwise have the right to submit it under the project's licence.
The full text is in [`DCO`](DCO), and it is the standard
[developercertificate.org](https://developercertificate.org/) 1.1.

`git commit -s` adds the line for you:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and an address you can be reached at. A pull request whose
commits are not signed off cannot be merged; `git rebase --signoff main` fixes
a branch that is missing them.

## Never commit

- **Secrets, of any kind.** The WiFi credentials live outside the working tree
  and the build is pointed at them:
  `idf.py -D SDKCONFIG=$HOME/agents/rotation_target/sdkconfig build`. A file
  that is not in the tree cannot be committed by accident; a `.gitignore` rule
  cannot say the same, because it does not apply to a file already tracked and
  does not know about the siblings a tool generates beside the one you ignored.
- **Generated build configuration** — `sdkconfig`, `sdkconfig.bak-*`, build
  directories.

A pre-commit hook refuses a file carrying a real SSID or password, but it is the
last line, not the first.

## Keep the repository root clean

New configuration belongs in `.github/` or beside the component it configures,
not at the top level. The root is the first thing anyone sees, and a tool's
config file is rarely what they came for. Add to the root only when the tool
genuinely cannot look anywhere else — `pre-commit` is the example that can't.

## The seams between components

The expensive bugs here have all lived between the parts rather than inside
them — the mock server drifting from the firmware, a stale `webapp/dist` baked
into an image, a contract changed on one side only. Those are written down in
[`AGENTS.md`](AGENTS.md), which is worth reading whether or not you use a coding
assistant.

## Decisions

Decisions of record are in [`docs/DECISIONS.md`](docs/DECISIONS.md), numbered
D-01 upwards. If a change touches one, cite it; if it overturns one, add a new
entry rather than editing the old.
