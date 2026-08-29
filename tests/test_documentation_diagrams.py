#!/usr/bin/env python3
import re
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIAGRAM = ROOT / "docs" / "diagrams" / "konoha-architecture.drawio"
MANIFEST = ROOT / "docs" / "diagrams" / "README.md"

MERMAID_OWNERS = {
    ROOT / "README.md": (2, {"genin-skill", "sannin", "Konoha MCP", "Semble MCP", "SQLite FTS5"}),
    ROOT / "docs" / "ARCHITECTURE.md": (1, {"genin-skill", "sannin", "Konoha MCP", "Semble MCP", "SQLite FTS5"}),
    ROOT / "docs" / "LLM-BRIDGE-GATEWAY.md": (1, {"Konoha Bridge Router", "SQLite", "Antigravity Sidecar"}),
    ROOT / "docs" / "SETUP-SEARXNG.md": (1, {"SearXNG", "DuckDuckGo", "Startpage", "Wikipedia"}),
    ROOT / "docs" / "ADDING-SKILLS.md": (1, {"skills.sh", "konoha migrate", "SQLite", "find_skill", "get_skill"}),
}

HIGH_RISK_EDGES = {
    "p2-e12",
    "p3-e8",
    "p3-e9",
    "p4-e2",
    "p4-e3",
    "p8-e9",
}


class TestDocumentationDiagrams(unittest.TestCase):
    def test_drawio_pages_have_valid_cells_and_edges(self):
        root = ET.parse(DIAGRAM).getroot()
        pages = root.findall("diagram")
        self.assertEqual(len(pages), 11)
        expected = {
            "01 System Architecture",
            "02 Runtime Query Lifecycle",
            "03 MCP Tool and Skill Routing",
            "04 LLM Bridge Gateway",
            "05 Search Fallback Chain",
            "06 Skill Registry Installation",
            "07 Token Footprint Comparison",
            "08 Orchestrator Task Artifact Flow",
            "09 Jonin Taste-Skill Frontend Engine",
            "10 Persistent Project Context & Auto-Compaction",
            "11 Kage Pre-Delivery Reviewer Workflow Gate",
        }
        self.assertEqual({page.get("name") for page in pages}, expected)
        for page in pages:
            graph = page.find("mxGraphModel")
            cells = graph.find("root").findall("mxCell")
            ids = {cell.get("id") for cell in cells}
            self.assertIn("0", ids)
            self.assertIn("1", ids)
            self.assertGreater(len(cells), 3)
            for cell in cells:
                if cell.get("edge") == "1":
                    self.assertIn(cell.get("source"), ids)
                    self.assertIn(cell.get("target"), ids)
                    geometry = cell.find("mxGeometry")
                    self.assertIsNotNone(geometry)
                    style = cell.get("style", "")
                    if cell.get("id") in HIGH_RISK_EDGES:
                        self.assertTrue(
                            all(key in style for key in ("exitX=", "exitY="))
                            or geometry.find("Array") is not None,
                            cell.get("id"),
                        )

    def test_markdown_has_professional_mermaid_companions(self):
        for owner, (expected_count, required_labels) in MERMAID_OWNERS.items():
            content = owner.read_text(encoding="utf-8")
            blocks = re.findall(r"```mermaid\n(.*?)```", content, flags=re.DOTALL)
            self.assertEqual(len(blocks), expected_count, owner)
            self.assertNotIn("deep-code-explorer", content, owner)
            for label in required_labels:
                self.assertIn(label, content, owner)
            for block in blocks:
                self.assertIn("theme: base", block, owner)
                self.assertIn("fontFamily:", block, owner)
                if "flowchart" in block:
                    self.assertRegex(block, r"wrappingWidth:\s*(?:3[2-9][0-9]|[4-9][0-9]{2})", owner)
                for line in block.splitlines():
                    label_safe = re.sub(r"\|[^|\n]*\|", "", line)
                    self.assertNotIn("|", label_safe, (owner, line))

    def test_documentation_links_point_to_canonical_source(self):
        owners = {
            ROOT / "README.md": "docs/diagrams/konoha-architecture.drawio",
            ROOT / "docs" / "ARCHITECTURE.md": "diagrams/konoha-architecture.drawio",
            ROOT / "docs" / "LLM-BRIDGE-GATEWAY.md": "diagrams/konoha-architecture.drawio",
            ROOT / "docs" / "SETUP-SEARXNG.md": "diagrams/konoha-architecture.drawio",
            ROOT / "docs" / "ADDING-SKILLS.md": "diagrams/konoha-architecture.drawio",
        }
        for owner, link in owners.items():
            content = owner.read_text(encoding="utf-8")
            self.assertIn(link, content, owner)
        manifest = MANIFEST.read_text(encoding="utf-8")
        self.assertIn("canonical editable source", manifest)
        self.assertIn("synchronized Mermaid companion", manifest)

    def test_current_bridge_contract_is_documented(self):
        docs = "\n".join(
            (ROOT / rel).read_text(encoding="utf-8")
            for rel in (
                "README.md",
                "docs/LLM-BRIDGE-GATEWAY.md",
                "docs/SETUP-MCP-CLIENTS.md",
                "docs/TROUBLESHOOTING.md",
            )
        )
        self.assertIn("127.0.0.1:1313", docs)
        self.assertIn("127.0.0.1:19999", docs)
        self.assertIn("antigravity-extension", docs)
        self.assertIn("does not perform gateway-level round-robin", docs)
        self.assertIn("andycungkrinx91.konoha-bridge-master-universal", docs)
        self.assertNotIn("pinned to `v1.2.0`", docs)
        self.assertNotIn("automatically rotates to the next eligible bridge", docs)
        self.assertNotIn("WebSocket-based sidecar communication for the bridge router (port `19999`)", docs)


if __name__ == "__main__":
    unittest.main()
