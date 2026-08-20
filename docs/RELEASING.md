# Releasing

Three components share one history, so they share one tag namespace and are
released independently:

| Component | Tag | Release workflow |
|---|---|---|
| `firmware/` | `firmware-vX.Y.Z` | `.github/workflows/firmware-release.yml` |
| `webapp/` | `webapp-vX.Y.Z` | lands with the webapp CI |
| `resources/` | `resources-vX.Y.Z` | lands with the webapp CI |

**The tag is the version.** Nothing in the tree holds a version string: there
are no version files, no version-bump commits, and no manifest of shipped asset
versions. A release is a tag and the artifacts built from it — so reverting one
means deleting a tag, and asking "what version is this?" always means asking
git.

## Where the firmware version comes from

`firmware/CMakeLists.txt` sets `PROJECT_VER` before `project()` from:

```
git describe --tags --match 'firmware-v*' --always --dirty
```

with the `firmware-v` prefix stripped. The `--match` is the load-bearing part:
ESP-IDF's own default is a bare `git describe`, which in this repository would
name the firmware after whichever `webapp-v*` or `resources-v*` tag happened to
be nearest.

From there the value flows into `esp_app_desc_t.version` (visible in
`esptool image-info`, in the boot log, and to OTA), and
`GET /api/v2/version` splits it into `{major, minor, patch}`.

| Build | `esp_app_desc_t.version` | `GET /api/v2/version` |
|---|---|---|
| At tag `firmware-v2.0.0` | `2.0.0` | `2.0.0` |
| Same, dirty tree | `2.0.0-dirty` | `2.0.0` |
| Three commits past it | `2.0.0-3-g09a3691` | `2.0.0` |
| No `firmware-v*` tag reachable | `09a3691` | `0.0.0` |

The API parser deliberately accepts only a full three-part number followed by
end-of-string, `-` or `+`, so the `-N-ghash` and `-dirty` suffixes report the
tag they descend from, while an untagged build reports `0.0.0` rather than
inventing a version out of a commit hash. That last row is announced at
configure time as a `-- Firmware version: no firmware-v* tag reachable ...`
status line — a CI checkout without `fetch-tags: true` is the usual cause.

`PROJECT_VER` is resolved at CMake **configure** time, so a tag created after
the last configure is not picked up by an incremental `idf.py build`. Run
`idf.py reconfigure` first.

## Cutting a firmware release

Run the **firmware-release** workflow from `main` (or a `hotfix/*` /
`release/*` branch — anything else is rejected before a tag exists).

1. **Preview it.** `dry-run` is on by default. The job resolves the version and
   generates the release notes into the job summary without tagging anything.
   Check the notes against the commit list: anything missing was dropped as
   unconventional or as a skipped `ci:` commit, which is how a mistyped commit
   type gets caught before it becomes a wrong version bump.

2. **Run it again with `dry-run` off.**
   - `version` — leave empty to auto-detect. git-cliff computes the next
     version from the Conventional Commits touching `firmware/` or
     `resources/` since the last `firmware-v*` tag: `feat:` bumps the minor,
     `fix:` the patch, `!`/`BREAKING CHANGE:` the major (below 1.0, the minor).
   - `force` — only needed when the `version` you pass disagrees with the
     auto-detected one. Without it the mismatch is a hard error naming both,
     which is the guard against "meant 2.1.0, typed 2.0.1". The **first**
     release needs it: with no `firmware-v*` tag to count from, auto-detect
     proposes `0.1.0`.

The run then tags `firmware-vX.Y.Z`, creates the GitHub release as a
**prerelease**, builds the firmware **from the tag** — which is what gives the
image its version — asserts that the built image reports exactly `X.Y.Z`,
attaches the images, and finally clears the prerelease flag.

Nothing before that last step is irreversible: a tag can be deleted and a
prerelease is excluded from `/releases/latest`. So a failed build leaves a tag
and an empty prerelease behind — delete both, or fix forward with a patch
release.

Releases are **not** marked "latest". In a repository with three tag lines that
flag names one release for all of them, so a webapp release would answer a
consumer asking `/releases/latest` for firmware. Resolve `firmware-v*` instead.

### Release assets

| Asset | Flash offset |
|---|---|
| `bootloader.bin` | `0x0` |
| `partition-table.bin` | `0x8000` |
| `ota_data_initial.bin` | `0xf000` |
| `rotation_target_backend.bin` | `0x20000` |
| `storage.bin` | `0x620000` |

> **`storage.bin` currently ships without the web app.** The release build has
> no `webapp/dist` to bundle, so the released image serves the API only and
> `GET /` answers 404. Building the webapp into the release image lands with
> the webapp CI.

## The workflows

The reqstool org's reusable release workflows are the model, and
[`common-release-assets.yml`](https://github.com/reqstool/.github/blob/main/.github/workflows/common-release-assets.yml)
is called directly (pinned by commit). `common-release-prepare`,
`common-release-tag` and `common-release-promote` are ported into
`firmware-release.yml` instead of called: they validate the version as bare
semver and tag it unprefixed, which a shared tag namespace cannot use.

`.github/cliff-firmware.toml` is a near-copy of the org's default git-cliff
config with the firmware's `tag_pattern`; keep the two in step.
