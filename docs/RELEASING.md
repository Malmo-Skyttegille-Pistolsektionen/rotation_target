# Releasing

**One product, one version, one tag.** The webapp bundle and the shipped
programs and audio are baked into the same LittleFS image the firmware boots
from, so a build of this repository is a single artifact — there is no such
thing as a webapp release or a resources release. Tags are bare semver:

```
2.0.0
```

No `v`, no component prefix, no `X.Y` shorthand. The tag string *is* the version
the device reports and the version the webapp displays, so it has to be a semver
value with nothing to strip. See `docs/DECISIONS.md` D-29.

**The tag is the version.** Nothing in the tree holds one: no version files, no
version-bump commits, no manifest of shipped asset versions. A release is a tag
and the artifacts built from it — so reverting one means deleting a tag, and asking
"what version is this?" always means asking git.

## Where the version comes from

`firmware/CMakeLists.txt` sets `PROJECT_VER` before `project()` from:

```
git describe --tags --match '[0-9]*.[0-9]*.[0-9]*' --always --dirty
```

The `--match` is load-bearing: ESP-IDF's own default is a bare `git describe`,
which would name the firmware after whatever unrelated tag happened to be
nearest (`pre-copilot`, say). From there the value flows into
`esp_app_desc_t.version` — visible in `esptool image-info`, in the boot log and
to OTA — and `GET /api/v2/version` splits it into `{major, minor, patch}`.

`webapp/vite.config.ts` runs the same command and injects the result as
`__APP_VERSION__`, so the bundle baked into the image reports the identical
string. The Settings page shows both it and the device's own answer from
`GET /api/v2/diagnostics/info`, and flags a disagreement — which can only mean a
development bundle is pointed at a device flashed with something else.
`webapp/package.json` carries a `0.0.0` placeholder that nothing reads.

| Build | `esp_app_desc_t.version` | `GET /api/v2/version` |
|---|---|---|
| At tag `2.0.0` | `2.0.0` | `2.0.0` |
| Same, dirty tree | `2.0.0-dirty` | `2.0.0` |
| Three commits past it | `2.0.0-3-g09a3691` | `2.0.0` |
| No release tag reachable | `09a3691` | `0.0.0` |

The API parser deliberately accepts only a full three-part number followed by
end-of-string, `-` or `+`, so the `-N-ghash` and `-dirty` suffixes report the tag
they descend from, while an untagged build reports `0.0.0` rather than inventing
a version out of a commit hash. That last row is announced at configure time as
a `-- Firmware version: no release tag reachable ...` status line — a CI checkout
without `fetch-tags: true` is the usual cause.

`PROJECT_VER` is resolved at CMake **configure** time, so a tag created after the
last configure is not picked up by an incremental `idf.py build`. Run
`idf.py reconfigure` first.

## Cutting a release

Run the **release** workflow from `main` (or a `hotfix/*` / `release/*` branch —
anything else is rejected before a tag exists). There is no `ref` input: the
release is cut from the ref the workflow is dispatched on, which is the only way
the checks below can be guaranteed to run on the commit that gets tagged.

1. **Preview it.** `dry-run` is on by default. The run resolves the version and
   writes the release notes into the job summary without tagging anything, and
   costs one cheap job rather than a full ESP-IDF build. Check the notes against
   the commit list the summary also prints: anything missing was dropped as
   unconventional or as a skipped `ci:` commit, which is how a mistyped commit
   type gets caught before it becomes a wrong version bump.

2. **Run it again with `dry-run` off.**
   - `version` — leave empty to auto-detect. git-cliff computes the next version
     from the Conventional Commits since the last tag: `feat:` bumps the minor,
     `fix:` the patch, `!`/`BREAKING CHANGE:` the major (below 1.0, the minor).
   - `force` — only needed when the `version` you pass disagrees with the
     auto-detected one. Without it the mismatch is a hard error naming both,
     which is the guard against "meant 2.1.0, typed 2.0.1". The **first**
     release needs it: with no tag to count from there is nothing to bump.

## What the run does

```
prepare  ->  checks  ->  [approval]  ->  build + prerelease + assets
                                           ->  verify the published assets
                                           ->  promote to latest
```

- **prepare** resolves the version, refuses a ref that is not on main, refuses a
  commit that already carries a release tag, refuses a tag that exists, and
  generates the notes. Nothing durable happens; a dry run stops here.
- **checks** calls `firmware-build`, `webapp-build`, `webapp-e2e` and `lint` as
  reusable workflows at the same commit — so the reviewer at the gate approves
  something already green rather than a version string. All four, because one
  image carries all three components: the E2E suite is the only check that
  proves the bundle about to be baked in drives the firmware it is baked into.
- **build** sits behind the `release` environment (see below), creates the tag
  **locally**, builds the webapp, builds the firmware with that bundle inside
  the LittleFS image, and reads `esp_app_desc_t.version` back out of the image
  to assert it is exactly the version being released. Still nothing durable.
- **publish** pushes the tag and creates the GitHub release as a **prerelease**
  with the assets attached in the same call — so the release never exists in a
  state where its images are missing.
- **verify** downloads the published assets over the same public path a user
  takes and re-derives the checksums and the embedded version from the bytes
  that actually landed. This is a different claim from the build's: that one
  proved the build was correct, this proves the upload was.
- **promote** clears the prerelease flag and marks the release latest.

The prerelease is the load-bearing part. It is publicly readable by exact tag,
so verification exercises the real download path, but `/releases/latest`
excludes it — so a failed verification never serves anyone a broken release. Not
a draft: a draft's assets need an authenticated token, so nothing could verify
them. If a run fails after the tag is pushed, the tag and the prerelease stay
for a human to delete or supersede; nothing is advertised as the latest release.

### The `release` environment

The approval gate is `environment: release` on the build job. **GitHub
auto-creates a named environment on first use with no protection rules at all**,
so until someone configures it by hand with a required reviewer, that job runs
straight through and the gate silently does nothing. Configure it under
*Settings → Environments → release → Required reviewers*.

### Release assets

| Asset | Flash offset |
|---|---|
| `bootloader.bin` | `0x0` |
| `partition-table.bin` | `0x8000` |
| `ota_data_initial.bin` | `0xf000` |
| `rotation_target_backend.bin` | `0x20000` |
| `storage.bin` | `0x620000` |

`SHA256SUMS.txt` covers all five. `storage.bin` carries the webapp bundle and
the shipped programs and audio.

## The workflows

`.github/workflows/release.yml` is self-contained: it calls no workflow from any
other repository. The two helpers it needs are local composite actions —
`.github/actions/setup-git-cliff` (a pinned, checksum-verified binary) and
`.github/actions/check-version` (bare-semver shape check, with a named error for
the `v` and component-prefix mistakes). `cliff.toml` at the repository root is the
single git-cliff config: one product, one tag line, one config.
