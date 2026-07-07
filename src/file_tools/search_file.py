#!/usr/bin/env python3
"""Search file contents semantically using semble."""

import os
import sys
import inspect

from _common import emit_error, emit_json, load_args, resolve_path

def main():
    args = load_args()
    query = args.get('query')
    if not query:
        emit_error('query is required')
    
    dir_path = resolve_path(args.get('dir', '.'), args.get('workspace'))
    top_k = args.get('top_k', 5)
    
    try:
        from semble import SembleIndex
    except ImportError:
        emit_error('semble library not installed or not found on PYTHONPATH')

    try:
        # Resolve signature of from_path
        sig = inspect.signature(SembleIndex.from_path)
        if 'content' in sig.parameters:
            from semble.types import ContentType
            content = [ContentType.CODE, ContentType.DOCS, ContentType.CONFIG]
            index = SembleIndex.from_path(dir_path, content=content)
        else:
            index = SembleIndex.from_path(dir_path, include_text_files=True)
    except Exception as exc:
        emit_error(f'Failed to build/load index for {dir_path}: {exc}')

    try:
        results = index.search(query, top_k=top_k)
    except Exception as exc:
        emit_error(f'Search failed: {exc}')

    formatted = []
    for r in results:
        formatted.append({
            'file_path': r.chunk.file_path,
            'start_line': r.chunk.start_line,
            'end_line': r.chunk.end_line,
            'score': float(r.score),
            'content': r.chunk.content
        })

    emit_json({
        'dir': dir_path,
        'query': query,
        'count': len(formatted),
        'results': formatted
    })

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        emit_error(str(exc))
