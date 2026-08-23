# Contributing

Thanks for looking. This is a small club project — an ESP32-S3 that turns
shooting targets, and the web app that operates it — so the rules here are the
few that have actually cost us something when they were not followed.

Deep, component-specific detail lives beside the code:
[`firmware/CONTRIBUTING.md`](firmware/CONTRIBUTING.md). This file is what
applies everywhere.

## Safety first

The device moves steel while people are on a firing line. Two consequences:

- **The targets' resting state is shown, and that is not a preference** (D-31).
  Somebody may be downrange when a board is powered; a target that turns of its
  own accord can injure them. Anything that changes what the targets do at boot,
  between series, or during an update needs to be argued, not just tested.
- **Refuse rather than guess.** Where the device cannot be sure a change is
  safe — a program running, an image it cannot identify — it refuses and says
  why. That is a deliberate pattern, not caution to be optimised away.

## Getting set up

Each component builds on its own; see the per-directory READMEs
([`firmware/`](firmware/README.md), [`webapp/`](webapp/README.md),
[`contracts/`](contracts/README.md), [`resources/`](resources/README.md)).

A full device image is the web app first, then the firmware — the firmware
bakes whatever `webapp/dist` currently holds and does not rebuild it:

```bash
cd webapp && npm run build     # produces webapp/dist
cd ../firmware && idf.py build
```

## Before you push

```bash
pre-commit run --all-files          # CI runs exactly this
```

Then whatever your change touched: `npm run typecheck && npm run lint && npm
run test && npm run build` in `webapp/`, the host tests in
`firmware/host_test/`, and `contracts/validate.sh` if you touched the API.
`firmware/CONTRIBUTING.md` has the firmware commands in full.

Every check runs on every pull request, deliberately — a required check that
does not run cannot gate anything.

## Commits and pull requests

- **Work on a branch and open a pull request.** Never push to `main`.
- **[Conventional Commits](https://www.conventionalcommits.org/)** for the
  commit subject and the PR title. CI checks the title.
- **Sign off every commit**: `git commit -s`.
- **A breaking API change must be marked** `!` or `BREAKING CHANGE:`. The
  release version is computed from the commits and nothing reads the specs, so
  an unmarked breaking change ships under a minor bump.
- **Stage explicit paths.** Never `git add -A`, `git add .` or `commit -a`.
  This is not style: a generated file carrying WiFi credentials reached this
  public repository that way.

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
