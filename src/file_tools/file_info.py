#!/usr/bin/env python3
"""File metadata without reading full content — saves tokens before targeted reads."""

import os
from datetime import datetime, timezone

from _common import emit_error, emit_json, load_args, is_probably_text, resolve_path


def count_lines(path):
    count = 0
    with open(path, 'r', encoding='utf-8', errors='replace') as handle:
        for count, _ in enumerate(handle, start=1):
            pass
    return count


def main():
    args = load_args()
    file_path = resolve_path(args.get('path'), args.get('workspace'))

    if not os.path.isfile(file_path):
        emit_error(f'File not found: {file_path}')

    try:
        stat = os.stat(file_path)
    except OSError as exc:
        emit_error(f'Failed to stat file: {exc}')

    ext = os.path.splitext(file_path)[1].lower()
    info = {
        'path': file_path,
        'basename': os.path.basename(file_path),
        'extension': ext,
        'size_bytes': stat.st_size,
        'modified_utc': datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        'is_probably_text': is_probably_text(file_path),
    }

    if info['is_probably_text'] and stat.st_size <= 5_000_000:
        try:
            info['line_count'] = count_lines(file_path)
        except OSError:
            info['line_count'] = None
    else:
        info['line_count'] = None

    emit_json(info)


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        emit_error(str(exc))
