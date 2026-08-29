#!/usr/bin/env python3
"""One-by-one Cursor MCP attribution test for konoha agent status counters."""
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
PROJECTS = os.path.expanduser("~/.cursor/projects")

REGISTERED = frozenset(
    ["genin", "kage", "chunin", "jonin", "anbu", "tokubetsu-jonin"]
)

AGENTS = [
    ("genin", "[🍃 Genin] active. Calling konoha.find_skill(...)", None),
    ("kage", "[🌀 Kage] active. Calling konoha.find_skill(...)", None),
    ("chunin", "[📜 Chunin] active. Calling konoha.find_skill(...)", None),
    ("jonin", "[🛡️ Jonin] active. Calling konoha.find_skill(...)", None),
    ("anbu", "[👥 Anbu] active. Calling konoha.find_skill(...)", None),
    (
        "tokubetsu-jonin",
        "[🎯 Tokubetsu-Jonin] active. Calling konoha.find_skill(...)",
        None,
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


def mcp_find_skill_no_agent(keyword):
    req_init = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {"protocolVersion": "2024-11-05", "clientInfo": {"name": "test-client"}},
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


def cursor_transcript_line(text, task_subagent=None):
    blocks = [{"type": "text", "text": text}]
    if task_subagent:
        blocks.append(
            {
                "type": "tool_use",
                "name": "Task",
                "input": {"subagent_type": task_subagent, "prompt": "test"},
            }
        )
    return json.dumps({"role": "assistant", "message": {"content": blocks}})


def setup_cursor_session(text, mtime_offset=7200):
    project_slug = "konoha-cursor-attribution-test"
    conv_id = str(uuid.uuid4())
    conv_dir = os.path.join(
        PROJECTS, project_slug, "agent-transcripts", conv_id
    )
    os.makedirs(conv_dir, exist_ok=True)
    transcript_path = os.path.join(conv_dir, f"{conv_id}.jsonl")
    with open(transcript_path, "w", encoding="utf-8") as f:
        f.write(cursor_transcript_line(text) + "\n")
    now = time.time() + mtime_offset
    os.utime(transcript_path, (now, now))
    return conv_dir


def main():
    results = []
    keyword_base = f"konoha-cursor-test-{int(time.time())}"

    for idx, (agent, text, _task) in enumerate(AGENTS):
        before = load_stats().get(agent, {}).get("today", 0)
        conv = setup_cursor_session(text, mtime_offset=7200 + idx * 120)
        try:
            mcp_find_skill_no_agent("jonin-skill")
            logged = last_logged_agent()
            after = load_stats().get(agent, {}).get("today", 0)
            ok = logged == agent and after == before + 1
            results.append((agent, ok, logged, before, after))
            print(
                f"[{'PASS' if ok else 'FAIL'}] {agent}: "
                f"logged={logged} today {before}->{after}"
            )
        finally:
            shutil.rmtree(
                os.path.dirname(os.path.dirname(conv)), ignore_errors=True
            )

    before_direct = direct_today(load_stats())
    conv = setup_cursor_session(
        "[Konoha] orchestrator active. Calling konoha.find_skill(...)",
        mtime_offset=7200 + len(AGENTS) * 120,
    )
    try:
        mcp_find_skill_no_agent("jonin-skill")
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
        shutil.rmtree(
            os.path.dirname(os.path.dirname(conv)), ignore_errors=True
        )

    # Task-tool delegation path (orchestrator delegates, subagent would call MCP)
    before = load_stats().get("anbu", {}).get("today", 0)
    conv = setup_cursor_session(
        "[Konoha] orchestrator active. Delegating to anbu.",
        mtime_offset=7200 + (len(AGENTS) + 1) * 120,
    )
    transcript_path = os.path.join(conv, os.listdir(conv)[0])
    with open(transcript_path, "a", encoding="utf-8") as f:
        f.write(
            cursor_transcript_line("Delegating.", task_subagent="anbu") + "\n"
        )
    now = time.time() + 7200 + (len(AGENTS) + 1) * 120
    os.utime(transcript_path, (now, now))
    try:
        mcp_find_skill_no_agent("jonin-skill")
        logged = last_logged_agent()
        after = load_stats().get("anbu", {}).get("today", 0)
        ok = logged == "anbu" and after == before + 1
        results.append(("task-anbu", ok, logged, before, after))
        print(
            f"[{'PASS' if ok else 'FAIL'}] task-delegation anbu: "
            f"logged={logged} today {before}->{after}"
        )
    finally:
        shutil.rmtree(
            os.path.dirname(os.path.dirname(conv)), ignore_errors=True
        )

    failed = [r for r in results if not r[1]]
    print(f"\nPassed {len(results) - len(failed)}/{len(results)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
