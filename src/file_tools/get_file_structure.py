#!/usr/bin/env python3
"""Extract compact structural signatures (classes/functions) from a source file."""

import ast
import os
import re

from _common import emit_error, emit_json, load_args, resolve_path

JS_TS_SIGNATURE_RE = re.compile(
    r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?'
    r'(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(|'
    r'(?:interface|type)\s+(\w+))',
    re.MULTILINE,
)

GENERIC_DEF_RE = re.compile(
    r'^\s*(?:pub\s+)?(?:async\s+)?(?:fn|func|def|class|struct|enum|interface|type)\s+(\w+)',
    re.MULTILINE,
)


def structure_python(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as handle:
        source = handle.read()
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f'# parse error: {exc.msg} (line {exc.lineno})']

    lines = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            bases = ', '.join(
                b.id if isinstance(b, ast.Name) else getattr(ast, 'unparse', lambda n: '…')(b)
                for b in node.bases[:3]
            )
            suffix = f'({bases})' if bases else ''
            lines.append(f'class {node.name}{suffix}:  # L{node.lineno}')
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args = [a.arg for a in node.args.args[:6]]
            arg_text = ', '.join(args)
            if len(node.args.args) > 6:
                arg_text += ', …'
            prefix = 'async def' if isinstance(node, ast.AsyncFunctionDef) else 'def'
            lines.append(f'{prefix} {node.name}({arg_text}):  # L{node.lineno}')
    return lines


def structure_js_ts(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as handle:
        source = handle.read()

    lines = []
    for match in JS_TS_SIGNATURE_RE.finditer(source):
        name = next((g for g in match.groups() if g), None)
        if not name:
            continue
        line_no = source.count('\n', 0, match.start()) + 1
        snippet = match.group(0).strip().split('\n', 1)[0]
        if len(snippet) > 100:
            snippet = snippet[:100] + '…'
        lines.append(f'{snippet}  # L{line_no}')
    return lines


def structure_generic(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as handle:
        source = handle.read()
    lines = []
    for match in GENERIC_DEF_RE.finditer(source):
        line_no = source.count('\n', 0, match.start()) + 1
        snippet = match.group(0).strip()
        if len(snippet) > 100:
            snippet = snippet[:100] + '…'
        lines.append(f'{snippet}  # L{line_no}')
    return lines[:200]


def main():
    args = load_args()
    file_path = resolve_path(args.get('path'), args.get('workspace'))

    # Directory support: walk top-level files and extract signatures
    if os.path.isdir(file_path):
        all_entries = []
        try:
            entries = sorted(os.listdir(file_path))
        except PermissionError:
            emit_error(f'Permission denied: {file_path}')
            return

        dirs = []
        files = []
        for entry in entries:
            full = os.path.join(file_path, entry)
            # Skip hidden and common noise directories
            if entry.startswith('.') or entry in {
                'node_modules', '__pycache__', '.git', 'dist', 'build',
                'venv', '.venv', '.next', '.nuxt', '.svelte-kit'
            }:
                continue
            if os.path.isdir(full):
                dirs.append(f'📁 {entry}/')
            elif os.path.isfile(full):
                ext = os.path.splitext(entry)[1].lower()
                size = os.path.getsize(full)
                size_str = f'{size}B' if size < 1024 else f'{size // 1024}KB'
                files.append(f'📄 {entry}  ({size_str})')

                # Extract signatures for supported source files
                if ext == '.py':
                    sigs = structure_python(full)
                elif ext in {'.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'}:
                    sigs = structure_js_ts(full)
                elif ext in {'.go', '.rs', '.rb', '.java', '.kt', '.swift', '.c', '.cpp', '.h'}:
                    sigs = structure_generic(full)
                else:
                    sigs = []

                if sigs:
                    for sig in sigs[:5]:
                        files.append(f'    {sig}')

        output_lines = dirs + files
        if not output_lines:
            output_lines = ['# Empty directory']

        emit_json({
            'path': file_path,
            'type': 'directory',
            'entry_count': len(dirs) + len(files),
            'text': '\n'.join(output_lines)
        })
        return

    # Single file mode (original behavior)
    if not os.path.isfile(file_path):
        emit_error(f'File not found: {file_path}')

    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.py':
        signatures = structure_python(file_path)
    elif ext in {'.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'}:
        signatures = structure_js_ts(file_path)
    else:
        signatures = structure_generic(file_path)

    if not signatures:
        signatures = ['# No structural declarations detected']

    emit_json({
        'path': file_path,
        'extension': ext,
        'declaration_count': len(signatures),
        'text': '\n'.join(signatures)
    })


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        emit_error(str(exc))

