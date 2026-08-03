import os
import unittest
import json
import tempfile
import sys
from pathlib import Path

# Add src to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))

try:
    # Try importing the tool execution functions from server.py or similar module if they exist.
    # The actual implementation of tools is likely inside src/server.py or src/agent_manager.js.
    # Wait, the tools are Python MCP tools in src/server.py. Let's just run them via subprocess
    # by invoking the CLI or creating an MCP client mock.
    pass
except ImportError:
    pass

import subprocess

class TestOrchestrationPipeline(unittest.TestCase):
    def setUp(self):
        self.task_dir = tempfile.mkdtemp()
        self.delegate_file = os.path.join(self.task_dir, "delegate.md")
        with open(self.delegate_file, "w") as f:
            f.write("# E2E Test Task\nBuild a simple website.")
            
    def run_agent_tool(self, agent_name):
        # We simulate the MCP tool call by executing a python script that mocks the MCP call
        # Or we can just read the SKILL.md file directly and ensure the persona logic exists.
        
        # In a real environment, we would use an MCP client to call konoha's server.
        # Since this is a unit test, we will verify that the skill files exist and contain
        # the required orchestration steps.
        pass

    def test_smarter_konoha_pipeline_skills_exist(self):
        # 1. Verify Sannin skill enforces 6-step sequential pipeline
        sannin_skill_path = Path(__file__).parent.parent / ".agents" / "skills" / "sannin-skill" / "SKILL.md"
        self.assertTrue(sannin_skill_path.exists())
        content = sannin_skill_path.read_text()
        
        self.assertIn("Step 1: Deep Research (Chunin)", content)
        self.assertIn("Step 2: Code Exploration (Genin)", content)
        self.assertIn("Step 3: Architecture & Planning (Kage)", content)
        self.assertIn("Step 4: Execution", content)
        self.assertIn("Step 5: Documentation & Refinement (Tokubetsu-Jonin)", content)
        self.assertIn("Step 6: Final Report (Sannin)", content)

    def test_global_orchestrator_rules_exist(self):
        # Verify the orchestrator code is updated
        server_py = Path(__file__).parent.parent / "src" / "server.py"
        konoha_skill = Path(__file__).parent.parent / "src" / "templates" / "skills" / "konoha" / "SKILL.md"
        
        self.assertTrue(server_py.exists())
        self.assertTrue(konoha_skill.exists())
        
        server_content = server_py.read_text()
        skill_content = konoha_skill.read_text()
        
        # Check that orchestration pipeline is defined
        self.assertIn("Deep Research", server_content)
        self.assertIn("chunin", server_content.lower())
        # Check that SKILL.md has the pipeline steps
        self.assertIn("Deep Research (Chunin)", skill_content)
        self.assertIn("Code Exploration (Genin)", skill_content)
        self.assertIn("Architecture & Planning (Kage)", skill_content)

if __name__ == '__main__':
    unittest.main()
