#!/usr/bin/env python3
"""The problem vocabulary is one list, written down in three places.

`Problem.type` in `openapi.yaml` is the contract; `kProblemTypes` in
`firmware/lib/rt_logic/problem.h` is what the device can actually answer with;
`PROBLEMS` in `webapp/test/mock-server/server.ts` is what the webapp's tests are
written against. A type in one and not another is a refusal a client cannot
recognise, or a slug the mock answers that the device never sends.

The webapp already fails to compile on its half of this - `PROBLEMS` is
`satisfies Record<ProblemType, ...>` over the generated union, so a type in the
contract and missing from the mock is a `tsc` error, which is how the missing
`program_banks_unavailable` was caught. Nothing checked the firmware, and
nothing checked the other direction. This does both.

Text extraction rather than parsing: the alternative is a YAML dependency and a
C++ parser to check twelve lines of enum, and both would be more to get wrong
than the thing they check. Anything that moves those declarations far enough to
break these patterns fails loudly here rather than passing quietly.
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

OPENAPI = HERE / "openapi.yaml"
PROBLEM_H = REPO / "firmware" / "lib" / "rt_logic" / "problem.h"
MOCK = REPO / "webapp" / "test" / "mock-server" / "server.ts"


def from_openapi(text: str) -> set[str]:
    """The `Problem.type` enum members, as bare slugs."""
    # The enum is the only place `- /problems/<slug>` appears at a list item.
    slugs = set(re.findall(r"^\s*-\s+/problems/([a-z_]+)\s*$", text, re.MULTILINE))
    if not slugs:
        sys.exit("check_problem_types: found no /problems/... enum in openapi.yaml")
    return slugs


def from_problem_h(text: str) -> set[str]:
    """The second argument of each X(...) in the registry macro."""
    slugs = set(re.findall(r'^\s*X\(\s*k\w+\s*,\s*"([a-z_]+)"', text, re.MULTILINE))
    if not slugs:
        sys.exit("check_problem_types: found no X(...) registry in problem.h")
    return slugs


def from_mock(text: str) -> set[str]:
    """The keys of the PROBLEMS map."""
    slugs = set(re.findall(r"^\s*'/problems/([a-z_]+)':", text, re.MULTILINE))
    if not slugs:
        sys.exit("check_problem_types: found no PROBLEMS map in the mock server")
    return slugs


def report(name: str, missing: set[str], where: str) -> bool:
    if not missing:
        return True
    for slug in sorted(missing):
        print(f"  {slug}: in {name}, missing from {where}")
    return False


def main() -> int:
    contract = from_openapi(OPENAPI.read_text(encoding="utf-8"))
    firmware = from_problem_h(PROBLEM_H.read_text(encoding="utf-8"))
    mock = from_mock(MOCK.read_text(encoding="utf-8"))

    ok = True
    print(f"Problem types: {len(contract)} in the contract, {len(firmware)} in the firmware, {len(mock)} in the mock")

    ok &= report("openapi.yaml", contract - firmware, "firmware/lib/rt_logic/problem.h")
    ok &= report("problem.h", firmware - contract, "contracts/openapi.yaml")
    ok &= report("openapi.yaml", contract - mock, "the mock server")
    ok &= report("the mock server", mock - contract, "contracts/openapi.yaml")

    if not ok:
        print("check_problem_types: the three lists disagree (see above)")
        return 1

    print("check_problem_types: the contract, the firmware and the mock agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
