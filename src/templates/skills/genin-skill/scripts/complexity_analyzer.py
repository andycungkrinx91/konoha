#!/usr/bin/env python3
"""
Complexity Analyzer — Code Complexity & Hotspot Detection

Calculates cyclomatic complexity, cognitive complexity, function length,
nesting depth, and identifies code hotspots with refactoring recommendations.

Usage:
    python complexity_analyzer.py <project_dir> [--language python|typescript|go] [--top 20] [--threshold 15]

Requires: Python 3.8+ (stdlib only)
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class FunctionMetrics:
    """Metrics for a single function/method."""
    name: str
    file_path: str
    line_start: int
    line_end: int
    language: str
    loc: int = 0                    # Lines of code
    cyclomatic: int = 1             # Cyclomatic complexity (starts at 1)
    cognitive: int = 0              # Cognitive complexity
    max_nesting: int = 0            # Maximum nesting depth
    parameter_count: int = 0        # Number of parameters
    boolean_ops: int = 0            # Boolean operator count (and/or)
    return_points: int = 0          # Number of return statements

    @property
    def risk_score(self) -> float:
        """Combined risk score (0-100)."""
        score = 0.0
        # Cyclomatic complexity contribution (40% weight)
        score += min(40, (self.cyclomatic / 25.0) * 40)
        # Cognitive complexity contribution (30% weight)
        score += min(30, (self.cognitive / 30.0) * 30)
        # LOC contribution (15% weight)
        score += min(15, (self.loc / 100.0) * 15)
        # Nesting depth contribution (15% weight)
        score += min(15, (self.max_nesting / 6.0) * 15)
        return round(min(100, score), 1)

    @property
    def risk_level(self) -> str:
        score = self.risk_score
        if score >= 70:
            return "CRITICAL"
        elif score >= 50:
            return "HIGH"
        elif score >= 30:
            return "MEDIUM"
        elif score >= 15:
            return "LOW"
        return "OK"


@dataclass
class FileMetrics:
    """Aggregate metrics for a file."""
    path: str
    language: str
    total_loc: int = 0
    comment_lines: int = 0
    blank_lines: int = 0
    function_count: int = 0
    class_count: int = 0
    avg_cyclomatic: float = 0.0
    max_cyclomatic: int = 0
    avg_cognitive: float = 0.0
    max_cognitive: int = 0
    avg_function_loc: float = 0.0
    max_function_loc: int = 0
    functions: List[FunctionMetrics] = field(default_factory=list)

    @property
    def comment_ratio(self) -> float:
        """Ratio of comments to code."""
        code = self.total_loc - self.blank_lines
        if code <= 0:
            return 0.0
        return round(self.comment_lines / code, 3)


# ---------------------------------------------------------------------------
# Language-specific parsers
# ---------------------------------------------------------------------------

SKIP_DIRS = {
    'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
    '.next', '.svelte-kit', 'dist', 'build', 'target', '.terraform',
    'vendor', '.idea', '.vscode', 'coverage', '.cache', '.tox',
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
    '.php': 'php',
    '.rb': 'ruby',
}

# Decision point patterns per language (increase cyclomatic complexity by 1)
DECISION_PATTERNS = {
    'python': [
        r'\bif\b', r'\belif\b', r'\bfor\b', r'\bwhile\b',
        r'\bexcept\b', r'\band\b', r'\bor\b', r'\bcase\b',
        r'\bassert\b',
    ],
    'javascript': [
        r'\bif\b', r'\belse\s+if\b', r'\bfor\b', r'\bwhile\b',
        r'\bdo\b', r'\bswitch\b', r'\bcase\b', r'\bcatch\b',
        r'\b\?\?', r'\?\.',  # Optional chaining, nullish coalescing
        r'&&', r'\|\|', r'\?(?!=)',  # Ternary
    ],
    'typescript': None,  # Same as javascript
    'svelte': None,      # Same as javascript
    'vue': None,         # Same as javascript
    'go': [
        r'\bif\b', r'\belse\s+if\b', r'\bfor\b', r'\bswitch\b',
        r'\bcase\b', r'\bselect\b', r'&&', r'\|\|',
    ],
    'rust': [
        r'\bif\b', r'\belse\s+if\b', r'\bfor\b', r'\bwhile\b',
        r'\bloop\b', r'\bmatch\b', r'\bOk\(', r'\bErr\(',
        r'&&', r'\|\|', r'\?',
    ],
    'java': [
        r'\bif\b', r'\belse\s+if\b', r'\bfor\b', r'\bwhile\b',
        r'\bdo\b', r'\bswitch\b', r'\bcase\b', r'\bcatch\b',
        r'&&', r'\|\|', r'\?(?!=)',
    ],
    'php': [
        r'\bif\b', r'\belseif\b', r'\bfor\b', r'\bforeach\b',
        r'\bwhile\b', r'\bdo\b', r'\bswitch\b', r'\bcase\b',
        r'\bcatch\b', r'&&', r'\|\|', r'\?(?!=)',
    ],
    'ruby': [
        r'\bif\b', r'\belsif\b', r'\bfor\b', r'\bwhile\b',
        r'\buntil\b', r'\bwhen\b', r'\brescue\b',
        r'\band\b', r'\bor\b', r'\bunless\b',
    ],
}

# Nesting increase patterns
NESTING_INCREASE = {
    'python': [r'^\s*(if|elif|else|for|while|with|try|except|finally|def|class|async\s+def|async\s+for|async\s+with)\b'],
    'javascript': [r'\{'],
    'typescript': None,
    'svelte': None,
    'vue': None,
    'go': [r'\{'],
    'rust': [r'\{'],
    'java': [r'\{'],
    'php': [r'\{'],
    'ruby': [r'\b(if|elsif|else|unless|for|while|until|do|def|class|module|begin|case|when)\b'],
}

# Function definition patterns
FUNCTION_PATTERNS = {
    'python': r'^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)',
    'javascript': r'(?:(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>)',
    'typescript': None,  # Same as javascript
    'svelte': None,
    'vue': None,
    'go': r'func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)',
    'rust': r'(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>\s*)?\(([^)]*)\)',
    'java': r'(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\(([^)]*)\)',
    'php': r'(?:public|private|protected|static|\s)*function\s+(\w+)\s*\(([^)]*)\)',
    'ruby': r'def\s+(\w+[!?]?)(?:\(([^)]*)\))?',
}

# Comment patterns
COMMENT_PATTERNS = {
    'python': (r'^\s*#', r'^\s*"""', r'^\s*\'\'\''),
    'javascript': (r'^\s*//', r'^\s*/\*'),
    'typescript': None,
    'svelte': None,
    'vue': None,
    'go': (r'^\s*//', r'^\s*/\*'),
    'rust': (r'^\s*//', r'^\s*/\*'),
    'java': (r'^\s*//', r'^\s*/\*'),
    'php': (r'^\s*//', r'^\s*#', r'^\s*/\*'),
    'ruby': (r'^\s*#', r'^\s*=begin'),
}


def _get_patterns(patterns_dict: dict, language: str):
    """Get patterns for a language, falling back to javascript for TS/Svelte/Vue."""
    result = patterns_dict.get(language)
    if result is None and language in ('typescript', 'svelte', 'vue'):
        return patterns_dict.get('javascript')
    return result


# ---------------------------------------------------------------------------
# Complexity Analyzer Engine
# ---------------------------------------------------------------------------

class ComplexityAnalyzer:
    """Analyzes code complexity and identifies hotspots."""

    def __init__(self, target_path: str, language: str = "auto",
                 top_n: int = 20, threshold: int = 15, verbose: bool = False):
        self.target_path = Path(target_path).resolve()
        self.language_filter = language
        self.top_n = top_n
        self.threshold = threshold  # Cyclomatic complexity threshold
        self.verbose = verbose
        self.file_metrics: List[FileMetrics] = []
        self.all_functions: List[FunctionMetrics] = []

    def run(self) -> Dict:
        """Execute full complexity analysis."""
        print(f"\n{'='*70}")
        print(f"  COMPLEXITY ANALYZER")
        print(f"  Target: {self.target_path}")
        print(f"  Language: {self.language_filter}")
        print(f"  Threshold: {self.threshold}")
        print(f"{'='*70}\n")

        if not self.target_path.exists():
            print(f"❌ Target path does not exist: {self.target_path}")
            sys.exit(1)

        # Analyze all files
        print("📊 Analyzing code complexity...")
        file_count = 0
        for fpath in self._walk_files():
            lang = LANGUAGE_EXTENSIONS.get(fpath.suffix, '')
            if not lang:
                continue
            if self.language_filter != 'auto' and lang != self.language_filter:
                if not (self.language_filter == 'typescript' and lang in ('javascript', 'svelte', 'vue')):
                    continue

            file_count += 1
            self._analyze_file(fpath, lang)

        print(f"   Analyzed {file_count} files, {len(self.all_functions)} functions\n")

        # Identify hotspots
        over_threshold = [f for f in self.all_functions if f.cyclomatic > self.threshold]
        if over_threshold:
            print(f"   🔥 {len(over_threshold)} function(s) exceed complexity threshold ({self.threshold})")
        else:
            print(f"   ✅ All functions within complexity threshold ({self.threshold})")
        print()

        return self._build_results()

    def _analyze_file(self, fpath: Path, language: str):
        """Analyze a single file."""
        try:
            content = fpath.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            return

        rel_path = str(fpath.relative_to(self.target_path))
        lines = content.splitlines()

        fm = FileMetrics(path=rel_path, language=language, total_loc=len(lines))

        # Count comments and blanks
        comment_pats = _get_patterns(COMMENT_PATTERNS, language)
        in_block_comment = False

        for line in lines:
            stripped = line.strip()
            if not stripped:
                fm.blank_lines += 1
                continue

            if comment_pats:
                for pat in comment_pats:
                    if re.match(pat, line):
                        fm.comment_lines += 1
                        break

        # Count classes
        class_patterns = {
            'python': r'^\s*class\s+\w+',
            'javascript': r'(?:class\s+\w+|React\.Component)',
            'go': r'type\s+\w+\s+struct',
            'rust': r'(?:pub\s+)?(?:struct|enum|trait)\s+\w+',
            'java': r'(?:public|private|abstract)\s+class\s+\w+',
        }
        class_pat = _get_patterns(class_patterns, language)
        if class_pat:
            fm.class_count = len(re.findall(class_pat, content, re.MULTILINE))

        # Extract and analyze functions
        functions = self._extract_functions(lines, language, rel_path)
        fm.functions = functions
        fm.function_count = len(functions)

        if functions:
            cyclomatics = [f.cyclomatic for f in functions]
            cognitives = [f.cognitive for f in functions]
            locs = [f.loc for f in functions]

            fm.avg_cyclomatic = round(sum(cyclomatics) / len(cyclomatics), 1)
            fm.max_cyclomatic = max(cyclomatics)
            fm.avg_cognitive = round(sum(cognitives) / len(cognitives), 1)
            fm.max_cognitive = max(cognitives)
            fm.avg_function_loc = round(sum(locs) / len(locs), 1)
            fm.max_function_loc = max(locs)

        self.file_metrics.append(fm)
        self.all_functions.extend(functions)

    def _extract_functions(self, lines: List[str], language: str,
                          file_path: str) -> List[FunctionMetrics]:
        """Extract functions and calculate their complexity."""
        func_pattern = _get_patterns(FUNCTION_PATTERNS, language)
        if not func_pattern:
            return []

        decision_pats = _get_patterns(DECISION_PATTERNS, language) or []
        functions = []

        # Find function boundaries
        func_starts = []
        for i, line in enumerate(lines):
            match = re.search(func_pattern, line)
            if match:
                # Get function name from first non-None group
                name = next((g for g in match.groups() if g is not None), 'anonymous')
                # Count parameters
                params = match.group(2) if match.lastindex >= 2 and match.group(2) else ''
                param_count = len([p for p in params.split(',') if p.strip()]) if params else 0
                func_starts.append((i, name, param_count))

        # Determine function boundaries
        for idx, (start_line, name, param_count) in enumerate(func_starts):
            if idx + 1 < len(func_starts):
                end_line = func_starts[idx + 1][0] - 1
            else:
                end_line = len(lines) - 1

            # For indentation-based languages, find actual end
            if language in ('python', 'ruby'):
                end_line = self._find_indent_block_end(lines, start_line)

            func_lines = lines[start_line:end_line + 1]
            loc = len([l for l in func_lines if l.strip()])

            # Calculate cyclomatic complexity
            cyclomatic = 1  # Base complexity
            boolean_ops = 0

            for line in func_lines:
                stripped = line.strip()
                # Skip comments
                if stripped.startswith(('#', '//', '/*', '*')):
                    continue

                for pat in decision_pats:
                    matches = re.findall(pat, stripped)
                    count = len(matches)
                    cyclomatic += count
                    if pat in (r'&&', r'\|\|', r'\band\b', r'\bor\b'):
                        boolean_ops += count

            # Calculate cognitive complexity
            cognitive = self._calculate_cognitive(func_lines, language)

            # Calculate max nesting
            max_nesting = self._calculate_max_nesting(func_lines, language)

            # Count return points
            return_count = sum(1 for l in func_lines
                              if re.search(r'\breturn\b', l.strip()))

            metrics = FunctionMetrics(
                name=name,
                file_path=file_path,
                line_start=start_line + 1,
                line_end=end_line + 1,
                language=language,
                loc=loc,
                cyclomatic=cyclomatic,
                cognitive=cognitive,
                max_nesting=max_nesting,
                parameter_count=param_count,
                boolean_ops=boolean_ops,
                return_points=return_count,
            )
            functions.append(metrics)

        return functions

    def _find_indent_block_end(self, lines: List[str], start: int) -> int:
        """Find end of indentation-based block (Python, Ruby)."""
        if start >= len(lines):
            return start

        # Get the indentation of the function definition
        base_indent = len(lines[start]) - len(lines[start].lstrip())
        end = start

        for i in range(start + 1, len(lines)):
            line = lines[i]
            if not line.strip():
                continue  # Skip blank lines
            indent = len(line) - len(line.lstrip())
            if indent <= base_indent:
                break
            end = i

        return end

    def _calculate_cognitive(self, func_lines: List[str], language: str) -> int:
        """Calculate cognitive complexity (simplified)."""
        cognitive = 0
        nesting = 0

        nesting_keywords = {
            'python': {'if', 'elif', 'else', 'for', 'while', 'with', 'try', 'except'},
            'javascript': {'if', 'else', 'for', 'while', 'do', 'switch', 'try', 'catch'},
            'go': {'if', 'for', 'switch', 'select'},
            'rust': {'if', 'for', 'while', 'loop', 'match'},
            'java': {'if', 'else', 'for', 'while', 'do', 'switch', 'try', 'catch'},
        }

        break_keywords = {'break', 'continue', 'goto'}

        keywords = nesting_keywords.get(language,
                    nesting_keywords.get('javascript', set()))

        for line in func_lines:
            stripped = line.strip()
            if not stripped or stripped.startswith(('#', '//', '/*', '*')):
                continue

            # Check for nesting keywords
            for kw in keywords:
                if re.search(rf'\b{kw}\b', stripped):
                    # Cognitive: 1 + nesting level
                    cognitive += 1 + nesting
                    if kw not in ('else', 'elif', 'except', 'catch', 'finally'):
                        nesting += 1
                    break

            # Check for break in flow
            for kw in break_keywords:
                if re.search(rf'\b{kw}\b', stripped):
                    cognitive += 1

            # Boolean operators add cognitive load
            cognitive += len(re.findall(r'&&|\|\||\band\b|\bor\b', stripped))

            # Decrease nesting on closing
            if language in ('python', 'ruby'):
                pass  # Handled by indentation
            else:
                close_count = stripped.count('}')
                nesting = max(0, nesting - close_count)

        return cognitive

    def _calculate_max_nesting(self, func_lines: List[str], language: str) -> int:
        """Calculate maximum nesting depth."""
        max_depth = 0
        current_depth = 0

        if language in ('python', 'ruby'):
            # Indentation-based
            if not func_lines:
                return 0
            base_indent = len(func_lines[0]) - len(func_lines[0].lstrip())
            for line in func_lines:
                if not line.strip():
                    continue
                indent = len(line) - len(line.lstrip())
                depth = max(0, (indent - base_indent) // 4)  # Assume 4-space indent
                max_depth = max(max_depth, depth)
        else:
            # Brace-based
            for line in func_lines:
                stripped = line.strip()
                if stripped.startswith(('#', '//', '/*', '*')):
                    continue
                current_depth += stripped.count('{')
                current_depth -= stripped.count('}')
                max_depth = max(max_depth, current_depth)

        return max_depth

    def _build_results(self) -> Dict:
        """Build structured results."""
        # Sort functions by risk score
        hotspots = sorted(self.all_functions, key=lambda f: -f.risk_score)

        over_threshold = [f for f in self.all_functions if f.cyclomatic > self.threshold]

        return {
            'metadata': {
                'target': str(self.target_path),
                'language': self.language_filter,
                'threshold': self.threshold,
                'total_files': len(self.file_metrics),
                'total_functions': len(self.all_functions),
                'over_threshold': len(over_threshold),
            },
            'summary': {
                'avg_cyclomatic': round(
                    sum(f.cyclomatic for f in self.all_functions) / max(1, len(self.all_functions)), 1
                ),
                'avg_cognitive': round(
                    sum(f.cognitive for f in self.all_functions) / max(1, len(self.all_functions)), 1
                ),
                'avg_loc': round(
                    sum(f.loc for f in self.all_functions) / max(1, len(self.all_functions)), 1
                ),
                'total_loc': sum(fm.total_loc for fm in self.file_metrics),
                'total_comment_lines': sum(fm.comment_lines for fm in self.file_metrics),
                'overall_comment_ratio': round(
                    sum(fm.comment_lines for fm in self.file_metrics) /
                    max(1, sum(fm.total_loc - fm.blank_lines for fm in self.file_metrics)), 3
                ),
            },
            'hotspots': [
                {
                    'name': f.name,
                    'file': f.file_path,
                    'line': f.line_start,
                    'risk_score': f.risk_score,
                    'risk_level': f.risk_level,
                    'cyclomatic': f.cyclomatic,
                    'cognitive': f.cognitive,
                    'loc': f.loc,
                    'max_nesting': f.max_nesting,
                    'parameters': f.parameter_count,
                    'return_points': f.return_points,
                    'recommendation': self._recommend(f),
                }
                for f in hotspots[:self.top_n]
            ],
            'file_summary': [
                {
                    'path': fm.path,
                    'language': fm.language,
                    'loc': fm.total_loc,
                    'functions': fm.function_count,
                    'classes': fm.class_count,
                    'avg_cyclomatic': fm.avg_cyclomatic,
                    'max_cyclomatic': fm.max_cyclomatic,
                    'comment_ratio': fm.comment_ratio,
                }
                for fm in sorted(self.file_metrics, key=lambda x: -x.max_cyclomatic)
            ],
        }

    def _recommend(self, func: FunctionMetrics) -> str:
        """Generate refactoring recommendation."""
        recs = []

        if func.cyclomatic > 20:
            recs.append("Break into smaller functions (extract method)")
        elif func.cyclomatic > 10:
            recs.append("Consider splitting complex decision logic")

        if func.loc > 50:
            recs.append("Function too long — extract logical sections")

        if func.max_nesting > 4:
            recs.append("Reduce nesting — use early returns or guard clauses")

        if func.parameter_count > 5:
            recs.append("Too many parameters — use a config object or builder pattern")

        if func.boolean_ops > 3:
            recs.append("Complex boolean logic — extract conditions into named variables")

        if func.return_points > 5:
            recs.append("Many return points — consider consolidating exit paths")

        if func.cognitive > 20:
            recs.append("High cognitive load — simplify control flow")

        return "; ".join(recs) if recs else "Acceptable complexity"

    def generate_markdown_report(self, results: Dict) -> str:
        """Generate markdown complexity report."""
        lines = []
        meta = results['metadata']
        summary = results['summary']

        lines.append(f"# Code Complexity Report")
        lines.append(f"")
        lines.append(f"**Target**: `{meta['target']}`")
        lines.append(f"**Files Analyzed**: {meta['total_files']}")
        lines.append(f"**Functions Analyzed**: {meta['total_functions']}")
        lines.append(f"**Complexity Threshold**: {meta['threshold']}")
        lines.append(f"**Over Threshold**: {meta['over_threshold']}")
        lines.append(f"")

        # Summary stats
        lines.append(f"## Summary")
        lines.append(f"")
        lines.append(f"| Metric | Value |")
        lines.append(f"|--------|-------|")
        lines.append(f"| Total LOC | {summary['total_loc']} |")
        lines.append(f"| Avg Cyclomatic Complexity | {summary['avg_cyclomatic']} |")
        lines.append(f"| Avg Cognitive Complexity | {summary['avg_cognitive']} |")
        lines.append(f"| Avg Function LOC | {summary['avg_loc']} |")
        lines.append(f"| Comment Ratio | {summary['overall_comment_ratio']} |")
        lines.append(f"")

        # Hotspots
        lines.append(f"## 🔥 Hotspots (Top {len(results['hotspots'])})")
        lines.append(f"")
        lines.append(f"| # | Function | File | Risk | CC | Cog | LOC | Nest | Recommendation |")
        lines.append(f"|---|----------|------|------|----|----|-----|------|----------------|")

        for i, h in enumerate(results['hotspots'], 1):
            icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "OK": "✅"}.get(h['risk_level'], "⚪")
            rec_short = h['recommendation'][:60] + "..." if len(h['recommendation']) > 60 else h['recommendation']
            lines.append(
                f"| {i} | `{h['name']}` | `{h['file']}:{h['line']}` | "
                f"{icon} {h['risk_score']} | {h['cyclomatic']} | {h['cognitive']} | "
                f"{h['loc']} | {h['max_nesting']} | {rec_short} |"
            )
        lines.append(f"")

        # File summary
        lines.append(f"## File Summary")
        lines.append(f"")
        lines.append(f"| File | LOC | Functions | Avg CC | Max CC | Comment % |")
        lines.append(f"|------|-----|-----------|--------|--------|-----------|")

        for f in results['file_summary'][:30]:
            lines.append(
                f"| `{f['path']}` | {f['loc']} | {f['functions']} | "
                f"{f['avg_cyclomatic']} | {f['max_cyclomatic']} | "
                f"{round(f['comment_ratio'] * 100, 1)}% |"
            )
        lines.append(f"")

        # Thresholds guide
        lines.append(f"## Complexity Thresholds Guide")
        lines.append(f"")
        lines.append(f"| Cyclomatic Complexity | Risk | Action |")
        lines.append(f"|----------------------|------|--------|")
        lines.append(f"| 1-10 | ✅ Low | Well-structured, easy to test |")
        lines.append(f"| 11-20 | 🟡 Moderate | Consider refactoring |")
        lines.append(f"| 21-50 | 🟠 High | Refactoring recommended |")
        lines.append(f"| 50+ | 🔴 Critical | Must refactor — untestable |")
        lines.append(f"")

        return "\n".join(lines)

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
        description="Code Complexity & Hotspot Analyzer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python complexity_analyzer.py /path/to/project
  python complexity_analyzer.py ./my-app --language python --top 20
  python complexity_analyzer.py ./my-app --threshold 10 --output report.md
  python complexity_analyzer.py ./my-app --json --output complexity.json
        """
    )
    parser.add_argument('target', help='Target directory or file to analyze')
    parser.add_argument('--language', '-l',
                        choices=['auto', 'python', 'javascript', 'typescript', 'go', 'rust', 'java'],
                        default='auto', help='Language filter (default: auto-detect)')
    parser.add_argument('--top', '-t', type=int, default=20,
                        help='Number of top hotspots to report (default: 20)')
    parser.add_argument('--threshold', type=int, default=15,
                        help='Cyclomatic complexity threshold (default: 15)')
    parser.add_argument('--output', '-o', help='Output file path')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')

    args = parser.parse_args()

    analyzer = ComplexityAnalyzer(
        args.target, language=args.language,
        top_n=args.top, threshold=args.threshold,
        verbose=args.verbose,
    )
    results = analyzer.run()

    if args.json:
        output = json.dumps(results, indent=2)
    else:
        output = analyzer.generate_markdown_report(results)

    if args.output:
        Path(args.output).write_text(output)
        print(f"\n✅ Report saved to: {args.output}")
    else:
        print(output)

    over = results['metadata']['over_threshold']
    print(f"\n{'='*70}")
    print(f"  COMPLEXITY ANALYSIS COMPLETE")
    print(f"  {results['metadata']['total_functions']} functions analyzed, "
          f"{over} over threshold")
    print(f"{'='*70}\n")

    sys.exit(1 if over > 0 else 0)


if __name__ == '__main__':
    main()
