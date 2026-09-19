#!/usr/bin/env python3
"""
Deep Research Engine for Claude Code
Orchestrates comprehensive research across multiple sources with verification,
synthesis, quality gates, automated gap detection, parallel phase execution,
progress dashboard, and multiple export formats.

Requires: Python 3.8+ (stdlib only)
"""

import argparse
import concurrent.futures
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple, Set


class ResearchPhase(Enum):
    """Research pipeline phases"""
    SCOPE = "scope"
    PLAN = "plan"
    RETRIEVE = "retrieve"
    TRIANGULATE = "triangulate"
    SYNTHESIZE = "synthesize"
    CRITIQUE = "critique"
    REFINE = "refine"
    PACKAGE = "package"


class ResearchMode(Enum):
    """Research depth modes"""
    QUICK = "quick"  # 3 phases: scope, retrieve, package
    STANDARD = "standard"  # 6 phases: skips critique and refine
    DEEP = "deep"  # Full 8 phases
    ULTRADEEP = "ultradeep"  # 8 phases + extended sub-task depth


@dataclass
class Source:
    """Represents a research source"""
    url: str
    title: str
    snippet: str
    retrieved_at: str
    credibility_score: float = 0.0
    source_type: str = "web"  # web, academic, documentation, code, other
    verification_status: str = "unverified"  # unverified, verified, conflicted


@dataclass
class ResearchState:
    """Maintains research state across phases with persistent logging"""
    query: str
    mode: ResearchMode
    phase: ResearchPhase
    scope: Dict[str, Any] = field(default_factory=dict)
    plan: Dict[str, Any] = field(default_factory=dict)
    sources: List[Source] = field(default_factory=list)
    findings: List[Dict[str, Any]] = field(default_factory=list)
    synthesis: Dict[str, Any] = field(default_factory=dict)
    critique: Dict[str, Any] = field(default_factory=dict)
    report: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def save(self, filepath: Path):
        """Save research state to file with retry logic"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                filepath.parent.mkdir(parents=True, exist_ok=True)
                with open(filepath, 'w', encoding='utf-8') as f:
                    json.dump(self._serialize(), f, indent=2)
                return  # Success
            except (IOError, OSError) as e:
                if attempt == max_retries - 1:
                    raise IOError(f"Failed to save state after {max_retries} attempts: {e}")
                time.sleep((attempt + 1) * 0.5)

    def _serialize(self) -> dict:
        """Convert to serializable dict"""
        return {
            'query': self.query,
            'mode': self.mode.value,
            'phase': self.phase.value,
            'scope': self.scope,
            'plan': self.plan,
            'sources': [asdict(s) for s in self.sources],
            'findings': self.findings,
            'synthesis': self.synthesis,
            'critique': self.critique,
            'report': self.report,
            'metadata': self.metadata
        }

    @classmethod
    def load(cls, filepath: Path) -> 'ResearchState':
        """Load research state from file"""
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)

        return cls(
            query=data['query'],
            mode=ResearchMode(data['mode']),
            phase=ResearchPhase(data['phase']),
            scope=data['scope'],
            plan=data['plan'],
            sources=[Source(**s) for s in data['sources']],
            findings=data['findings'],
            synthesis=data['synthesis'],
            critique=data['critique'],
            report=data['report'],
            metadata=data.get('metadata', {})
        )


class ResearchEngine:
    """Orchestrates the research lifecycle, validating quality and executing phases"""

    def __init__(self, mode: ResearchMode = ResearchMode.STANDARD):
        self.mode = mode
        self.state: Optional[ResearchState] = None
        self.output_dir = Path.home() / ".claude" / "research_output"
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def initialize_research(self, query: str) -> ResearchState:
        """Initialize new research session"""
        self.state = ResearchState(
            query=query,
            mode=self.mode,
            phase=ResearchPhase.SCOPE,
            scope={
                'core_components': [],
                'stakeholder_perspectives': [],
                'in_scope': [],
                'out_of_scope': [],
                'success_criteria': [],
                'assumptions': []
            },
            plan={
                'primary_sources': [],
                'secondary_sources': [],
                'knowledge_dependencies': {},
                'search_queries': [],
                'triangulation_strategy': '',
                'quality_gates': []
            },
            sources=[],
            findings=[],
            synthesis={
                'patterns': [],
                'concept_relationships': {},
                'novel_insights': [],
                'frameworks': [],
                'key_arguments': []
            },
            critique={
                'strengths': [],
                'weaknesses': [],
                'gaps': [],
                'biases': [],
                'improvements_needed': []
            },
            report="",
            metadata={
                'started_at': datetime.now().isoformat(),
                'version': '1.1',
                'phase_history': [],
                'gaps_detected': [],
                'quality_gate_checks': {}
            }
        )
        return self.state

    def get_phase_instructions(self, phase: ResearchPhase) -> str:
        """Get instructions for current phase"""
        instructions = {
            ResearchPhase.SCOPE: """
# Phase 1: SCOPE

Your task: Define research boundaries and success criteria.

## Execute:
1. Decompose the question into 3-5 core components.
2. Identify 2-4 key stakeholder perspectives.
3. Define what's IN scope and what's OUT of scope.
4. List 3-5 success criteria for this research.
5. Document 3-5 assumptions that need validation.

## Quality Gate Checklist:
- At least 3 core components defined.
- At least 3 success criteria defined.
- Clear in_scope/out_of_scope sections populated.
""",
            ResearchPhase.PLAN: """
# Phase 2: PLAN

Your task: Create intelligent research roadmap.

## Execute:
1. Identify 5-10 primary sources to investigate.
2. List 5-10 secondary/backup sources.
3. Map knowledge dependencies (what must be understood first).
4. Create 10-15 search query variations.
5. Plan triangulation approach (how to verify claims).
6. Define 3-5 quality gates.
""",
            ResearchPhase.RETRIEVE: """
# Phase 3: RETRIEVE

Your task: Systematically collect information from multiple sources.

## Execute:
1. Run search queries in parallel.
2. Fetch details from primary sources.
3. Assess source credibility using source_evaluator.py.
4. Log all sources with title, URL, snippet, and credibility.
""",
            ResearchPhase.TRIANGULATE: """
# Phase 4: TRIANGULATE

Your task: Validate information across multiple independent sources.

## Execute:
1. List all major findings/claims.
2. Cross-check each finding against 2+ other sources.
3. Identify contradictions or conflicting viewpoints.
""",
            ResearchPhase.SYNTHESIZE: """
# Phase 5: SYNTHESIZE

Your task: Connect insights and generate novel understanding.

## Execute:
1. Identify conceptual patterns.
2. Formulate supporting argument structures.
3. Detail recommendations and action plans.
""",
            ResearchPhase.CRITIQUE: """
# Phase 6: CRITIQUE

Your task: Rigorously evaluate research quality (Red Team).

## Execute:
1. Challenge research conclusions.
2. Highlight gaps, bias risk, or undocumented assumptions.
""",
            ResearchPhase.REFINE: """
# Phase 7: REFINE

Your task: Address gaps and strengthen weak areas.

## Execute:
1. Resolve gaps detected by automatic validation.
2. Re-verify conflicting claims.
""",
            ResearchPhase.PACKAGE: """
# Phase 8: PACKAGE

Your task: Deliver professional, actionable research report.

## Execute:
1. Build final markdown report.
2. Export other formats (brief, outline, presentation).
"""
        }
        return instructions.get(phase, "No instructions available for this phase")

    def run_parallel_retrieval(self, query_tasks: List[str], retrieval_fn) -> List[Dict[str, Any]]:
        """Executes retrieval queries in parallel using ThreadPoolExecutor"""
        results = []
        print(f"[*] Starting parallel execution of {len(query_tasks)} queries...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, len(query_tasks))) as executor:
            futures = {executor.submit(retrieval_fn, q): q for q in query_tasks}
            for future in concurrent.futures.as_completed(futures):
                query = futures[future]
                try:
                    data = future.result()
                    print(f"  [✓] Query completed: '{query}'")
                    results.append({'query': query, 'data': data, 'status': 'success'})
                except Exception as e:
                    print(f"  [✗] Query failed: '{query}' ({e})", file=sys.stderr)
                    results.append({'query': query, 'data': str(e), 'status': 'failed'})
        return results

    def validate_quality_gate(self, phase: ResearchPhase) -> Tuple[bool, str]:
        """
        Validates the quality threshold requirements for moving past the specified phase.
        Returns (success, message).
        """
        if not self.state:
            return False, "Research state is uninitialized."

        checks = []

        if phase == ResearchPhase.SCOPE:
            core_count = len(self.state.scope.get('core_components', []))
            success_count = len(self.state.scope.get('success_criteria', []))
            if core_count < 3:
                checks.append(f"Requires >= 3 core components (found {core_count}).")
            if success_count < 3:
                checks.append(f"Requires >= 3 success criteria (found {success_count}).")

        elif phase == ResearchPhase.PLAN:
            queries_count = len(self.state.plan.get('search_queries', []))
            primary_count = len(self.state.plan.get('primary_sources', []))
            if queries_count < 5:
                checks.append(f"Requires >= 5 search queries in roadmap (found {queries_count}).")
            if primary_count < 3:
                checks.append(f"Requires >= 3 target primary source areas (found {primary_count}).")

        elif phase == ResearchPhase.RETRIEVE:
            source_count = len(self.state.sources)
            if source_count < 5:
                checks.append(f"Requires >= 5 retrieved sources to begin analysis (found {source_count}).")
            # Ensure at least some sources have a credibility score evaluated
            scored_sources = sum(1 for s in self.state.sources if s.credibility_score > 0.0)
            if scored_sources < 3:
                checks.append(f"Requires >= 3 sources to be evaluated for credibility (found {scored_sources}).")

        elif phase == ResearchPhase.TRIANGULATE:
            # Ensure findings list exists
            if not self.state.findings:
                checks.append("Triangulation phase requires findings/claims mapping.")
            else:
                unverified_count = sum(1 for f in self.state.findings if f.get('status') == 'unverified')
                if unverified_count > len(self.state.findings) * 0.7:
                    checks.append(f"Too high ratio of unverified findings ({unverified_count}/{len(self.state.findings)}).")

        elif phase == ResearchPhase.SYNTHESIZE:
            insights_count = len(self.state.synthesis.get('novel_insights', []))
            args_count = len(self.state.synthesis.get('key_arguments', []))
            if insights_count < 2:
                checks.append(f"Requires >= 2 novel insights/synthesis patterns (found {insights_count}).")
            if args_count < 1:
                checks.append("Requires at least 1 core argument structure.")

        elif phase == ResearchPhase.CRITIQUE:
            weak_count = len(self.state.critique.get('weaknesses', []))
            improvements_count = len(self.state.critique.get('improvements_needed', []))
            if weak_count < 1 or improvements_count < 1:
                checks.append("Red team review must identify at least 1 weakness and 1 required improvement.")

        elif phase == ResearchPhase.REFINE:
            gaps = self.detect_information_gaps()
            critical_gaps = [g for g in gaps if "[CRITICAL]" in g]
            if critical_gaps:
                checks.append(f"All critical gaps must be resolved before packaging: {critical_gaps}")

        # Update quality check metadata
        passed = len(checks) == 0
        gate_summary = "Passed" if passed else "; ".join(checks)
        self.state.metadata['quality_gate_checks'][phase.value] = {
            'passed': passed,
            'timestamp': datetime.now().isoformat(),
            'summary': gate_summary
        }

        return passed, gate_summary

    def detect_information_gaps(self) -> List[str]:
        """
        Scans state components to automatically flag differences, missing requirements,
        or unverified claims between SCOPE/PLAN and existing FINDINGS/SOURCES.
        """
        if not self.state:
            return []

        gaps = []

        # 1. Scope Components check
        core_components = self.state.scope.get('core_components', [])
        findings_text = " ".join([f.get('title', '') + " " + f.get('explanation', '') for f in self.state.findings]).lower()

        for cc in core_components:
            if cc.lower() not in findings_text:
                gaps.append(f"[CRITICAL] Core component '{cc}' from scope is not addressed in current findings.")

        # 2. Knowledge Dependency check
        plan_dependencies = self.state.plan.get('knowledge_dependencies', {})
        for concept, prereqs in plan_dependencies.items():
            concept_addressed = concept.lower() in findings_text
            for prereq in prereqs:
                prereq_found = any(prereq.lower() in (s.title + " " + s.snippet).lower() for s in self.state.sources)
                if concept_addressed and not prereq_found:
                    gaps.append(f"[WARNING] Concept '{concept}' was synthesized, but prerequisite source material on '{prereq}' is missing.")

        # 3. Source Verification check
        for finding in self.state.findings:
            title = finding.get('title', '')
            status = finding.get('status', 'unverified')
            sources_list = finding.get('sources', [])
            if status == 'unverified':
                gaps.append(f"[WARNING] Claim '{title}' is marked as unverified (requires triangulation validation).")
            elif len(sources_list) < 2:
                gaps.append(f"[WARNING] Triangulated claim '{title}' is supported by less than 2 distinct sources.")

        # 4. Success Criteria check
        success_criteria = self.state.scope.get('success_criteria', [])
        for sc in success_criteria:
            # Look for keywords matching success criteria in final findings/report
            sc_words = set(re.findall(r'\w+', sc.lower()))
            # simple keyword overlap heuristic
            overlap = any(word in findings_text for word in sc_words if len(word) > 4)
            if not overlap and len(sc_words) > 2:
                gaps.append(f"[WARNING] Success criteria '{sc}' might not be met based on keyword gap analysis.")

        self.state.metadata['gaps_detected'] = gaps
        return gaps

    def display_progress_dashboard(self):
        """Prints a rich CLI dashboard tracking research progress"""
        if not self.state:
            print("[x] Research State uninitialized.", file=sys.stderr)
            return

        phases = self._get_phases_for_mode()
        current_idx = phases.index(self.state.phase) if self.state.phase in phases else 0
        progress_pct = int(((current_idx) / len(phases)) * 100)

        print("\n" + "=" * 50)
        print(f"         RESEARCH PROGRESS DASHBOARD - {progress_pct}%")
        print("=" * 50)
        print(f"Query:    {self.state.query}")
        print(f"Mode:     {self.state.mode.value.upper()}")
        print(f"Location: {self.state.metadata.get('started_at', 'unknown date')}")
        print("-" * 50)

        # Draw Phase Tracker
        print("Phase Status:")
        for idx, p in enumerate(phases):
            status = " "
            if p == self.state.phase:
                status = ">"
            elif idx < current_idx:
                status = "✓"
            gate = self.state.metadata['quality_gate_checks'].get(p.value, {})
            gate_status = "[Pass]" if gate.get('passed') else "[Pending]" if p == self.state.phase else "[Skipped]" if idx > current_idx else "[N/A]"
            print(f"  {status} {idx+1}. {p.value.upper():<12} {gate_status}")

        print("-" * 50)
        # Source Metrics
        sources_by_type = defaultdict(int)
        for s in self.state.sources:
            sources_by_type[s.source_type] += 1

        avg_credibility = 0.0
        if self.state.sources:
            avg_credibility = sum(s.credibility_score for s in self.state.sources) / len(self.state.sources)

        print("Source Metrics:")
        print(f"  Total Sources:    {len(self.state.sources)}")
        print(f"  Avg Credibility:  {avg_credibility:.1f}/100")
        for stype, count in sources_by_type.items():
            print(f"    - {stype:<12}: {count}")

        # Gap Summary
        gaps = self.detect_information_gaps()
        print("-" * 50)
        print(f"Detected Information Gaps: {len(gaps)}")
        for gap in gaps[:5]:  # print first 5
            print(f"  {gap}")
        if len(gaps) > 5:
            print(f"  ... and {len(gaps) - 5} more gaps.")
        print("=" * 50 + "\n")

    def export_pdf_outline(self, filepath: Path) -> str:
        """Generates outline styled for PDF generation engines"""
        if not self.state:
            return ""

        content = []
        content.append(f"# DOCUMENT STRUCTURE OUTLINE")
        content.append(f"**Research Topic:** {self.state.query}")
        content.append(f"**Compiled:** {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        content.append("\n---\n")

        content.append("## 1. Executive Context")
        content.append("  - Core research objectives")
        for comp in self.state.scope.get('core_components', []):
            content.append(f"  - Target focus: {comp}")

        content.append("\n## 2. Key Findings & Arguments")
        for idx, finding in enumerate(self.state.findings):
            title = finding.get('title', 'Untitled Claim')
            content.append(f"  ### 2.{idx+1} {title}")
            content.append(f"    - Confidence rating: {finding.get('confidence', 'medium')}")
            content.append(f"    - Associated evidence and data points")

        content.append("\n## 3. Critical Synthesis")
        for insight in self.state.synthesis.get('novel_insights', []):
            content.append(f"  - Concept insight: {insight}")

        content.append("\n## 4. Source Citation Register")
        for idx, s in enumerate(self.state.sources):
            content.append(f"  - [{idx+1}] {s.title} ({s.url}) - Trust level: {s.credibility_score}/100")

        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text("\n".join(content), encoding='utf-8')
        return str(filepath)

    def export_presentation_outline(self, filepath: Path) -> str:
        """Generates standard outline structures for slide decks (PPTX/Keynote)"""
        if not self.state:
            return ""

        content = []
        content.append(f"# PRESENTATION SLIDE OUTLINE")
        content.append(f"**Topic:** {self.state.query}")
        content.append("\n" + "=" * 40 + "\n")

        # Slide 1: Title
        content.append("## Slide 1: Title & Overview")
        content.append(f"- Title: Insights on {self.state.query}")
        content.append(f"- Subtitle: Strategic Research Summary")
        content.append(f"- Date: {datetime.now().strftime('%B %Y')}")
        content.append("\n" + "-" * 40 + "\n")

        # Slide 2: Agenda / Objectives
        content.append("## Slide 2: Scope & Questions")
        content.append("- Problem Definition")
        for comp in self.state.scope.get('core_components', []):
            content.append(f"- Analytical component: {comp}")
        content.append("\n" + "-" * 40 + "\n")

        # Slides 3+: Findings
        for idx, finding in enumerate(self.state.findings):
            title = finding.get('title', 'Untitled Claim')
            explanation = finding.get('explanation', '')
            content.append(f"## Slide {idx+3}: {title}")
            content.append(f"- Core finding details: {explanation[:120]}...")
            content.append("- Supporting citations and evidence")
            content.append("\n" + "-" * 40 + "\n")

        # Slide Conclusion: Insights & Recs
        next_slide_num = len(self.state.findings) + 3
        content.append(f"## Slide {next_slide_num}: Key Takeaways")
        for insight in self.state.synthesis.get('novel_insights', [])[:3]:
            content.append(f"- Insight: {insight}")
        content.append("\n" + "-" * 40 + "\n")

        content.append(f"## Slide {next_slide_num + 1}: Recommendations")
        content.append("- Recommended strategy and roadmap")
        content.append("- Suggested next action steps")

        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text("\n".join(content), encoding='utf-8')
        return str(filepath)

    def export_executive_brief(self, filepath: Path) -> str:
        """Generates a compressed Executive Brief template from state data"""
        if not self.state:
            return ""

        content = []
        content.append(f"# EXECUTIVE BRIEF: {self.state.query.upper()}")
        content.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d')} | **Status:** FINAL BRIEFING")
        content.append("\n---\n")

        content.append("## 1. Executive Summary")
        content.append("Provide a brief 3-sentence summary of the research background here.")
        if self.state.synthesis.get('novel_insights'):
            content.append(f"- **Primary Takeaway:** {self.state.synthesis['novel_insights'][0]}")

        content.append("\n## 2. Strategic Context & Boundaries")
        content.append(f"- **In Scope:** {', '.join(self.state.scope.get('in_scope', []))}")
        content.append(f"- **Assumptions:** {', '.join(self.state.scope.get('assumptions', []))}")

        content.append("\n## 3. High-Confidence Core Findings")
        for finding in self.state.findings[:3]:
            title = finding.get('title', '')
            explanation = finding.get('explanation', '')
            content.append(f"- **{title}**: {explanation}")

        content.append("\n## 4. Key Recommendations")
        content.append("- [Action 1] Immediate operational task.")
        content.append("- [Action 2] Long-term strategic consideration.")

        filepath.parent.mkdir(parents=True, exist_ok=True)
        filepath.write_text("\n".join(content), encoding='utf-8')
        return str(filepath)

    def execute_phase(self, phase: ResearchPhase) -> Dict[str, Any]:
        """Execute a research phase and log status"""
        print(f"\n{'='*80}")
        print(f"PHASE {phase.value.upper()}: Starting...")
        print(f"{'='*80}\n")

        instructions = self.get_phase_instructions(phase)
        print(instructions)

        self.state.phase = phase
        self.state.metadata['phase_history'].append({
            'phase': phase.value,
            'entered_at': datetime.now().isoformat()
        })

        result = {
            'phase': phase.value,
            'status': 'instructions_displayed',
            'timestamp': datetime.now().isoformat()
        }
        return result

    def run_pipeline(self, query: str) -> str:
        """Run complete research pipeline"""
        print(f"\n{'#'*80}")
        print(f"# DEEP RESEARCH ENGINE")
        print(f"# Query: {query}")
        print(f"# Mode: {self.mode.value}")
        print(f"{'#'*80}\n")

        self.initialize_research(query)
        phases = self._get_phases_for_mode()

        for phase in phases:
            self.state.phase = phase
            self.execute_phase(phase)

            # Auto-save state
            state_file = self.output_dir / f"research_state_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            self.state.save(state_file)
            print(f"\n✓ Phase {phase.value} complete. State saved to: {state_file}\n")

        report_file = self.output_dir / f"research_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        report_file.parent.mkdir(parents=True, exist_ok=True)
        report_file.write_text(f"# Research Report: {query}\n\nGenerated report placeholder.", encoding='utf-8')

        print(f"\n{'='*80}")
        print(f"RESEARCH PIPELINE COMPLETE")
        print(f"Report will be saved to: {report_file}")
        print(f"{'='*80}\n")

        return str(report_file)

    def _get_phases_for_mode(self) -> List[ResearchPhase]:
        """Get phases based on research mode"""
        if self.mode == ResearchMode.QUICK:
            return [ResearchPhase.SCOPE, ResearchPhase.RETRIEVE, ResearchPhase.PACKAGE]
        elif self.mode == ResearchMode.STANDARD:
            return [
                ResearchPhase.SCOPE, ResearchPhase.PLAN, ResearchPhase.RETRIEVE,
                ResearchPhase.TRIANGULATE, ResearchPhase.SYNTHESIZE, ResearchPhase.PACKAGE
            ]
        return list(ResearchPhase)


def main():
    """CLI entry point for research engine"""
    parser = argparse.ArgumentParser(
        description="Deep Research Engine for Claude Code"
    )

    parser.add_argument(
        '--query', '-q',
        type=str,
        help='Research question or topic'
    )

    parser.add_argument(
        '--mode', '-m',
        type=str,
        choices=['quick', 'standard', 'deep', 'ultradeep'],
        default='standard',
        help='Research depth mode (default: standard)'
    )

    parser.add_argument(
        '--resume', '-r',
        type=str,
        help='Resume from saved state JSON file'
    )

    parser.add_argument(
        '--dashboard', '-d',
        action='store_true',
        help='Display current progress dashboard'
    )

    parser.add_argument(
        '--export', '-e',
        type=str,
        choices=['pdf', 'slide', 'brief'],
        help='Export current state to a specific formatted template outline'
    )

    parser.add_argument(
        '--out-file',
        type=str,
        help='File path to write export content to'
    )

    parser.add_argument(
        '--update-scope',
        type=str,
        help='Path to a JSON file containing scope updates to merge'
    )

    parser.add_argument(
        '--update-plan',
        type=str,
        help='Path to a JSON file containing plan updates to merge'
    )

    parser.add_argument(
        '--add-source',
        type=str,
        help='Path to a JSON file containing a source to append'
    )

    args = parser.parse_args()

    engine = ResearchEngine(mode=ResearchMode(args.mode))

    # Determine state file
    state_path = None
    if args.resume:
        state_path = Path(args.resume)
        if not state_path.exists():
            print(f"Error: State file not found: {state_path}", file=sys.stderr)
            sys.exit(1)
        engine.state = ResearchState.load(state_path)
        print(f"[*] Resumed research state from: {state_path}")
    elif args.query:
        engine.initialize_research(args.query)
        # default state path if they start a query
        state_path = engine.output_dir / "latest_research_state.json"
        engine.state.save(state_path)
        print(f"[*] Initialized new research on: '{args.query}' (Saved to {state_path})")
    else:
        # Check if there is a default state file to auto-resume
        default_state = engine.output_dir / "latest_research_state.json"
        if default_state.exists():
            engine.state = ResearchState.load(default_state)
            state_path = default_state
            print(f"[*] Auto-resumed latest research state from: {default_state}")
        else:
            print("Error: Either --query, --resume, or an existing state file is required.", file=sys.stderr)
            parser.print_help()
            sys.exit(1)

    # Apply updates
    modified = False

    if args.update_scope:
        scope_update_path = Path(args.update_scope)
        if scope_update_path.exists():
            with open(scope_update_path, 'r', encoding='utf-8') as f:
                scope_data = json.load(f)
            engine.state.scope.update(scope_data)
            print(f"[✓] Merged scope updates from: {scope_update_path}")
            modified = True

    if args.update_plan:
        plan_update_path = Path(args.update_plan)
        if plan_update_path.exists():
            with open(plan_update_path, 'r', encoding='utf-8') as f:
                plan_data = json.load(f)
            engine.state.plan.update(plan_data)
            print(f"[✓] Merged plan updates from: {plan_update_path}")
            modified = True

    if args.add_source:
        source_add_path = Path(args.add_source)
        if source_add_path.exists():
            with open(source_add_path, 'r', encoding='utf-8') as f:
                source_data = json.load(f)
            if isinstance(source_data, dict):
                engine.state.sources.append(Source(**source_data))
                print(f"[✓] Added 1 source: {source_data.get('url')}")
                modified = True
            elif isinstance(source_data, list):
                for sd in source_data:
                    engine.state.sources.append(Source(**sd))
                print(f"[✓] Added {len(source_data)} sources in batch.")
                modified = True

    if modified and state_path:
        engine.state.save(state_path)
        print(f"[*] Saved updated state back to: {state_path}")

    # Operations
    if args.dashboard:
        engine.display_progress_dashboard()

    if args.export:
        out_filepath = Path(args.out_file) if args.out_file else (engine.output_dir / f"exported_outline_{args.export}.md")
        if args.export == 'pdf':
            exported_path = engine.export_pdf_outline(out_filepath)
        elif args.export == 'slide':
            exported_path = engine.export_presentation_outline(out_filepath)
        elif args.export == 'brief':
            exported_path = engine.export_executive_brief(out_filepath)

        print(f"[✓] Exported outline file to: {exported_path}")

    # If they just ran a query without flags, run the full pipeline
    if args.query and not (args.dashboard or args.export or args.update_scope or args.update_plan or args.add_source):
        engine.run_pipeline(args.query)


if __name__ == '__main__':
    main()
