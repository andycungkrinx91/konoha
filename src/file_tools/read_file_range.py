#!/usr/bin/env python3
"""Stream-read a line range with line numbers. Max span: 500 lines."""

import os
import sys

from _common import emit_error, emit_json, load_args, resolve_path

MAX_SPAN = 500


def main():
    args = load_args()
    file_path = resolve_path(args.get('path'), args.get('workspace'))
    start_line = int(args.get('start_line', 1))
    end_line = int(args.get('end_line', start_line))

    if start_line < 1 or end_line < 1:
        emit_error('start_line and end_line must be >= 1')
    if end_line < start_line:
        emit_error('end_line must be >= start_line')

    span = end_line - start_line + 1
    if span > MAX_SPAN:
        emit_error(
            f'Refused: requested span is {span} lines (max {MAX_SPAN}). '
            f'Narrow the range or read in chunks.'
        )

    if not os.path.isfile(file_path):
        emit_error(f'File not found: {file_path}')

    lines_out = []
    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as handle:
            for line_no, line in enumerate(handle, start=1):
                if line_no < start_line:
                    continue
                if line_no > end_line:
                    break
                lines_out.append(f'{line_no:6}|{line.rstrip()}')
    except OSError as exc:
        emit_error(f'Failed to read file: {exc}')

    rel = args.get('path') if not os.path.isabs(str(args.get('path', ''))) else os.path.basename(file_path)
    emit_json({
        'path': file_path,
        'start_line': start_line,
        'end_line': end_line,
        'line_count': len(lines_out),
        'text': '\n'.join(lines_out)
    })


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        emit_error(str(exc))
