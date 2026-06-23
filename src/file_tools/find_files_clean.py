#!/usr/bin/env python3
"""Walk a directory tree and return matching file paths (blacklisted dirs skipped)."""

import os

from _common import emit_error, emit_json, load_args, match_glob_pattern, resolve_path, walk_files


def main():
    args = load_args()
    pattern = args.get('pattern', '*')
    root_dir = resolve_path(args.get('dir', '.'), args.get('workspace'))
    if not os.path.isdir(root_dir):
        emit_error(f'Directory not found: {root_dir}')

    results = []
    for file_path in walk_files(root_dir):
        rel = os.path.relpath(file_path, root_dir)
        name = os.path.basename(file_path)
        if match_glob_pattern(name, pattern) or match_glob_pattern(rel, pattern):
            results.append(rel.replace(os.sep, '/'))

    results.sort()
    emit_json({
        'dir': root_dir,
        'pattern': pattern,
        'count': len(results),
        'files': results
    })


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        emit_error(str(exc))
