#!/usr/bin/env python3
"""tests/snapshot_diff.py — compare pre/ vs post/ snapshots, exit 1 on diff.

Usage:
  python3 tests/snapshot_diff.py            # diff pre vs post
  python3 tests/snapshot_diff.py --post X   # diff pre vs snapshots/X
"""
import difflib
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PRE = ROOT / "snapshots" / "pre"
POST = ROOT / "snapshots" / (sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--post" else "post")

ANSI = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")
RGB = re.compile(r"\x1b\[(?:38;2|48;2);[\d;]+m")
HOME = os.environ.get("HOME", "/home/andycungkrinx")
HOME_RE = re.compile(re.escape(HOME))
PID_RE = re.compile(r"\bpid[=:]\s*\d+", re.IGNORECASE)
TS_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b")
DURATION_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds)\b", re.IGNORECASE)
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)
TRAILING_WS = re.compile(r"[ \t]+$", re.MULTILINE)
BLANK_LINES = re.compile(r"^\s*$\n", re.MULTILINE)


def normalize(text: str) -> str:
    text = ANSI.sub("", text)
    text = RGB.sub("", text)
    text = HOME_RE.sub("$HOME", text)
    text = PID_RE.sub("pid=$PID", text)
    text = TS_RE.sub("$TS", text)
    text = DURATION_RE.sub("~Xs", text)
    text = UUID_RE.sub("$UUID", text)
    text = TRAILING_WS.sub("", text)
    text = BLANK_LINES.sub("\n", text)
    return text.strip() + "\n"


def read_normalized(path: pathlib.Path) -> str:
    return normalize(path.read_text(encoding="utf-8", errors="replace"))


def main() -> int:
    if not PRE.exists():
        print(f"ERROR: pre-snapshots not found at {PRE}. Run: node tests/snapshot_capture.js capture pre", file=sys.stderr)
        return 2
    if not POST.exists():
        print(f"ERROR: post-snapshots not found at {POST}. Run: node tests/snapshot_capture.js capture post", file=sys.stderr)
        return 2

    pre_files = sorted(p for p in PRE.iterdir() if p.is_file())
    if not pre_files:
        print(f"ERROR: no pre-snapshots in {PRE}", file=sys.stderr)
        return 2

    diffs = []
    for pre_path in pre_files:
        post_path = POST / pre_path.name
        if not post_path.exists():
            diffs.append((pre_path.name, "MISSING", "", ""))
            continue
        pre_text = read_normalized(pre_path)
        post_text = read_normalized(post_path)
        if pre_text != post_text:
            diff = "".join(
                difflib.unified_diff(
                    pre_text.splitlines(keepends=True),
                    post_text.splitlines(keepends=True),
                    fromfile=f"pre/{pre_path.name}",
                    tofile=f"post/{pre_path.name}",
                    n=2,
                )
            )
            diffs.append((pre_path.name, "DIFF", diff, ""))

    if not diffs:
        print(f"OK — all {len(pre_files)} snapshots match (post={POST.name})")
        return 0

    print(f"FAIL — {len(diffs)}/{len(pre_files)} snapshots differ:\n", file=sys.stderr)
    for name, kind, diff, _ in diffs:
        if kind == "MISSING":
            print(f"  [MISSING] post/{name}", file=sys.stderr)
        else:
            print(f"  [DIFF] {name}", file=sys.stderr)
            print(diff, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())