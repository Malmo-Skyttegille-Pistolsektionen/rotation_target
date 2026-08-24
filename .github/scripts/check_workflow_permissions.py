#!/usr/bin/env python3
"""Refuse a reusable-workflow call that grants less than the callee asks for.

GitHub validates this when a run *starts*, and a violation fails the whole run
with `startup_failure`: no logs, no job list, no annotation, and nothing that
names the workflow at fault. It is also invisible to actionlint, which checks
each file on its own and never compares the two sides of a call.

It cost us the ability to release (#213): contracts.yml's `breaking-changes`
job asks for `pull-requests: write` so oasdiff can comment on a PR, while
release.yml granted its call only `contents: read`. The job is
`if: github.event_name == 'pull_request'` and would never have run from a
release - but permissions are checked before any `if` is evaluated.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

# none < read < write. A caller must grant at least what the callee asks.
RANK = {"none": 0, "read": 1, "write": 2}

# GitHub's defaults when a workflow says nothing at all. Deliberately not
# encoded: a workflow that omits `permissions` inherits a repository setting we
# cannot see from here, so we only compare what is written down. An omitted
# block is reported rather than assumed safe.
def normalise(block: object) -> dict[str, str] | None:
    """A permissions block as {scope: level}, or None if it was not written."""
    if block is None:
        return None
    if isinstance(block, str):  # `read-all` / `write-all`
        level = block.removesuffix("-all")
        return {"*": level if level in RANK else "read"}
    if isinstance(block, dict):
        return {str(k): str(v) for k, v in block.items()}
    return None


def granted_level(granted: dict[str, str], scope: str) -> int:
    if "*" in granted:
        return RANK.get(granted["*"], 0)
    return RANK.get(granted.get(scope, "none"), 0)


def load(path: Path) -> dict:
    return yaml.safe_load(path.read_text()) or {}


def main() -> int:
    root = Path(".github/workflows")
    problems: list[str] = []

    for caller_path in sorted(root.glob("*.yml")):
        caller = load(caller_path)
        caller_top = normalise(caller.get("permissions"))

        for job_name, job in (caller.get("jobs") or {}).items():
            uses = job.get("uses")
            if not isinstance(uses, str) or not uses.startswith("./"):
                continue

            callee_path = Path(uses.removeprefix("./").split("@")[0])
            if not callee_path.exists():
                problems.append(f"{caller_path}: job `{job_name}` calls missing {callee_path}")
                continue

            granted = normalise(job.get("permissions"))
            if granted is None:
                granted = caller_top
            if granted is None:
                problems.append(
                    f"{caller_path}: job `{job_name}` calls {callee_path} without an explicit "
                    f"`permissions:` block, so what it grants depends on a repository default"
                )
                continue

            callee = load(callee_path)
            callee_top = normalise(callee.get("permissions"))

            for callee_job, cjob in (callee.get("jobs") or {}).items():
                needs = normalise(cjob.get("permissions"))
                if needs is None:
                    needs = callee_top or {}

                for scope, level in needs.items():
                    if RANK.get(level, 0) <= granted_level(granted, scope):
                        continue
                    problems.append(
                        f"{caller_path}: job `{job_name}` grants "
                        f"{scope}: {granted.get(scope, 'none')} to {callee_path}, but its job "
                        f"`{callee_job}` requests {scope}: {level}. "
                        f"GitHub fails the whole run at startup for this."
                    )

    for problem in problems:
        print(f"::error::{problem}")
    if problems:
        print(f"\n{len(problems)} reusable-workflow permission problem(s).", file=sys.stderr)
        return 1

    print("Reusable-workflow permission grants are sufficient.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
