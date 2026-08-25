#!/usr/bin/env python3
"""Run clang-tidy over our firmware sources, and fail on anything it finds.

    run_clang_tidy.py <build-dir> [--jobs N]

`<build-dir>` must have been configured with the **clang** toolchain:

    idf.py -B <build-dir> -D IDF_TOOLCHAIN=clang reconfigure

That matters more than it sounds. The ordinary GCC build's
`compile_commands.json` is not clang-compatible - it invokes
`xtensa-esp32s3-elf-g++` with `-specs=…/picolibc.specs`,
`-mdisable-hardware-atomics` and three GCC-only codegen flags, none of which
any clang accepts. Reconfiguring with the clang toolchain makes ESP-IDF emit a
database clang can consume directly, rather than one somebody has to
hand-repair. (And plain upstream clang-tidy cannot be used at all: LLVM has no
Xtensa backend, so it fails with `unknown target triple`. This needs
Espressif's `esp-clang`, which `idf_tools.py install esp-clang` provides.)

**Scope is enforced here, not by the header filter.** `HeaderFilterRegex` is
not enough on its own: `clang-analyzer-*` is path-sensitive and reports at the
line it reasoned about, so a leak it believes it found inside ArduinoJson
arrives with a vendored path however the filter is set. Vendored code is never
ours to fix (AGENTS.md), so every finding is matched against our directories
before it counts.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIRMWARE = REPO / "firmware"

# Ours. Everything else - ESP-IDF, managed components, the vendored trees - is
# analysed only as far as it takes to understand ours, and never reported.
OURS = (FIRMWARE / "main", FIRMWARE / "lib" / "rt_logic")

# `path:line:col: warning|error: message [check-name]`
FINDING = re.compile(r"^(?P<path>[^:]+):(?P<line>\d+):(?P<col>\d+): (?:warning|error): .*\[(?P<check>[^\]]+)\]$")


def find_clang_tidy() -> str:
    """Espressif's clang-tidy. Upstream LLVM has no Xtensa backend."""
    tools = Path(os.environ.get("IDF_TOOLS_PATH", Path.home() / ".espressif")) / "tools" / "esp-clang"
    candidates = sorted(tools.glob("*/esp-clang/bin/clang-tidy"))
    if candidates:
        return str(candidates[-1])
    found = shutil.which("clang-tidy")
    if found:
        return found
    sys.exit(
        "No clang-tidy found. Espressif's is the one that works here:\n"
        "  python3 $IDF_PATH/tools/idf_tools.py install esp-clang"
    )


def is_ours(path: Path) -> bool:
    return any(path.is_relative_to(root) for root in OURS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("build_dir", type=Path)
    parser.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2)))
    args = parser.parse_args()

    database = args.build_dir / "compile_commands.json"
    if not database.is_file():
        sys.exit(f"{database} does not exist - configure with -D IDF_TOOLCHAIN=clang first")

    entries = json.loads(database.read_text())
    files = sorted({e["file"] for e in entries if is_ours(Path(e["file"]).resolve())})
    if not files:
        sys.exit(f"{database} names none of our sources - was it configured from {FIRMWARE}?")

    clang_tidy = find_clang_tidy()
    print(f"clang-tidy: {clang_tidy}")
    print(f"{len(files)} translation unit(s) in scope, {args.jobs} at a time")

    def analyse(path: str) -> str:
        result = subprocess.run(
            [clang_tidy, "-p", str(args.build_dir), "--quiet", path],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.stdout + result.stderr

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        output = "".join(pool.map(analyse, files))

    findings: set[tuple[str, str, str, str]] = set()
    for line in output.splitlines():
        match = FINDING.match(line.strip())
        if not match:
            continue
        path = Path(match["path"])
        if not path.is_absolute() or not is_ours(path.resolve()):
            continue
        # A header included by sixteen sources is reported sixteen times; the
        # count that matters is how many places need touching.
        findings.add(
            (str(path.resolve().relative_to(REPO)), match["line"], match["col"], match["check"])
        )

    for path, line, col, check in sorted(findings):
        print(f"::error file={path},line={line},col={col}::clang-tidy: {check}")

    if findings:
        by_check: dict[str, int] = {}
        for _, _, _, check in findings:
            by_check[check] = by_check.get(check, 0) + 1
        print(f"\n{len(findings)} clang-tidy finding(s):", file=sys.stderr)
        for check, count in sorted(by_check.items(), key=lambda kv: -kv[1]):
            print(f"  {count:>4}  {check}", file=sys.stderr)
        print(
            "\nThe enabled set is narrow on purpose (firmware/.clang-tidy) so that it stays at "
            "zero. Fix it, or widen the config deliberately - not with a suppression comment.",
            file=sys.stderr,
        )
        return 1

    print("clang-tidy is clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
