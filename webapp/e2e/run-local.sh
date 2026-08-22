#!/usr/bin/env bash
#
# Run the E2E suite against the real firmware in QEMU, end to end:
#
#   . ~/esp/esp-idf-6.0.2/export.sh
#   webapp/e2e/run-local.sh                 # or: npm run e2e:local
#
# It builds the webapp, bakes `dist` into the LittleFS image the firmware
# flashes (RT_WEBAPP_DIR), boots that image in QEMU, and runs Playwright
# against the forwarded guest port. No mock and no dev server: what the browser
# talks to is the same binary the board runs.
#
# Anything after `--` goes to `playwright test`, e.g.
#   webapp/e2e/run-local.sh -- --headed e2e/run.spec.ts
#
# Options:
#   --skip-build     reuse the existing webapp/dist and firmware/build-qemu
#   --port <n>       host port to forward from (default $RT_QEMU_PORT or 8080)
#
# The port is refused if something is already listening on it, and after boot
# the device is checked to be the image just built - a suite that talks to
# another checkout's device produces passes and failures that both mean
# nothing (issue #110).
set -euo pipefail

WEBAPP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${WEBAPP_DIR}/.." && pwd)"
HOST_PORT="${RT_QEMU_PORT:-8080}"
SKIP_BUILD=0

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-build) SKIP_BUILD=1; shift ;;
        --port) HOST_PORT="$2"; shift 2 ;;
        --) shift; break ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

if [ -z "${IDF_PATH:-}" ]; then
    echo "IDF_PATH is not set - run '. ~/esp/esp-idf-6.0.2/export.sh' first" >&2
    exit 1
fi

QEMU_PID=""
QEMU_LOG="${REPO_ROOT}/firmware/build-qemu/qemu-serial.log"

cleanup() {
    local status=$?
    if [ -n "${QEMU_PID}" ] && kill -0 "${QEMU_PID}" 2>/dev/null; then
        echo "==> Stopping QEMU (pid ${QEMU_PID})"
        kill "${QEMU_PID}" 2>/dev/null || true
        wait "${QEMU_PID}" 2>/dev/null || true
    fi
    if [ "${status}" -ne 0 ] && [ -f "${QEMU_LOG}" ]; then
        echo "==> Last 40 lines of the guest serial log:"
        tail -40 "${QEMU_LOG}"
    fi
}
trap cleanup EXIT INT TERM

if [ "${SKIP_BUILD}" -eq 0 ]; then
    echo "==> Building the webapp"
    (cd "${WEBAPP_DIR}" && npm run build)

    # RT_WEBAPP_DIR defaults to ../webapp/dist, so the build above is what gets
    # baked into the LittleFS image by the build below. Order matters.
    echo "==> Building the QEMU firmware profile with that dist baked in"
    "${REPO_ROOT}/firmware/scripts/run-qemu.sh" --build-only
fi

# A bound port is the whole of issue #110: QEMU's hostfwd fails to bind, the
# script carries on, and Playwright talks to whatever else is listening -
# another checkout's device, a stray dev server. Both its passes and its
# failures are then meaningless, and nothing in the output says so.
if (exec 3<>"/dev/tcp/127.0.0.1/${HOST_PORT}") 2>/dev/null; then
    exec 3<&- 3>&-
    echo "something is already listening on 127.0.0.1:${HOST_PORT}." >&2
    echo "Refusing to start: the suite would run against it, not against the" >&2
    echo "device this script builds. Free the port, or pick another one with" >&2
    echo "  --port <n>   (or RT_QEMU_PORT=<n>)" >&2
    exit 1
fi

# --no-build: the tree was either built above or deliberately reused with
# --skip-build, so the runner's own build pass would be a no-op either way.
echo "==> Booting QEMU on port ${HOST_PORT}"
"${REPO_ROOT}/firmware/scripts/run-qemu.sh" --no-build --headless --port "${HOST_PORT}" \
    > "${QEMU_LOG}" 2>&1 &
QEMU_PID=$!

echo "==> Waiting for the device to answer"
for _ in $(seq 1 180); do
    if curl -sf -o /dev/null "http://127.0.0.1:${HOST_PORT}/api/v2/version"; then
        break
    fi
    if ! kill -0 "${QEMU_PID}" 2>/dev/null; then
        echo "QEMU exited before it served anything" >&2
        exit 1
    fi
    sleep 1
done
curl -sf -o /dev/null "http://127.0.0.1:${HOST_PORT}/api/v2/version" || {
    echo "the device did not serve /api/v2/version within 180s" >&2
    exit 1
}

# The port check above cannot catch everything: the port can be free at the
# check and taken by the time QEMU binds it. So assert the device answering is
# the image just built, reading the expected values straight out of the binary
# rather than trusting the tree to be clean.
QEMU_IMAGE="${REPO_ROOT}/firmware/build-qemu/rotation_target_backend.bin"
if [ -f "${QEMU_IMAGE}" ]; then
    echo "==> Checking the device is the image we just built"
    APP_DESC="${REPO_ROOT}/firmware/scripts/app_desc.py"
    WANT_VERSION="$(python3 "${APP_DESC}" "${QEMU_IMAGE}" --field version)"
    WANT_BUILD="$(python3 "${APP_DESC}" "${QEMU_IMAGE}" --field date) $(python3 "${APP_DESC}" "${QEMU_IMAGE}" --field time)"
    INFO="$(curl -sf "http://127.0.0.1:${HOST_PORT}/api/v2/diagnostics/info")"
    GOT_VERSION="$(printf '%s' "${INFO}" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
    GOT_BUILD="$(printf '%s' "${INFO}" | sed -n 's/.*"buildDate":"\([^"]*\)".*/\1/p')"
    if [ "${GOT_VERSION}" != "${WANT_VERSION}" ] || [ "${GOT_BUILD}" != "${WANT_BUILD}" ]; then
        echo "the device on port ${HOST_PORT} is not the image this script built." >&2
        echo "  built:     ${WANT_VERSION} (${WANT_BUILD})" >&2
        echo "  answering: ${GOT_VERSION} (${GOT_BUILD})" >&2
        echo "Another device is on that port. Results against it would be" >&2
        echo "meaningless whichever way they came out." >&2
        exit 1
    fi
fi

echo "==> Running Playwright"
cd "${WEBAPP_DIR}"
RT_E2E_BASE_URL="http://localhost:${HOST_PORT}" npx playwright test "$@"
