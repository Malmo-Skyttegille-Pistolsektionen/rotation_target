#!/usr/bin/env python3
"""Fail a PR whose squashed body would bump the release higher than its title says.

Merges are squash-only, `PR_TITLE` / `COMMIT_MESSAGES`: the subject on `main`
is the PR title, checked by the `conventional commit title` job, while the
body is every branch commit message concatenated, checked by nothing.
`cliff.toml` sets `conventional_commits = true`, so a `BREAKING CHANGE:`
footer anywhere in that body marks the squashed commit breaking regardless of
what the title says (AGENTS.md, "the commit" is two pieces of text) - `4690beb`
is a real instance, a `fix:` title whose body carried the footer.

This asks git-cliff the question directly rather than re-implementing its
parsing: build the message the squash will actually produce (title, then each
commit as GitHub's `COMMIT_MESSAGES` renders it, `* subject` plus body) and
compare its `--bumped-version` against the title alone. `--with-commit` injects
a virtual commit without touching real history, so nothing here mutates the
checkout. A mismatch can only mean the body implies *more* than the title -
the title's own bump is already included on both sides - which is exactly the
under-declaration #282 exists to catch.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CLIFF_CONFIG = REPO / ".github" / "cliff.toml"

BREAKING_FOOTER = re.compile(r"(?im)^BREAKING[ -]CHANGE:")


def commit_block(message: str) -> str:
    """One commit as GitHub's `COMMIT_MESSAGES` squash renders it."""
    subject, _, body = message.partition("\n")
    body = body.strip("\n")
    return f"* {subject}\n\n{body}" if body else f"* {subject}"


def squash_message(title: str, commits: list[dict]) -> str:
    blocks = [commit_block(c["commit"]["message"]) for c in commits]
    return "\n\n".join([title, *blocks])


def bumped_version(message: str) -> str:
    result = subprocess.run(
        ["git-cliff", "--config", str(CLIFF_CONFIG), "--bumped-version", "--with-commit", message],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def main() -> int:
    title = os.environ["PR_TITLE"]
    commits = json.loads(Path(sys.argv[1]).read_text())

    title_only = bumped_version(title)
    actual = bumped_version(squash_message(title, commits))

    if title_only == actual:
        print(f"Title-implied bump matches the squashed result: {actual}")
        return 0

    culprits = [
        c["sha"][:12] for c in commits if BREAKING_FOOTER.search(c["commit"]["message"])
    ]
    culprit_hint = f" Likely culprit commit(s): {', '.join(culprits)}." if culprits else ""

    print(
        f"::error::The title implies '{title_only}', but the squashed commit body would "
        f"bump the release to '{actual}'. A `BREAKING CHANGE:` footer in one of this "
        "branch's commits outweighs the title (AGENTS.md, \"the commit\" is two pieces of "
        f"text).{culprit_hint} Either raise the title to match (add `!`, or reword it as "
        "breaking), or remove/reword the footer if the change is not actually breaking."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
