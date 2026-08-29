#!/usr/bin/env python3
"""One-by-one Antigravity MCP attribution test for konoha agent status counters."""
import importlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid

SERVER = os.path.expanduser("~/.konoha/server.py")
DB = os.path.expanduser("~/.konoha/skills.db")
STATS = os.path.expanduser("~/.konoha/agent_stats.py")
BRAIN_CLI = os.path.expanduser("~/.gemini/antigravity-cli/brain")
BRAIN_IDE = os.path.expanduser("~/.gemini/antigravity-ide/brain")

REGISTERED = frozenset(
    ["genin", "kage", "chunin", "jonin", "anbu", "tokubetsu-jonin"]
)

AGENTS = [
    ("genin", "You are a Genin scout. Log: \"[🍃 Genin] active\".", "[🍃 Genin] active. Testing."),
    ("kage", "You are the Kage. Log: \"[🌀 Kage] active\".", "[🌀 Kage] active. Testing."),
    ("chunin", "You are the Chunin intel gatherer. Log: \"[📜 Chunin] active\".", "[📜 Chunin] active. Testing."),
    ("jonin", "You are the Jonin builder. Log: \"[🛡️ Jonin] active\".", "[🛡️ Jonin] active. Testing."),
    ("anbu", "You are the Anbu agent. Log: \"[👥 Anbu] active\".", "[👥 Anbu] active. Testing."),
    (
        "tokubetsu-jonin",
        "You are the Tokubetsu Jonin scribe. Log: \"[🎯 Tokubetsu-Jonin] active\".",
        "[🎯 Tokubetsu-Jonin] active. Testing.",
    ),
]


def load_stats():
    out = subprocess.check_output([sys.executable, STATS, DB], text=True)
    return json.loads(out)


def direct_today(stats):
    return sum(
        v.get("today", 0) for k, v in stats.items() if k not in REGISTERED
    )


def last_logged_agent():
    conn = sqlite3.connect(DB)
    row = conn.execute(
        "SELECT agent FROM tool_calls WHERE tool = 'find_skill' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return (row[0] or "").lower() if row else None


def mcp_find_skill_no_agent(keyword, conv_id=None):
    req_init = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "clientInfo": {"name": "antigravity"}},
    }
    req_call = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": "find_skill",
            "arguments": {"keyword": keyword, "limit": 1, "compact": True},
        },
    }
    env = os.environ.copy()
    if conv_id:
        env["ANTIGRAVITY_CONVERSATION_ID"] = conv_id
    else:
        env.pop("ANTIGRAVITY_CONVERSATION_ID", None)

    payload = json.dumps(req_init) + "\n" + json.dumps(req_call) + "\n"
    proc = subprocess.run(
        [sys.executable, SERVER],
        input=payload,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout)
    if proc.stderr:
        print(f"\n--- SERVER STDERR FOR {keyword} ---", file=sys.stderr)
        print(proc.stderr, file=sys.stderr)
        print("-----------------------------------", file=sys.stderr)


def setup_brain(brain_root, prompt_text, planner_line, mtime_offset=3600):
    conv_id = f"konoha-test-{uuid.uuid4()}"
    conv_dir = os.path.join(brain_root, conv_id)
    logs = os.path.join(conv_dir, ".system_generated", "logs")
    os.makedirs(logs, exist_ok=True)
    prompt_path = os.path.join(conv_dir, "prompt.md")
    transcript_path = os.path.join(logs, "transcript.jsonl")
    with open(prompt_path, "w", encoding="utf-8") as f:
        f.write(prompt_text)
    with open(transcript_path, "w", encoding="utf-8") as f:
        f.write(
            json.dumps({"type": "PLANNER_RESPONSE", "content": planner_line}) + "\n"
        )
    now = time.time() + mtime_offset
    os.utime(prompt_path, (now, now))
    os.utime(transcript_path, (now, now))
    return conv_dir


def main():
    results = []
    keyword_base = f"konoha-agy-test-{int(time.time())}"

    for idx, (agent, prompt, planner) in enumerate(AGENTS):
        before = load_stats().get(agent, {}).get("today", 0)
        conv = setup_brain(BRAIN_CLI, prompt, planner, mtime_offset=7200 + idx * 120)
        try:
            mcp_find_skill_no_agent("jonin-skill", conv_id=os.path.basename(conv))
            logged = last_logged_agent()
            after = load_stats().get(agent, {}).get("today", 0)
            ok = logged == agent and after == before + 1
            results.append((agent, ok, logged, before, after))
            print(
                f"[{'PASS' if ok else 'FAIL'}] {agent}: "
                f"logged={logged} today {before}->{after}"
            )
        finally:
            shutil.rmtree(conv, ignore_errors=True)

    before_direct = direct_today(load_stats())
    conv = setup_brain(
        BRAIN_IDE,
        "<USER_REQUEST>\nTest orchestrator attribution\n",
        "[🌀 Orchestrator] active. Testing orchestrator.",
        mtime_offset=7200 + len(AGENTS) * 120,
    )
    try:
        mcp_find_skill_no_agent("jonin-skill", conv_id=os.path.basename(conv))
        logged = last_logged_agent()
        after_direct = direct_today(load_stats())
        ok = logged == "orchestrator" and after_direct == before_direct + 1
        results.append(
            ("orchestrator", ok, logged, before_direct, after_direct)
        )
        print(
            f"[{'PASS' if ok else 'FAIL'}] orchestrator: "
            f"logged={logged} direct today {before_direct}->{after_direct}"
        )
    finally:
        shutil.rmtree(conv, ignore_errors=True)

    failed = [r for r in results if not r[1]]
    print(f"\nPassed {len(results) - len(failed)}/{len(results)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
