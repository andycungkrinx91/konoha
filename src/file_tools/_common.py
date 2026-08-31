#!/usr/bin/env python3
"""Shared helpers for Konoha token-efficient file tools."""

import fnmatch
import json
import os
import sys

SKIP_DIR_NAMES = {
    '.git', 'node_modules', 'dist', 'build', 'venv', '.venv',
    '__pycache__', '.tox', '.mypy_cache', '.pytest_cache', '.next',
    'coverage', '.nyc_output', 'target', 'go-dist', 'vendor'
}

SKIP_FILE_NAMES = {
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock',
    'poetry.lock', 'Gemfile.lock', 'composer.lock'
}

TEXT_EXTENSIONS = {
    '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.md',
    '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss', '.sass',
    '.less', '.vue', '.svelte', '.go', '.rs', '.java', '.kt', '.rb',
    '.php', '.sh', '.bash', '.zsh', '.sql', '.env', '.ini', '.cfg',
    '.conf', '.txt', '.rst', '.csv', '.graphql', '.proto'
}


def emit_json(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def emit_error(message, code=1):
    emit_json({'error': message})
    sys.exit(code)


def load_args():
    if len(sys.argv) < 2:
        emit_error('Missing JSON arguments on argv[1]')
    try:
        return json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        emit_error(f'Invalid JSON arguments: {exc}')


def resolve_path(raw_path, base_dir=None):
    if not raw_path or not isinstance(raw_path, str):
        emit_error('path is required')
    expanded = os.path.expanduser(raw_path)
    if not os.path.isabs(expanded):
        base = base_dir or os.getcwd()
        expanded = os.path.abspath(os.path.join(base, expanded))
    else:
        expanded = os.path.abspath(expanded)
    try:
        real = os.path.realpath(expanded)
    except OSError:
        real = expanded
    assert_within_allowed(real, base_dir)
    return real


_KONOHA_HOME = None
def _get_konoha_home():
    global _KONOHA_HOME
    if _KONOHA_HOME is None:
        _KONOHA_HOME = os.path.realpath(os.path.expanduser('~/.konoha'))
    return _KONOHA_HOME


def _norm(p):
    """Normalize a path; on Windows also lowercase for case-insensitive compare."""
    n = os.path.normpath(p)
    if os.name == 'nt':
        n = os.path.normcase(n)
    return n


def assert_within_allowed(resolved_path, base_dir=None):
    """Allow paths inside the workspace OR inside ~/.konoha/.

    The ~/.konoha/ allowance ensures the MCP server can read its own
    files (scripts, configs, skill data) even when the IDE workspace
    is something unrelated (e.g. a brain session directory).
    """
    norm_path = _norm(resolved_path)

    # 1. Konoha install directory — always allowed
    norm_konoha = _norm(_get_konoha_home())
    sep = os.sep
    if norm_path == norm_konoha or norm_path.startswith(norm_konoha + sep):
        return

    # 1.5. Inside home-scoped agent scratch dirs (IDE internal caches)
    home_dir = os.path.expanduser('~')
    scratch_prefixes = [
        os.path.join(home_dir, '.gemini'),
        os.path.join(home_dir, '.claude'),
        os.path.join(home_dir, '.cursor'),
        os.path.join(home_dir, '.vscode'),
        os.path.join(home_dir, '.openai'),
        os.path.join(home_dir, '.windsurf'),
        os.path.join(home_dir, '.commandcode'),
        os.path.join(home_dir, '.opencode'),
        os.path.join(home_dir, '.config'),
        os.path.join(home_dir, '.codex'),
        os.path.join(home_dir, '.agents'),
        os.path.join(home_dir, '.claude.json'),
    ]
    for p in scratch_prefixes:
        p_norm = _norm(p)
        if norm_path == p_norm or norm_path.startswith(p_norm + sep):
            return

    # 2. Inside workspace root — if provided
    workspace = base_dir or os.getcwd()
    if not workspace:
        return
    try:
        ws_real = os.path.realpath(os.path.abspath(workspace))
    except OSError:
        ws_real = os.path.abspath(workspace)
    ws_real = os.path.normpath(ws_real) if os.name != 'nt' else os.path.normcase(os.path.normpath(ws_real))
    common = None
    try:
        common = os.path.commonpath([ws_real, norm_path])
    except ValueError:
        emit_error(f'Path outside workspace: {resolved_path}')
    if common != ws_real:
        emit_error(f'Path outside workspace: {resolved_path}')


def should_skip_dir(dirname):
    return dirname in SKIP_DIR_NAMES or dirname.startswith('.')


def should_skip_file(filename):
    if filename in SKIP_FILE_NAMES:
        return True
    if filename.endswith('.lock'):
        return True
    return False


def is_probably_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in TEXT_EXTENSIONS:
        return True
    # Skip obvious binaries by extension
    if ext in {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf',
               '.zip', '.gz', '.tar', '.wasm', '.so', '.dylib', '.dll', '.exe'}:
        return False
    return True


def walk_files(root_dir):
    for dirpath, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]
        for name in filenames:
            if should_skip_file(name):
                continue
            yield os.path.join(dirpath, name)


def match_glob_pattern(name, pattern):
    return fnmatch.fnmatch(name, pattern) or fnmatch.fnmatch(name.lower(), pattern.lower())
