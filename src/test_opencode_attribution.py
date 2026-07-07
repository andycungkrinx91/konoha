#!/usr/bin/env python3
"""Deep test verifying OpenCode subagent deployment and configuration health."""
import os
import json
import shutil
import sys

HOME = os.path.expanduser("~")
OPENCODE_GLOBAL = os.path.join(HOME, ".config", "opencode", "opencode.json")
OPENCODE_AGENTS_DIR = os.path.join(HOME, ".config", "opencode", "agents")

def test_opencode_subagents_exist():
    print("Testing OpenCode subagent files deployment...")
    if not os.path.isdir(OPENCODE_AGENTS_DIR):
        print(f"[FAIL] OpenCode agents directory not found: {OPENCODE_AGENTS_DIR}")
        return False
        
    expected_agents = ["genin", "kage", "chunin", "jonin", "anbu", "tokubetsu-jonin"]
    missing = []
    for name in expected_agents:
        p = os.path.join(OPENCODE_AGENTS_DIR, f"{name}.md")
        if not os.path.isfile(p):
            missing.append(name)
            
    if missing:
        print(f"[FAIL] Missing subagent markdown files: {missing}")
        return False
        
    print(f"[PASS] All {len(expected_agents)} subagents deployed in ~/.config/opencode/agents/")
    return True

def test_opencode_json_content():
    print("Testing OpenCode opencode.json configuration...")
    if not os.path.isfile(OPENCODE_GLOBAL):
        print(f"[FAIL] opencode.json not found: {OPENCODE_GLOBAL}")
        return False
        
    try:
        with open(OPENCODE_GLOBAL, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        print(f"[FAIL] Failed to parse opencode.json: {str(e)}")
        return False
        
    # Check that mcp block exists and contains konoha & semble
    mcp_block = config.get("mcp", {})
    if "konoha" not in mcp_block or "semble" not in mcp_block:
        print(f"[FAIL] MCP block in opencode.json does not register konoha and/or semble: {mcp_block}")
        return False
        
    print("[PASS] opencode.json correctly registers konoha and semble MCP servers")
    return True

def main():
    success = True
    success = success and test_opencode_subagents_exist()
    success = success and test_opencode_json_content()
    
    if success:
        print("\nAll OpenCode integration tests PASSED!")
        sys.exit(0)
    else:
        print("\nSome OpenCode integration tests FAILED.")
        sys.exit(1)

if __name__ == "__main__":
    main()
