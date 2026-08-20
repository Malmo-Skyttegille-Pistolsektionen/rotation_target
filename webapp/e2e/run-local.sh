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
#   --port <n>       host port to forward from (default 8080)
set -euo pipefail

WEBAPP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${WEBAPP_DIR}/.." && pwd)"
HOST_PORT=8080
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

echo "==> Running Playwright"
cd "${WEBAPP_DIR}"
RT_E2E_BASE_URL="http://localhost:${HOST_PORT}" npx playwright test "$@"
