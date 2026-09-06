#!/usr/bin/env python3
"""
Dependency Mapper — Project Dependency Graph Builder

Parses imports across Python, TypeScript/JS, Go, Rust, and Java to build
internal dependency graphs, detect circular dependencies, calculate coupling
metrics, and generate Mermaid/DOT/JSON visualizations.

Usage:
    python dependency_mapper.py <project_dir> [--language auto] [--output deps.md] [--format mermaid|json|dot]

Requires: Python 3.8+ (stdlib only)
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class Module:
    """Represents a code module/file."""
    path: str                          # Relative path
    name: str                          # Module name
    language: str                      # Detected language
    imports: Set[str] = field(default_factory=set)     # What this module imports
    imported_by: Set[str] = field(default_factory=set) # What imports this module
    loc: int = 0                       # Lines of code
    is_external: bool = False          # External dependency


@dataclass
class CouplingMetrics:
    """Coupling metrics for a module."""
    module: str
    afferent_coupling: int = 0   # Ca: incoming dependencies (who depends on me)
    efferent_coupling: int = 0   # Ce: outgoing dependencies (who I depend on)

    @property
    def instability(self) -> float:
        """Instability index: Ce / (Ca + Ce). 0 = stable, 1 = unstable."""
        total = self.afferent_coupling + self.efferent_coupling
        return round(self.efferent_coupling / total, 3) if total > 0 else 0.0

    @property
    def classification(self) -> str:
        """Classify module based on coupling."""
        if self.afferent_coupling > 5 and self.efferent_coupling < 2:
            return "Hub (heavily depended on)"
        elif self.efferent_coupling > 5 and self.afferent_coupling < 2:
            return "Utility (depends on many)"
        elif self.afferent_coupling > 3 and self.efferent_coupling > 3:
            return "God module (high coupling both ways)"
        elif self.afferent_coupling == 0 and self.efferent_coupling == 0:
            return "Orphan (isolated)"
        elif self.afferent_coupling == 0:
            return "Leaf (entry point / consumer)"
        return "Normal"


@dataclass
class CircularDependency:
    """Represents a circular dependency chain."""
    cycle: List[str]
    length: int

    @property
    def severity(self) -> str:
        if self.length <= 2:
            return "HIGH"
        elif self.length <= 4:
            return "MEDIUM"
        return "LOW"


# ---------------------------------------------------------------------------
# Import Parsers
# ---------------------------------------------------------------------------

SKIP_DIRS = {
    'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
    '.next', '.svelte-kit', 'dist', 'build', 'target', '.terraform',
    'vendor', '.idea', '.vscode', 'coverage', '.cache', '.tox',
    'site-packages', '.mypy_cache', '.pytest_cache',
}

LANGUAGE_EXTENSIONS = {
    '.py': 'python',
    '.js': 'javascript',
    '.ts': 'typescript',
    '.jsx': 'javascript',
    '.tsx': 'typescript',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.svelte': 'svelte',
    '.vue': 'vue',
}


class ImportParser:
    """Parse imports from source files."""

    @staticmethod
    def parse_python(content: str, file_path: str) -> Set[str]:
        """Parse Python imports."""
        imports = set()
        for line in content.splitlines():
            line = line.strip()
            # from X import Y
            match = re.match(r'^from\s+([\w.]+)\s+import', line)
            if match:
                imports.add(match.group(1).split('.')[0])
                continue
            # import X, Y
            match = re.match(r'^import\s+([\w.,\s]+)', line)
            if match:
                for mod in match.group(1).split(','):
                    mod = mod.strip().split(' as ')[0].split('.')[0]
                    if mod:
                        imports.add(mod)
        return imports

    @staticmethod
    def parse_javascript(content: str, file_path: str) -> Set[str]:
        """Parse JavaScript/TypeScript imports."""
        imports = set()
        patterns = [
            # import X from 'Y'
            r'import\s+.*?\s+from\s+["\']([^"\']+)["\']',
            # import 'Y'
            r'import\s+["\']([^"\']+)["\']',
            # require('Y')
            r'require\s*\(\s*["\']([^"\']+)["\']\s*\)',
            # dynamic import('Y')
            r'import\s*\(\s*["\']([^"\']+)["\']\s*\)',
            # export { } from 'Y'
            r'export\s+.*?\s+from\s+["\']([^"\']+)["\']',
        ]
        for pattern in patterns:
            for match in re.finditer(pattern, content):
                imp = match.group(1)
                imports.add(imp)
        return imports

    @staticmethod
    def parse_go(content: str, file_path: str) -> Set[str]:
        """Parse Go imports."""
        imports = set()
        # Single import
        for match in re.finditer(r'import\s+"([^"]+)"', content):
            imports.add(match.group(1))
        # Multi-line import block
        for match in re.finditer(r'import\s*\((.*?)\)', content, re.DOTALL):
            block = match.group(1)
            for line in block.splitlines():
                line = line.strip().strip('"')
                if line and not line.startswith('//'):
                    # Remove alias
                    parts = line.split()
                    imp = parts[-1].strip('"') if parts else line
                    if imp:
                        imports.add(imp)
        return imports

    @staticmethod
    def parse_rust(content: str, file_path: str) -> Set[str]:
        """Parse Rust use/mod statements."""
        imports = set()
        for match in re.finditer(r'(?:use|mod)\s+([\w:]+)', content):
            imports.add(match.group(1).split('::')[0])
        for match in re.finditer(r'extern\s+crate\s+(\w+)', content):
            imports.add(match.group(1))
        return imports

    @staticmethod
    def parse_java(content: str, file_path: str) -> Set[str]:
        """Parse Java imports."""
        imports = set()
        for match in re.finditer(r'import\s+([\w.]+);', content):
            parts = match.group(1).split('.')
            if len(parts) >= 2:
                imports.add('.'.join(parts[:2]))
        return imports

    @classmethod
    def parse(cls, content: str, language: str, file_path: str) -> Set[str]:
        """Route to the correct parser."""
        parsers = {
            'python': cls.parse_python,
            'javascript': cls.parse_javascript,
            'typescript': cls.parse_javascript,
            'svelte': cls.parse_javascript,
            'vue': cls.parse_javascript,
            'go': cls.parse_go,
            'rust': cls.parse_rust,
            'java': cls.parse_java,
        }
        parser = parsers.get(language)
        if parser:
            return parser(content, file_path)
        return set()


# ---------------------------------------------------------------------------
# Standard Library Modules (to filter externals)
# ---------------------------------------------------------------------------

PYTHON_STDLIB = {
    'abc', 'aifc', 'argparse', 'array', 'ast', 'asyncio', 'atexit',
    'base64', 'bdb', 'binascii', 'bisect', 'builtins', 'bz2',
    'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd', 'code',
    'codecs', 'codeop', 'collections', 'colorsys', 'compileall',
    'concurrent', 'configparser', 'contextlib', 'contextvars', 'copy',
    'copyreg', 'cProfile', 'crypt', 'csv', 'ctypes', 'curses',
    'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis',
    'distutils', 'doctest', 'email', 'encodings', 'enum', 'errno',
    'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch',
    'fractions', 'ftplib', 'functools', 'gc', 'getopt', 'getpass',
    'gettext', 'glob', 'graphlib', 'grp', 'gzip', 'hashlib', 'heapq',
    'hmac', 'html', 'http', 'idlelib', 'imaplib', 'imghdr', 'imp',
    'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json',
    'keyword', 'lib2to3', 'linecache', 'locale', 'logging', 'lzma',
    'mailbox', 'mailcap', 'marshal', 'math', 'mimetypes', 'mmap',
    'modulefinder', 'multiprocessing', 'netrc', 'nis', 'nntplib',
    'numbers', 'operator', 'optparse', 'os', 'ossaudiodev',
    'pathlib', 'pdb', 'pickle', 'pickletools', 'pipes', 'pkgutil',
    'platform', 'plistlib', 'poplib', 'posix', 'posixpath', 'pprint',
    'profile', 'pstats', 'pty', 'pwd', 'py_compile', 'pyclbr',
    'pydoc', 'queue', 'quopri', 'random', 're', 'readline', 'reprlib',
    'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select',
    'selectors', 'shelve', 'shlex', 'shutil', 'signal', 'site',
    'smtpd', 'smtplib', 'sndhdr', 'socket', 'socketserver', 'sqlite3',
    'ssl', 'stat', 'statistics', 'string', 'stringprep', 'struct',
    'subprocess', 'sunau', 'symtable', 'sys', 'sysconfig', 'syslog',
    'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'termios', 'test',
    'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token',
    'tokenize', 'tomllib', 'trace', 'traceback', 'tracemalloc', 'tty',
    'turtle', 'turtledemo', 'types', 'typing', 'unicodedata',
    'unittest', 'urllib', 'uu', 'uuid', 'venv', 'warnings', 'wave',
    'weakref', 'webbrowser', 'winreg', 'winsound', 'wsgiref', 'xdrlib',
    'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport', 'zlib',
    '_thread',
}

NODE_BUILTINS = {
    'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants',
    'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https',
    'module', 'net', 'os', 'path', 'punycode', 'querystring', 'readline',
    'repl', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url',
    'util', 'v8', 'vm', 'worker_threads', 'zlib',
    'node:assert', 'node:buffer', 'node:child_process', 'node:cluster',
    'node:crypto', 'node:dgram', 'node:dns', 'node:events', 'node:fs',
    'node:http', 'node:https', 'node:net', 'node:os', 'node:path',
    'node:querystring', 'node:readline', 'node:stream', 'node:timers',
    'node:tls', 'node:url', 'node:util', 'node:v8', 'node:vm',
    'node:worker_threads', 'node:zlib', 'node:test',
}


# ---------------------------------------------------------------------------
# Dependency Mapper Engine
# ---------------------------------------------------------------------------

class DependencyMapper:
    """Maps project dependencies and calculates coupling metrics."""

    def __init__(self, target_path: str, language: str = "auto",
                 include_external: bool = False, verbose: bool = False):
        self.target_path = Path(target_path).resolve()
        self.language_filter = language
        self.include_external = include_external
        self.verbose = verbose
        self.modules: Dict[str, Module] = {}
        self.circles: List[CircularDependency] = []
        self.metrics: Dict[str, CouplingMetrics] = {}

    def run(self) -> Dict:
        """Execute full dependency mapping pipeline."""
        print(f"\n{'='*70}")
        print(f"  DEPENDENCY MAPPER")
        print(f"  Target: {self.target_path}")
        print(f"  Language: {self.language_filter}")
        print(f"{'='*70}\n")

        if not self.target_path.exists():
            print(f"❌ Target path does not exist: {self.target_path}")
            sys.exit(1)

        # Phase 1: Discover modules
        print("📁 Phase 1: Module Discovery...")
        self._discover_modules()
        print(f"   Found {len(self.modules)} modules\n")

        # Phase 2: Resolve internal dependencies
        print("🔗 Phase 2: Dependency Resolution...")
        self._resolve_dependencies()
        internal_edges = sum(len(m.imports) for m in self.modules.values() if not m.is_external)
        print(f"   Resolved {internal_edges} dependency edges\n")

        # Phase 3: Detect circular dependencies
        print("🔄 Phase 3: Circular Dependency Detection...")
        self._detect_circles()
        if self.circles:
            print(f"   ⚠️  Found {len(self.circles)} circular dependency chain(s)\n")
        else:
            print(f"   ✅ No circular dependencies detected\n")

        # Phase 4: Calculate coupling metrics
        print("📊 Phase 4: Coupling Metrics...")
        self._calculate_metrics()

        return self._build_results()

    def _discover_modules(self):
        """Discover all code modules in the project."""
        for fpath in self._walk_files():
            lang = LANGUAGE_EXTENSIONS.get(fpath.suffix, '')
            if not lang:
                continue

            if self.language_filter != 'auto' and lang not in (self.language_filter, ):
                # Handle typescript matching for js filter etc.
                lang_group = {'javascript': {'javascript', 'svelte', 'vue'},
                              'typescript': {'typescript', 'javascript', 'svelte', 'vue'},
                              'python': {'python'}, 'go': {'go'},
                              'rust': {'rust'}, 'java': {'java'}}
                if lang not in lang_group.get(self.language_filter, {lang}):
                    continue

            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            rel_path = str(fpath.relative_to(self.target_path))
            mod_name = self._path_to_module_name(rel_path, lang)

            raw_imports = ImportParser.parse(content, lang, rel_path)

            self.modules[mod_name] = Module(
                path=rel_path,
                name=mod_name,
                language=lang,
                imports=raw_imports,
                loc=len(content.splitlines()),
            )

    def _resolve_dependencies(self):
        """Resolve raw imports to internal module references."""
        internal_names = set(self.modules.keys())

        # Build a lookup from various import forms to module names
        lookup = {}
        for name in internal_names:
            lookup[name] = name
            # Also map by filename without extension
            parts = name.split('/')
            if parts:
                lookup[parts[-1]] = name
                # Python: dotted path
                lookup[name.replace('/', '.')] = name

        for mod_name, module in self.modules.items():
            resolved_imports = set()
            for imp in module.imports:
                # Try direct match
                target = lookup.get(imp)
                if not target:
                    # Try relative resolution
                    base_dir = '/'.join(mod_name.split('/')[:-1])
                    if base_dir:
                        target = lookup.get(f"{base_dir}/{imp}")

                if target and target != mod_name:
                    resolved_imports.add(target)
                    if target in self.modules:
                        self.modules[target].imported_by.add(mod_name)
                elif self.include_external:
                    # Mark as external
                    if not self._is_stdlib(imp, module.language):
                        if imp not in self.modules:
                            self.modules[imp] = Module(
                                path=imp, name=imp,
                                language=module.language,
                                is_external=True,
                            )
                        resolved_imports.add(imp)

            module.imports = resolved_imports

    def _is_stdlib(self, imp: str, language: str) -> bool:
        """Check if an import is a standard library module."""
        if language == 'python':
            return imp in PYTHON_STDLIB
        elif language in ('javascript', 'typescript', 'svelte', 'vue'):
            if imp in NODE_BUILTINS:
                return True
            if imp.startswith('.') or imp.startswith('/'):
                return False  # Relative imports are internal
            return False
        return False

    def _detect_circles(self):
        """Detect circular dependencies using DFS."""
        # Build adjacency list (internal modules only)
        graph = defaultdict(set)
        internal_modules = {n for n, m in self.modules.items() if not m.is_external}

        for name, module in self.modules.items():
            if module.is_external:
                continue
            for dep in module.imports:
                if dep in internal_modules:
                    graph[name].add(dep)

        # Find cycles using iterative DFS with color marking
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {n: WHITE for n in internal_modules}
        parent = {}
        cycles_found = set()  # Frozenset of cycles to deduplicate

        for start in internal_modules:
            if color[start] != WHITE:
                continue

            stack = [(start, iter(graph[start]))]
            color[start] = GRAY
            path = [start]

            while stack:
                node, neighbors = stack[-1]
                try:
                    neighbor = next(neighbors)
                    if color[neighbor] == GRAY:
                        # Found cycle: extract it
                        cycle_start_idx = path.index(neighbor)
                        cycle = path[cycle_start_idx:] + [neighbor]
                        cycle_key = frozenset(cycle[:-1])

                        if cycle_key not in cycles_found and len(cycle) > 1:
                            cycles_found.add(cycle_key)
                            self.circles.append(CircularDependency(
                                cycle=cycle,
                                length=len(cycle) - 1,
                            ))
                    elif color[neighbor] == WHITE:
                        color[neighbor] = GRAY
                        path.append(neighbor)
                        stack.append((neighbor, iter(graph[neighbor])))
                except StopIteration:
                    color[node] = BLACK
                    path.pop()
                    stack.pop()

        # Limit to reasonable number
        self.circles = sorted(self.circles, key=lambda c: c.length)[:50]

    def _calculate_metrics(self):
        """Calculate coupling metrics for each module."""
        for name, module in self.modules.items():
            if module.is_external:
                continue

            ca = len(module.imported_by)  # Afferent: who depends on me
            ce = len([i for i in module.imports if i in self.modules and not self.modules[i].is_external])

            self.metrics[name] = CouplingMetrics(
                module=name,
                afferent_coupling=ca,
                efferent_coupling=ce,
            )

        # Print summary
        hubs = [m for m in self.metrics.values() if 'Hub' in m.classification]
        gods = [m for m in self.metrics.values() if 'God' in m.classification]
        orphans = [m for m in self.metrics.values() if 'Orphan' in m.classification]

        if hubs:
            print(f"   📌 Hub modules (heavily depended on): {len(hubs)}")
        if gods:
            print(f"   ⚠️  God modules (high coupling): {len(gods)}")
        if orphans:
            print(f"   🏝️  Orphan modules (isolated): {len(orphans)}")
        print()

    def _build_results(self) -> Dict:
        """Build structured results."""
        internal_modules = {n: m for n, m in self.modules.items() if not m.is_external}
        external_deps = {n: m for n, m in self.modules.items() if m.is_external}

        return {
            'metadata': {
                'target': str(self.target_path),
                'language': self.language_filter,
                'total_modules': len(internal_modules),
                'total_external_deps': len(external_deps),
            },
            'modules': [
                {
                    'name': m.name,
                    'path': m.path,
                    'language': m.language,
                    'loc': m.loc,
                    'imports': sorted(m.imports),
                    'imported_by': sorted(m.imported_by),
                }
                for m in sorted(internal_modules.values(), key=lambda x: x.name)
            ],
            'external_dependencies': sorted(external_deps.keys()),
            'circular_dependencies': [
                {
                    'cycle': c.cycle,
                    'length': c.length,
                    'severity': c.severity,
                }
                for c in self.circles
            ],
            'coupling_metrics': [
                {
                    'module': m.module,
                    'afferent_coupling': m.afferent_coupling,
                    'efferent_coupling': m.efferent_coupling,
                    'instability': m.instability,
                    'classification': m.classification,
                }
                for m in sorted(self.metrics.values(),
                                key=lambda x: -(x.afferent_coupling + x.efferent_coupling))
            ],
        }

    def generate_mermaid(self, results: Dict) -> str:
        """Generate Mermaid flowchart diagram."""
        lines = ["```mermaid", "graph LR"]

        # Add module nodes
        for mod in results['modules']:
            clean_name = mod['name'].replace('/', '_').replace('.', '_').replace('-', '_')
            label = mod['name'].split('/')[-1]
            lines.append(f"    {clean_name}[\"{label}\"]")

        # Add edges
        for mod in results['modules']:
            src = mod['name'].replace('/', '_').replace('.', '_').replace('-', '_')
            for imp in mod['imports']:
                if any(m['name'] == imp for m in results['modules']):
                    dst = imp.replace('/', '_').replace('.', '_').replace('-', '_')
                    lines.append(f"    {src} --> {dst}")

        # Highlight circular dependencies
        for circle in results['circular_dependencies']:
            for node in circle['cycle'][:-1]:
                clean = node.replace('/', '_').replace('.', '_').replace('-', '_')
                lines.append(f"    style {clean} fill:#ff6b6b,stroke:#c0392b")

        lines.append("```")
        return "\n".join(lines)

    def generate_dot(self, results: Dict) -> str:
        """Generate Graphviz DOT format."""
        lines = ['digraph dependencies {', '    rankdir=LR;',
                 '    node [shape=box, style=rounded];', '']

        for mod in results['modules']:
            clean = mod['name'].replace('/', '_').replace('.', '_').replace('-', '_')
            label = mod['name']
            lines.append(f'    {clean} [label="{label}"];')

        lines.append('')

        for mod in results['modules']:
            src = mod['name'].replace('/', '_').replace('.', '_').replace('-', '_')
            for imp in mod['imports']:
                if any(m['name'] == imp for m in results['modules']):
                    dst = imp.replace('/', '_').replace('.', '_').replace('-', '_')
                    lines.append(f'    {src} -> {dst};')

        lines.append('}')
        return '\n'.join(lines)

    def generate_markdown_report(self, results: Dict) -> str:
        """Generate markdown dependency report."""
        lines = []
        meta = results['metadata']

        lines.append(f"# Dependency Map Report")
        lines.append(f"")
        lines.append(f"**Target**: `{meta['target']}`")
        lines.append(f"**Modules**: {meta['total_modules']}")
        lines.append(f"**External Dependencies**: {meta['total_external_deps']}")
        lines.append(f"")

        # Circular dependencies
        if results['circular_dependencies']:
            lines.append(f"## ⚠️ Circular Dependencies")
            lines.append(f"")
            for circle in results['circular_dependencies']:
                chain = ' → '.join(circle['cycle'])
                lines.append(f"- **[{circle['severity']}]** {chain}")
            lines.append(f"")

        # Coupling metrics (top items)
        lines.append(f"## Coupling Metrics")
        lines.append(f"")
        lines.append(f"| Module | Ca (in) | Ce (out) | Instability | Classification |")
        lines.append(f"|--------|---------|----------|-------------|----------------|")

        for m in results['coupling_metrics'][:30]:
            lines.append(f"| `{m['module']}` | {m['afferent_coupling']} | "
                         f"{m['efferent_coupling']} | {m['instability']} | {m['classification']} |")
        lines.append(f"")

        # Dependency graph (Mermaid)
        if len(results['modules']) <= 40:  # Only render for manageable sizes
            lines.append(f"## Dependency Graph")
            lines.append(f"")
            lines.append(self.generate_mermaid(results))
            lines.append(f"")

        # External dependencies
        if results['external_dependencies']:
            lines.append(f"## External Dependencies")
            lines.append(f"")
            for dep in results['external_dependencies'][:50]:
                lines.append(f"- `{dep}`")
            lines.append(f"")

        return "\n".join(lines)

    def _path_to_module_name(self, rel_path: str, language: str) -> str:
        """Convert file path to module name."""
        name = rel_path
        # Remove extension
        for ext in LANGUAGE_EXTENSIONS:
            if name.endswith(ext):
                name = name[:-len(ext)]
                break
        # Remove index files
        if name.endswith('/index') or name.endswith('/__init__'):
            name = name.rsplit('/', 1)[0] if '/' in name else name
        return name

    def _walk_files(self):
        """Walk target directory yielding source files."""
        if self.target_path.is_file():
            yield self.target_path
            return

        for root, dirs, files in os.walk(self.target_path):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                fpath = Path(root) / fname
                if fpath.suffix in LANGUAGE_EXTENSIONS:
                    yield fpath


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Project Dependency Graph Builder",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python dependency_mapper.py /path/to/project
  python dependency_mapper.py ./my-app --language python --output deps.md
  python dependency_mapper.py ./my-app --format mermaid
  python dependency_mapper.py ./my-app --format dot --output deps.dot
  python dependency_mapper.py ./my-app --format json --include-external
        """
    )
    parser.add_argument('target', help='Target directory to analyze')
    parser.add_argument('--language', '-l',
                        choices=['auto', 'python', 'javascript', 'typescript', 'go', 'rust', 'java'],
                        default='auto', help='Language filter (default: auto-detect)')
    parser.add_argument('--format', '-f', choices=['mermaid', 'json', 'dot', 'markdown'],
                        default='markdown', help='Output format (default: markdown)')
    parser.add_argument('--output', '-o', help='Output file path')
    parser.add_argument('--include-external', action='store_true',
                        help='Include external dependencies in graph')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')

    args = parser.parse_args()

    mapper = DependencyMapper(
        args.target,
        language=args.language,
        include_external=args.include_external,
        verbose=args.verbose,
    )
    results = mapper.run()

    # Generate output
    if args.format == 'json':
        output = json.dumps(results, indent=2)
    elif args.format == 'mermaid':
        output = mapper.generate_mermaid(results)
    elif args.format == 'dot':
        output = mapper.generate_dot(results)
    else:
        output = mapper.generate_markdown_report(results)

    if args.output:
        Path(args.output).write_text(output)
        print(f"\n✅ Report saved to: {args.output}")
    else:
        print(output)

    # Summary
    circles = len(results['circular_dependencies'])
    print(f"\n{'='*70}")
    print(f"  DEPENDENCY MAP COMPLETE")
    print(f"  {results['metadata']['total_modules']} modules, "
          f"{results['metadata']['total_external_deps']} external deps, "
          f"{circles} circular dep(s)")
    print(f"{'='*70}\n")

    sys.exit(1 if circles > 0 else 0)


if __name__ == '__main__':
    main()
