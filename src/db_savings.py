#!/usr/bin/env python3
"""Helper script to query token savings and tool call statistics as JSON."""
import sqlite3
import json
import sys
import os
import glob
import re
from datetime import datetime, timedelta

db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.konoha/skills.db")

def parse_iso_datetime(dt_str):
    """Parse ISO datetime as a timezone-aware local-time value."""
    if not dt_str:
        return None
    dt_str = dt_str.strip().replace("Z", "+00:00")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(dt_str, fmt)
            if dt.tzinfo is None:
                dt = dt.astimezone()
            else:
                dt = dt.astimezone()
            return dt
        except ValueError:
            continue
    return None

def calculate_all_model_tokens():
    """Scan transcript files once to calculate generated content and thought tokens and USD costs for today, 7days, and alltime."""
    brain_dirs = [
        os.path.expanduser("~/.gemini/antigravity-cli/brain"),
        os.path.expanduser("~/.gemini/antigravity-ide/brain")
    ]
    patterns = [os.path.join(bd, "*", ".system_generated", "logs", "transcript.jsonl") for bd in brain_dirs]

    now = datetime.now()
    cutoff_today = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone()
    cutoff_7days = (now - timedelta(days=7)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone()

    flash_out_rate = 0.30 / 1000000
    pro_out_rate = 5.00 / 1000000

    metrics = {
        "today": {"content_chars": 0, "thought_chars": 0, "cost": 0.0},
        "7days": {"content_chars": 0, "thought_chars": 0, "cost": 0.0},
        "all": {"content_chars": 0, "thought_chars": 0, "cost": 0.0},
    }

    all_paths = []
    for pattern in patterns:
        all_paths.extend(glob.glob(pattern, recursive=True))

    for path in all_paths:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if not line.strip() or '"source":"MODEL"' not in line:
                        continue
                    try:
                        record = json.loads(line)
                        if record.get("source") == "MODEL" and record.get("type") == "PLANNER_RESPONSE":
                            created_at_str = record.get("created_at")
                            dt = parse_iso_datetime(created_at_str)

                            content = record.get("content") or ""
                            thinking = record.get("thinking") or ""
                            content_len = len(content)
                            thinking_len = len(thinking)
                            total_turn_out_tokens = (content_len + thinking_len) / 4.0

                            is_pro = True
                            lower_content = content.lower()
                            if "genin" in lower_content or "chunin" in lower_content or "tokubetsu" in lower_content or "jonin" in lower_content:
                                is_pro = False
                            elif "anbu" in lower_content or "kage" in lower_content or "antigravity" in lower_content:
                                is_pro = True
                            else:
                                if "genin" in path.lower() or "chunin" in path.lower() or "tokubetsu" in path.lower() or "jonin" in path.lower():
                                    is_pro = False

                            rate = pro_out_rate if is_pro else flash_out_rate
                            cost = total_turn_out_tokens * rate

                            metrics["all"]["content_chars"] += content_len
                            metrics["all"]["thought_chars"] += thinking_len
                            metrics["all"]["cost"] += cost

                            if dt and dt >= cutoff_7days:
                                metrics["7days"]["content_chars"] += content_len
                                metrics["7days"]["thought_chars"] += thinking_len
                                metrics["7days"]["cost"] += cost

                            if dt and dt >= cutoff_today:
                                metrics["today"]["content_chars"] += content_len
                                metrics["today"]["thought_chars"] += thinking_len
                                metrics["today"]["cost"] += cost
                    except Exception:
                        pass
        except Exception:
            pass

    return {
        key: {
            "content_tokens": int(metrics[key]["content_chars"] / 4),
            "thought_tokens": int(metrics[key]["thought_chars"] / 4),
            "output_cost_usd": metrics[key]["cost"]
        }
        for key in ("today", "7days", "all")
    }

def query_input_savings_cost(conn, time_filter=None):
    """Calculate input cost saved in USD based on agent model tiers."""
    where_clause = ""
    if time_filter == "today":
        where_clause = "WHERE date(timestamp, 'localtime') >= date('now', 'localtime')"
    elif time_filter == "7days":
        where_clause = "WHERE date(timestamp, 'localtime') >= date('now', '-7 days', 'localtime')"
        
    query = f"""
        SELECT agent, COALESCE(SUM(tokens_saved), 0) as tokens
        FROM tool_calls
        {where_clause}
        GROUP BY agent
    """
    rows = conn.execute(query).fetchall()
    
    flash_rate = 0.075 / 1000000
    pro_rate = 1.25 / 1000000
    total_saved_usd = 0.0
    
    for row in rows:
        agent = (row[0] or "").lower()
        tokens = row[1]
        
        is_pro = True
        if "genin" in agent or "chunin" in agent or "tokubetsu" in agent or "jonin" in agent:
            is_pro = False
            
        rate = pro_rate if is_pro else flash_rate
        total_saved_usd += tokens * rate
        
    return total_saved_usd

def query_stats(conn, time_filter=None, model_tokens=None):
    """Query statistics based on a SQL time filter."""
    where_clause = ""
    if time_filter is None or time_filter == "all":
        where_clause = ""
    elif time_filter == "today":
        where_clause = "WHERE date(timestamp, 'localtime') >= date('now', 'localtime')"
    elif time_filter == "7days":
        where_clause = "WHERE date(timestamp, 'localtime') >= date('now', '-7 days', 'localtime')"

    # Get actual library baseline size
    try:
        baseline_row = conn.execute("SELECT SUM(byte_size) FROM skills").fetchone()
        library_baseline_bytes = baseline_row[0] or 550000
    except Exception:
        library_baseline_bytes = 550000

    query = f"""
        SELECT
            COUNT(*) as calls,
            COALESCE(SUM(bytes_saved), 0) as bytes,
            COALESCE(SUM(tokens_saved), 0) as tokens,
            COALESCE(SUM(bytes_saved + returned_bytes), 0) as total_tool_calls_bytes
        FROM tool_calls
        {where_clause}
    """
    row = conn.execute(query).fetchone()
    total_bytes = row[3]
    pct = round((row[1] / total_bytes * 100)) if total_bytes > 0 else 0

    saved_usd = query_input_savings_cost(conn, time_filter)
    out_stats = model_tokens if model_tokens else {"content_tokens": 0, "thought_tokens": 0, "output_cost_usd": 0.0}
    net_saved_usd = max(0.0, saved_usd - out_stats["output_cost_usd"])
    
    # Query client breakdown
    by_client = {
        "antigravity": {"calls": 0, "bytes": 0, "tokens": 0},
        "agy": {"calls": 0, "bytes": 0, "tokens": 0},
        "cursor": {"calls": 0, "bytes": 0, "tokens": 0},
        "claudecode": {"calls": 0, "bytes": 0, "tokens": 0},
        "opencode": {"calls": 0, "bytes": 0, "tokens": 0},
        "commandcode": {"calls": 0, "bytes": 0, "tokens": 0},
        "codex": {"calls": 0, "bytes": 0, "tokens": 0},
    }
    
    query_client = f"""
        SELECT 
            COALESCE(client, 'antigravity') as c_name,
            COUNT(*) as calls,
            COALESCE(SUM(bytes_saved), 0) as bytes,
            COALESCE(SUM(tokens_saved), 0) as tokens
        FROM tool_calls
        {where_clause}
        GROUP BY c_name
    """
    try:
        rows_client = conn.execute(query_client).fetchall()
        for r_c in rows_client:
            c_name = r_c[0].lower()
            if c_name not in by_client:
                c_name = "unknown"
            by_client.setdefault(c_name, {"calls": 0, "bytes": 0, "tokens": 0})
            by_client[c_name]["calls"] += r_c[1]
            by_client[c_name]["bytes"] += r_c[2]
            by_client[c_name]["tokens"] += r_c[3]
    except Exception:
        pass
        
    return {
        "calls": row[0],
        "bytes": row[1],
        "tokens": row[2],
        "pct": pct,
        "total_bytes": total_bytes,
        "db_size_bytes": library_baseline_bytes,
        "saved_usd": saved_usd,
        "content_tokens": out_stats["content_tokens"],
        "thought_tokens": out_stats["thought_tokens"],
        "output_cost_usd": out_stats["output_cost_usd"],
        "net_saved_usd": net_saved_usd,
        "by_client": by_client
    }

def sanitize_legacy_records(conn):
    """Sanitize legacy inflated baseline records and remove test records."""
    try:
        conn.execute("DELETE FROM tool_calls WHERE tool LIKE 'test_%' OR query LIKE '%test_tool%'")
        conn.execute("""
            UPDATE tool_calls
            SET total_library_bytes = returned_bytes,
                bytes_saved = 0,
                tokens_saved = 0
            WHERE tool NOT IN ('find_skill', 'list_skills')
              AND total_library_bytes >= 400000
        """)
        conn.commit()
    except Exception:
        pass

try:
    if not os.path.exists(db_path):
        print(json.dumps({"error": f"Database not found at {db_path}"}))
        sys.exit(1)
    
    conn = sqlite3.connect(db_path)

    # Ensure table exists (agent/client included in CREATE to avoid redundant ALTER)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            tool TEXT NOT NULL,
            query TEXT,
            returned_bytes INTEGER,
            total_library_bytes INTEGER,
            bytes_saved INTEGER,
            tokens_saved INTEGER,
            agent TEXT,
            client TEXT
        );
    """)

    sanitize_legacy_records(conn)

    all_model_tokens = calculate_all_model_tokens()
    stats_today = query_stats(conn, "today", all_model_tokens.get("today"))
    stats_7days = query_stats(conn, "7days", all_model_tokens.get("7days"))
    stats_all = query_stats(conn, "all", all_model_tokens.get("all"))
    
    # Query tool call breakdown by type
    def query_by_call_type(c):
        q = """
            SELECT 
                tool,
                COUNT(*) as calls,
                COALESCE(SUM(bytes_saved), 0) as bytes,
                COALESCE(SUM(bytes_saved + returned_bytes), 0) as total_bytes
            FROM tool_calls
            GROUP BY tool
            ORDER BY calls DESC
        """
        rows = c.execute(q).fetchall()
        results = []
        for r in rows:
            tool = r[0]
            calls = r[1]
            bytes_saved = r[2]
            total_bytes = r[3]
            pct = round((bytes_saved / total_bytes * 100)) if total_bytes > 0 else 0
            results.append({
                "tool": tool,
                "calls": calls,
                "bytes": bytes_saved,
                "pct": pct
            })
        return results

    by_call_type = query_by_call_type(conn)
    conn.close()
    
    print(json.dumps({
        "today": stats_today,
        "last7days": stats_7days,
        "alltime": stats_all,
        "by_call_type": by_call_type
    }))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
