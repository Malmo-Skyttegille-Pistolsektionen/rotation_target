# Security

## Reporting

Report anything security-relevant to the maintainers privately — open a
[security advisory](https://github.com/Malmo-Skyttegille-Pistolsektionen/rotation_target_backend_esp32_espidf/security/advisories/new)
rather than a public issue.

**Never include WiFi credentials** in an issue, advisory, commit or any file
other than the gitignored `sdkconfig`.

## Threat model, stated plainly

This device sits on a club LAN and **controls physical targets that tell
shooters when to fire**. Unauthorised control is a safety concern, not just a
data one. It is not hardened against a determined attacker with network access,
and the following are known, deliberate properties rather than oversights.

### Admin mode is off after every boot

Admin mode is opt-in and lives in RAM only, so a reboot returns the device to
the unprotected state. **Until a client enables it, every mutating endpoint is
open** — including `POST /api/v2/targets/show` and `POST /api/v2/programs/start`.

This is parity with the frontend mock contract and the MicroPython backend, and
changing it unilaterally would break the interchangeability the two backends are
built for. It is documented in [`docs/api-v2.md`](docs/api-v2.md#auth).

If that posture is not acceptable for a given deployment, the fix is to persist
the password in NVS and provision it out of band — a change to the shared
contract, and one that should be agreed across the backends and the webapp.

### First caller sets the password

While admin mode is off, `POST /api/v2/admin-mode/enable` accepts any non-empty
password from an unauthenticated caller. Whoever calls first after a reboot
holds the only valid password until the device is power-cycled.

### Other deliberate choices

- The `admin` cookie is **not** `HttpOnly` — the webapp reads it back. It is
  `SameSite=Lax`, so it is not sent on cross-site requests; a webapp on another
  origin uses the bearer token instead.
- Tokens are 16 bytes from `esp_fill_random()`, expire after 12 hours, and at
  most 8 sessions are held at once. Password and token comparisons are
  constant-time.
- CORS reflects the request `Origin` **only** if it matches the device's own
  mDNS name or IP, or `CONFIG_RT_DEV_ORIGIN`. Anything else gets no CORS
  headers.
- `GET` endpoints, including `/api/v2/diagnostics/info`, are public. They carry
  no credential and no program data.
- **Coredumps are never exposed over the API.** A coredump is a raw RAM snapshot
  and can contain the WiFi password in plaintext; `diagnostics/info` only reports
  whether one is present. Retrieving it needs physical access.
- Uploads are capped at 1 MB, streamed to a staging file, validated, and only
  then renamed to an id-derived name — a client-supplied filename never reaches
  the filesystem.

## What is tested

The parsers that take untrusted input — WAV headers, URI path ids, program
documents and filenames — live in `lib/rt_logic/` and are covered by
`host_test/`, which CI runs under **ASan and UBSan** on every push. That is
deliberate: in `main/`, behind a `FILE*` or an HTTP request, no test and no
sanitizer can reach them.
