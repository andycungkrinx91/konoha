#!/usr/bin/env python3
"""Read the first N lines of a file with line numbers. Max lines: 200."""

import os

from _common import emit_error, emit_json, load_args, resolve_path

DEFAULT_LINES = 80
MAX_LINES = 200


def main():
    args = load_args()
    file_path = resolve_path(args.get('path'), args.get('workspace'))
    max_lines = int(args.get('max_lines', DEFAULT_LINES))

    if max_lines < 1:
        emit_error('max_lines must be >= 1')
    if max_lines > MAX_LINES:
        emit_error(f'Refused: max_lines {max_lines} exceeds cap {MAX_LINES}')

    if not os.path.isfile(file_path):
        emit_error(f'File not found: {file_path}')

    lines_out = []
    total_lines = 0
    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as handle:
            for line_no, line in enumerate(handle, start=1):
                total_lines = line_no
                if line_no > max_lines:
                    break
                lines_out.append(f'{line_no:6}|{line.rstrip()}')
    except OSError as exc:
        emit_error(f'Failed to read file: {exc}')

    truncated = total_lines > max_lines
    emit_json({
        'path': file_path,
        'max_lines': max_lines,
        'line_count': len(lines_out),
        'total_lines': total_lines if not truncated else f'>{max_lines}',
        'truncated': truncated,
        'text': '\n'.join(lines_out)
    })


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        emit_error(str(exc))
