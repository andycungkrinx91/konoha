#!/usr/bin/env python3
"""Regex grep with a hard cap of 20 compressed matches."""

import fnmatch
import os
import re

from _common import (
    emit_error,
    emit_json,
    is_probably_text,
    load_args,
    resolve_path,
    walk_files,
)

DEFAULT_MAX_MATCHES = 20
HARD_MAX_MATCHES = 50
MATCH_TRIM = 120


def main():
    args = load_args()
    pattern = args.get('pattern')
    if not pattern:
        emit_error('pattern is required')

    root_dir = resolve_path(args.get('dir', '.'), args.get('workspace'))
    if not os.path.isdir(root_dir):
        emit_error(f'Directory not found: {root_dir}')

    max_matches = int(args.get('max_matches', DEFAULT_MAX_MATCHES))
    if max_matches < 1:
        emit_error('max_matches must be >= 1')
    if max_matches > HARD_MAX_MATCHES:
        emit_error(f'max_matches cap is {HARD_MAX_MATCHES}')

    glob_pattern = args.get('glob') or args.get('file_glob')
    ignore_case = bool(args.get('ignore_case', False))

    flags = re.IGNORECASE if ignore_case else 0
    try:
        regex = re.compile(pattern, flags)
    except re.error as exc:
        emit_error(f'Invalid regex pattern: {exc}')

    matches = []
    truncated = False

    for file_path in walk_files(root_dir):
        if not is_probably_text(file_path):
            continue
        rel = os.path.relpath(file_path, root_dir).replace('\\', '/')
        name = os.path.basename(file_path)
        if glob_pattern and not (
            fnmatch.fnmatch(name, glob_pattern) or fnmatch.fnmatch(rel, glob_pattern)
        ):
            continue
        try:
            with open(file_path, 'r', encoding='utf-8', errors='replace') as handle:
                for line_no, line in enumerate(handle, start=1):
                    if regex.search(line):
                        snippet = line.strip()
                        if len(snippet) > MATCH_TRIM:
                            snippet = snippet[:MATCH_TRIM] + '…'
                        matches.append(f'[{rel}:{line_no}] {snippet}')
                        if len(matches) >= max_matches:
                            truncated = True
                            break
        except OSError:
            continue
        if truncated:
            break

    lines = matches[:max_matches]
    if truncated:
        lines.append(f'Showing first {max_matches} matches. Refine pattern or add glob filter.')

    emit_json({
        'dir': root_dir,
        'pattern': pattern,
        'glob': glob_pattern,
        'ignore_case': ignore_case,
        'match_count': len(matches) if not truncated else max_matches,
        'truncated': truncated,
        'text': '\n'.join(lines)
    })


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        emit_error(str(exc))
