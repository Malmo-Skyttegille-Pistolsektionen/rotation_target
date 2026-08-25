#!/usr/bin/env python3
"""Refuse a firmware source file that nothing builds.

`firmware/lib/rt_logic/CMakeLists.txt` lists its sources explicitly. That is
the right shape - it is what keeps a QEMU-only or radio-only file out of the
wrong build - but it means a file can sit in the tree, look live to anyone
reading it, and never be compiled. `expert_password.{h,cpp}` did exactly that.

**No C++ linter would have caught it** (#225). clang-tidy and cppcheck analyse
translation units, and an uncompiled file has none. This is the check that
does, and it catches the mistake in both directions:

  * a file in the tree that no build references - dead weight that reads as live
  * a new source somebody forgot to register, which today silently does not
    build and fails much later as a missing symbol, or not at all

A `.cpp` counts as built when a CMakeLists names it. A `.h` counts when
something built includes it, directly or transitively - headers are never
listed in CMake, so reachability is the only thing that can be asked of them.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FIRMWARE = REPO / "firmware"

# Where our own code lives. Anything outside these is not ours to police.
SCANNED = [FIRMWARE / "main", FIRMWARE / "lib"]

# Vendored, and never reformatted or linted (AGENTS.md). psychic_http and
# dns_server carry files their own build does not use, which is upstream's
# business and not a defect we get to report.
VENDORED = {"psychic_http", "arduinojson", "dns_server"}

# Build trees, not sources. `build/` and `build-qemu/` hold generated copies
# that would otherwise be reported as unbuilt - and generated headers that
# would satisfy an include we want to see fail.
IGNORED_DIRS = {"build", "build-qemu", "managed_components", ".git"}

SOURCE_SUFFIXES = {".cpp", ".c"}
HEADER_SUFFIXES = {".h", ".hpp"}

# A quoted path ending in a source suffix, anywhere in a CMakeLists. Crude on
# purpose: SRCS entries, a `set(RT_NET_SRCS ...)` behind an `if()`, and a
# `target_sources()` all read the same way, and a literal appearing at all is
# what "some build knows about this file" means here.
CMAKE_SOURCE = re.compile(r'"([^"\s]+\.(?:cpp|c))"')

INCLUDE = re.compile(r'^\s*#\s*include\s+"([^"]+)"', re.MULTILINE)


def in_vendored(path: Path) -> bool:
    return any(part in VENDORED for part in path.parts)


def walk(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in IGNORED_DIRS for part in path.parts) or in_vendored(path):
            continue
        yield path


def registered_sources() -> set[Path]:
    """Every source file some CMakeLists names, resolved to a real path."""
    found: set[Path] = set()
    for cmakelists in FIRMWARE.rglob("CMakeLists.txt"):
        if any(part in IGNORED_DIRS for part in cmakelists.parts) or in_vendored(cmakelists):
            continue
        for match in CMAKE_SOURCE.findall(cmakelists.read_text(encoding="utf-8", errors="replace")):
            candidate = (cmakelists.parent / match).resolve()
            if candidate.is_file():
                found.add(candidate)
    return found


def reachable_headers(roots: set[Path], all_files: dict[str, list[Path]]) -> set[Path]:
    """Headers reachable by following #include "..." out of the built sources.

    Resolved by basename against everything we scanned rather than by replaying
    CMake's include directories: `main/CMakeLists.txt` puts every group on
    INCLUDE_DIRS precisely so `#include "targets.h"` works from anywhere, so
    the basename is what the source actually writes.
    """
    seen: set[Path] = set()
    queue = list(roots)
    while queue:
        current = queue.pop()
        try:
            text = current.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for included in INCLUDE.findall(text):
            for target in all_files.get(Path(included).name, []):
                if target not in seen:
                    seen.add(target)
                    queue.append(target)
    return seen


def main() -> int:
    by_name: dict[str, list[Path]] = {}
    sources: list[Path] = []
    headers: list[Path] = []
    for root in SCANNED:
        if not root.is_dir():
            continue
        for path in walk(root):
            if path.suffix in SOURCE_SUFFIXES:
                sources.append(path)
            elif path.suffix in HEADER_SUFFIXES:
                headers.append(path)
            else:
                continue
            by_name.setdefault(path.name, []).append(path.resolve())

    registered = registered_sources()

    # The host tests are globbed rather than listed, so they are roots too: a
    # header exercised only from host_test/ is still built, and reporting it
    # would be a false positive that teaches people to ignore this check.
    test_roots = {
        p.resolve()
        for p in (FIRMWARE / "host_test").rglob("*.cpp")
        if not any(part in IGNORED_DIRS for part in p.parts)
    }

    reached = reachable_headers(registered | test_roots, by_name)

    problems: list[str] = []
    for source in sorted(sources):
        if source.resolve() not in registered:
            problems.append(
                f"{source.relative_to(REPO)} is in no CMakeLists.txt, so nothing compiles it"
            )
    for header in sorted(headers):
        if header.resolve() not in reached:
            problems.append(
                f"{header.relative_to(REPO)} is included by nothing that is built"
            )

    for problem in problems:
        print(f"::error::{problem}")
    if problems:
        print(
            f"\n{len(problems)} unbuilt firmware source file(s). Either add them to a "
            "CMakeLists.txt, or delete them - a file that looks live and is not is worse "
            "than no file at all.",
            file=sys.stderr,
        )
        return 1

    print(f"All {len(sources)} source and {len(headers)} header file(s) are reachable from a build.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
