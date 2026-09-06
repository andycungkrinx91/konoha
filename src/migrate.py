#!/usr/bin/env python3
"""
Skills Migration Script (v1.1.0 — Enhanced Token Optimization)
Migrates skill content from ~/.agents/skills/ into SQLite FTS5 database.

Each SKILL.md is stored as type='skill'.
Each references/*.md is stored as type='reference' with parent skill tagged.
Scripts are NOT stored — they remain on disk. Script metadata (paths, commands)
is captured from SKILL.md content.

Idempotent: safe to re-run (uses INSERT OR REPLACE).

v1.1.0 changes:
- Enhanced optimize_content() with deeper transformations
- Strip redundant markdown formatting on headings
- Compress bullet lists and normalize code blocks
- Hash-based content dedup reporting
"""

import sqlite3
import os
import glob
import re
import sys
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DB_PATH = db.DB_PATH
SKILLS_DIR = os.path.expanduser("~/.agents/skills/")

# Official Konoha skills (built-in, shipped with the package)
CUSTOM_SKILLS = [
    "anbu-skill",
    "chunin-skill",
    "genin-skill",
    "jonin-skill",
    "kage-skill",
    "konoha",
    "tokubetsu-jonin-skill",
]


def parse_yaml(yaml_content):
    agents = []
    current_agent = None
    current_key = None
    multiline_val = None
    multiline_indent = None
    list_key = None
    list_val = []

    lines = yaml_content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        
        if not stripped or stripped.startswith("#"):
            if current_key and multiline_val is not None:
                if not stripped:
                    multiline_val.append("")
                else:
                    indent = len(line) - len(line.lstrip(' '))
                    if indent >= multiline_indent:
                        multiline_val.append(line[multiline_indent:])
                    else:
                        current_agent[current_key] = "\n".join(multiline_val)
                        current_key = None
                        multiline_val = None
                        multiline_indent = None
                        continue
            i += 1
            continue

        indent = len(line) - len(line.lstrip(' '))

        if current_key and multiline_val is not None:
            if indent >= multiline_indent:
                multiline_val.append(line[multiline_indent:])
                i += 1
                continue
            else:
                current_agent[current_key] = "\n".join(multiline_val)
                current_key = None
                multiline_val = None
                multiline_indent = None
                continue

        if list_key and stripped.startswith("- "):
            val = stripped[2:].strip()
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            list_val.append(val)
            i += 1
            continue
        elif list_key:
            current_agent[list_key] = list_val
            list_key = None
            list_val = []
            continue

        if stripped.startswith("-"):
            if current_agent is not None:
                agents.append(current_agent)
            current_agent = {}
            
            rest = stripped[1:].strip()
            if not rest:
                i += 1
                continue
            else:
                stripped = rest

        if ":" in stripped:
            parts = stripped.split(":", 1)
            key = parts[0].strip()
            val = parts[1].strip()

            if val == "|":
                current_key = key
                multiline_val = []
                next_line_idx = i + 1
                while next_line_idx < len(lines) and not lines[next_line_idx].strip():
                    next_line_idx += 1
                if next_line_idx < len(lines):
                    multiline_indent = len(lines[next_line_idx]) - len(lines[next_line_idx].lstrip(' '))
                else:
                    multiline_indent = indent + 4
            elif not val:
                list_key = key
                list_val = []
            else:
                if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                    val = val[1:-1]
                elif val.startswith("[") and val.endswith("]"):
                    inner = val[1:-1].strip()
                    if not inner:
                        val = []
                    else:
                        val = [item.strip().strip('"').strip("'") for item in inner.split(",")]
                elif val.lower() == "true":
                    val = True
                elif val.lower() == "false":
                    val = False
                elif val.lower() in ("null", "none"):
                    val = None
                elif val.isdigit():
                    val = int(val)
                current_agent[key] = val
        
        i += 1

    if current_key and multiline_val is not None:
        current_agent[current_key] = "\n".join(multiline_val)
    if list_key:
        current_agent[list_key] = list_val
    if current_agent is not None:
        agents.append(current_agent)

    return agents


def seed_agents(conn):
    """Seed the agents table from src/templates/agents.yaml using custom YAML parser."""
    import json
    template_path = os.path.join(os.path.dirname(__file__), "templates", "agents.yaml")
    if not os.path.exists(template_path):
        template_path = os.path.abspath(os.path.join(os.getcwd(), "src", "templates", "agents.yaml"))
    if not os.path.exists(template_path):
        template_path = os.path.expanduser("~/.agents/agents.yaml")

    if not os.path.exists(template_path):
        print(f"  ✗ Agent template not found: {template_path}")
        return
        
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            content = f.read()
        agents = parse_yaml(content)
        
        cursor = conn.cursor()
        for a in agents:
            name = a.get("name")
            if not name:
                continue
            if not name.startswith("mcp_"):
                name = f"mcp_{name}"
            skills_str = json.dumps(a.get("skills", []))
            cursor.execute("""
                INSERT OR REPLACE INTO agents (
                    name, icon, title, purpose, skills, delegate_when,
                    constraints_text, workflow, description, instructions, delegation_keywords, enable_mcp_tools
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                name,
                a.get("icon"),
                a.get("title"),
                a.get("purpose"),
                skills_str,
                a.get("delegateWhen") or a.get("delegate_when"),
                a.get("constraints") or a.get("constraints_text"),
                a.get("workflow"),
                a.get("description"),
                a.get("instructions"),
                a.get("delegationKeywords") or a.get("delegation_keywords"),
                1 if a.get("enable_mcp_tools", True) else 0,
            ))
        conn.commit()
        print(f"  ✓ Seeded {len(agents)} agents from template.")
    except Exception as e:
        print(f"  ✗ Failed to seed agents: {str(e)}")


def setup_db(db_path=None):
    """Create the database schema."""
    target_path = db_path if db_path is not None else DB_PATH
    conn = db.get_connection(target_path)
    db.setup_schema(conn)
    return conn


def extract_tags_from_frontmatter(content):
    """Extract tags from YAML frontmatter description field."""
    match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return ""

    frontmatter = match.group(1)

    # Extract description field
    desc_match = re.search(r'description:\s*["\']?(.*?)["\']?\s*$', frontmatter, re.MULTILINE)
    if not desc_match:
        return ""

    description = desc_match.group(1)

    # Extract meaningful keywords from description
    # Remove common stop words and keep domain-specific terms
    stop_words = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
        'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
        'it', 'its', 'use', 'used', 'using', 'when', 'what', 'how', 'which',
        'who', 'where', 'why', 'not', 'no', 'all', 'any', 'each', 'every',
        'such', 'than', 'too', 'very', 'just', 'only', 'also', 'into',
        'across', 'about', 'up', 'out', 'if', 'then', 'so', 'as',
    }

    words = re.findall(r'[a-zA-Z0-9_-]+', description.lower())
    keywords = [w for w in words if w not in stop_words and len(w) > 2]

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)

    return ",".join(unique[:30])  # Cap at 30 tags


def extract_tags_from_filename(filepath, skill_name):
    """Extract tags from reference filename."""
    basename = os.path.splitext(os.path.basename(filepath))[0]
    # Convert kebab-case to keywords
    parts = basename.split("-")
    return ",".join([skill_name] + parts)


def shield_prompt_injection(content):
    """
    Neutralizes role-mimicking structural headings and instructions trying to spoof
    system configurations, subagent instructions, or user rules.
    """
    if not content:
        return ""
        
    rules = [
        (r'(?i)#+\s*Global\s+Agent\s+Instructions', '# [NEUTRALIZED] Global Agent Instructions'),
        (r'(?i)#+\s*User\s+Rules', '# [NEUTRALIZED] User Rules'),
        (r'(?i)#+\s*Session\s+Startup\s*—\s*Auto-Initialize\s+Team', '# [NEUTRALIZED] Session Startup'),
        (r'(?i)#+\s*Subagent\s+Definitions', '# [NEUTRALIZED] Subagent Definitions'),
        (r'(?i)#+\s*Auto-Delegation', '# [NEUTRALIZED] Auto-Delegation'),
        (r'(?i)#+\s*Tools\s+&\s+Guardrails', '# [NEUTRALIZED] Tools & Guardrails'),
        (r'(?i)#+\s*@(orchestrator|genin|kage|chunin|jonin|anbu|tokubetsu-jonin)\b', '# [NEUTRALIZED] Subagent Spoof'),
        (r'(?i)At\s+the\s+START\s+of\s+every\s+session,\s+define\s+the\s+following', '[NEUTRALIZED ACTION] Define subagents'),
        (r'(?i)The\s+orchestrator\s+MUST\s+follow\s+this\s+workflow', '[NEUTRALIZED ACTION] Orchestrator workflow'),
        (r'(?i)Every\s+response\s+MUST\s+start\s+with\s+a\s+log\s+line', '[NEUTRALIZED RULE] Start response log'),
    ]
    
    sanitized = content
    for pattern, replacement in rules:
        sanitized = re.sub(pattern, replacement, sanitized)
        
    return sanitized


def optimize_content(content):
    """
    Enhanced markdown content optimization to reduce token usage (v1.1.0).
    Aggressive optimizations disabled to preserve skill quality and formatting.
    """
    if not content:
        return ""
    
    # 1. Strip trailing whitespace per line
    content = re.sub(r'[ \t]+$', '', content, flags=re.MULTILINE)
    
    # 2. Collapse 3+ consecutive blank lines -> 1 blank line
    content = re.sub(r'\n([ \t]*\n){2,}', '\n\n', content)
    
    # 3. Shield against prompt injections
    content = shield_prompt_injection(content)
    
    # 12. Strip leading/trailing whitespace from entire content
    return content.strip()


def content_md5(content):
    """Generate MD5 hash for content dedup reporting."""
    return hashlib.md5(content.encode('utf-8')).hexdigest()[:12]


def migrate_skill(conn, skill_name):
    """Migrate a single skill and its references."""
    # Check if skill_name is a flat file
    if skill_name.endswith(".md"):
        skill_name_clean = os.path.splitext(skill_name)[0]
        file_path = os.path.join(SKILLS_DIR, skill_name)
        if not os.path.isfile(file_path):
            print(f"  ✗ File not found: {file_path}")
            return 0

        # Clean existing entries for this skill to prevent stale references
        try:
            conn.execute("DELETE FROM skill_chunks WHERE skill_name = ? OR skill_name IN (SELECT name FROM skills WHERE skill_name = ?)", (skill_name_clean, skill_name_clean))
        except Exception:
            pass
        conn.execute("DELETE FROM skills WHERE skill_name = ?", (skill_name_clean,))

        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()
        tags = extract_tags_from_frontmatter(raw_content)
        content = optimize_content(raw_content)
        byte_size = len(content.encode("utf-8"))
        raw_size = len(raw_content.encode("utf-8"))
        line_count = content.count("\n") + 1
        pct = ((raw_size - byte_size) / raw_size * 100) if raw_size > 0 else 0

        conn.execute("DELETE FROM skills WHERE name = ?", (skill_name_clean,))
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (skill_name_clean, skill_name_clean, "skill", tags, content, file_path, byte_size, line_count)
        )
        print(f"  ✓ {skill_name} ({raw_size:,} → {byte_size:,} bytes, optimized {pct:.1f}%)")
        return 1

    skill_dir = os.path.join(SKILLS_DIR, skill_name)

    if not os.path.isdir(skill_dir):
        print(f"  ✗ Directory not found: {skill_dir}")
        return 0

    # Clean existing entries for this skill to prevent stale references
    try:
        conn.execute("DELETE FROM skill_chunks WHERE skill_name = ? OR skill_name IN (SELECT name FROM skills WHERE skill_name = ?)", (skill_name, skill_name))
    except Exception:
        pass
    conn.execute("DELETE FROM skills WHERE skill_name = ?", (skill_name,))

    count = 0

    # 1. Migrate SKILL.md
    skill_md = os.path.join(skill_dir, "SKILL.md")
    if os.path.isfile(skill_md):
        with open(skill_md, "r", encoding="utf-8") as f:
            raw_content = f.read()
        tags = extract_tags_from_frontmatter(raw_content)
        content = optimize_content(raw_content)
        byte_size = len(content.encode("utf-8"))
        raw_size = len(raw_content.encode("utf-8"))
        line_count = content.count("\n") + 1
        pct = ((raw_size - byte_size) / raw_size * 100) if raw_size > 0 else 0

        # For INSERT OR REPLACE with FTS sync triggers,
        # we need to delete first then insert
        conn.execute("DELETE FROM skills WHERE name = ?", (skill_name,))
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (skill_name, skill_name, "skill", tags, content, skill_md, byte_size, line_count)
        )
        print(f"  ✓ SKILL.md ({raw_size:,} → {byte_size:,} bytes, optimized {pct:.1f}%)")
        count += 1

    # 2. Migrate references/*.md
    refs_dir = os.path.join(skill_dir, "references")
    if os.path.isdir(refs_dir):
        for ref_path in sorted(glob.glob(os.path.join(refs_dir, "*.md"))):
            ref_name_raw = os.path.splitext(os.path.basename(ref_path))[0]
            ref_key = f"{skill_name}/{ref_name_raw}"

            with open(ref_path, "r", encoding="utf-8") as f:
                raw_content = f.read()
            tags = extract_tags_from_filename(ref_path, skill_name)
            content = optimize_content(raw_content)
            byte_size = len(content.encode("utf-8"))
            raw_size = len(raw_content.encode("utf-8"))
            line_count = content.count("\n") + 1
            pct = ((raw_size - byte_size) / raw_size * 100) if raw_size > 0 else 0

            conn.execute("DELETE FROM skill_chunks WHERE skill_name = ?", (ref_key,))
            conn.execute("DELETE FROM skills WHERE name = ?", (ref_key,))
            conn.execute(
                "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (ref_key, skill_name, "reference", tags, content, ref_path, byte_size, line_count)
            )
            print(f"  ✓ references/{ref_name_raw}.md ({raw_size:,} → {byte_size:,} bytes, optimized {pct:.1f}%)")
            count += 1

    # 3. Migrate other .md files in root of skill directory (e.g. prd-creator/JSON.md)
    # Exclude SKILL.md, README.md, LICENSE.md, CHANGELOG.md (case-insensitive)
    exclude_filenames = {"skill.md", "readme.md", "license.md", "changelog.md"}
    for file_path in sorted(glob.glob(os.path.join(skill_dir, "*.md"))):
        filename = os.path.basename(file_path)
        if filename.lower() in exclude_filenames:
            continue

        ref_name_raw = os.path.splitext(filename)[0]
        ref_key = f"{skill_name}/{ref_name_raw}"

        with open(file_path, "r", encoding="utf-8") as f:
            raw_content = f.read()
        tags = extract_tags_from_filename(file_path, skill_name)
        content = optimize_content(raw_content)
        byte_size = len(content.encode("utf-8"))
        raw_size = len(raw_content.encode("utf-8"))
        line_count = content.count("\n") + 1
        pct = ((raw_size - byte_size) / raw_size * 100) if raw_size > 0 else 0

        conn.execute("DELETE FROM skill_chunks WHERE skill_name = ?", (ref_key,))
        conn.execute("DELETE FROM skills WHERE name = ?", (ref_key,))
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (ref_key, skill_name, "reference", tags, content, file_path, byte_size, line_count)
        )
        print(f"  ✓ {filename} ({raw_size:,} → {byte_size:,} bytes, optimized {pct:.1f}%) [root reference]")
        count += 1

    return count


def normalize_legacy_skill_names(conn):
    """Rewrite legacy skill rows to the canonical genin-skill namespace."""
    rows = conn.execute(
        "SELECT name, skill_name FROM skills WHERE name LIKE 'deep-code-explorer%' OR skill_name = 'deep-code-explorer'"
    ).fetchall()
    migrated = 0
    removed = 0
    for name, skill_name in rows:
        new_name = name.replace("deep-code-explorer", "genin-skill", 1)
        new_skill_name = "genin-skill" if skill_name == "deep-code-explorer" else skill_name
        existing = conn.execute("SELECT 1 FROM skills WHERE name = ?", (new_name,)).fetchone()
        if existing:
            conn.execute("DELETE FROM skills WHERE name = ?", (name,))
            removed += 1
        else:
            conn.execute(
                "UPDATE skills SET name = ?, skill_name = ? WHERE name = ?",
                (new_name, new_skill_name, name),
            )
            migrated += 1
    return migrated, removed


def verify_required_skills(conn, required_skills):
    required = sorted({skill for skill in required_skills if skill})
    missing = [
        skill for skill in required
        if not conn.execute("SELECT 1 FROM skills WHERE name = ?", (skill,)).fetchone()
    ]
    legacy_rows = conn.execute(
        "SELECT name FROM skills WHERE name LIKE 'deep-code-explorer%' OR skill_name = 'deep-code-explorer'"
    ).fetchall()
    return missing, [row[0] for row in legacy_rows]


def print_summary(conn):
    """Print migration summary."""
    cursor = conn.execute("""
        SELECT skill_name, type, COUNT(*) as cnt, SUM(byte_size) as total_bytes
        FROM skills
        GROUP BY skill_name, type
        ORDER BY skill_name, type DESC
    """)

    print("\n" + "=" * 60)
    print("MIGRATION SUMMARY")
    print("=" * 60)

    total_rows = 0
    total_bytes = 0

    current_skill = None
    for row in cursor:
        if row[0] != current_skill:
            if current_skill is not None:
                print()
            current_skill = row[0]
            print(f"\n📦 {current_skill}")

        label = "SKILL.md" if row[1] == "skill" else f"references"
        cnt = row[2] or 0
        bs = row[3] or 0
        print(f"   {label}: {cnt} file(s), {bs:,} bytes")
        total_rows += cnt
        total_bytes += bs

    # Content deduplication warning removed as it alarmed users over legitimate shared references between skills.
    
    print(f"\n{'=' * 60}")
    print(f"TOTAL: {total_rows} entries, {total_bytes:,} bytes indexed")
    print(f"Database: {DB_PATH}")
    print(f"Database size: {os.path.getsize(DB_PATH):,} bytes")
    print(f"{'=' * 60}")


def auto_detect_skills(skills_dir):
    """Auto-detect all skills that have a SKILL.md file or are flat *-skill.md files."""
    detected = []
    if not os.path.isdir(skills_dir):
        return detected
    for entry in sorted(os.listdir(skills_dir)):
        entry_path = os.path.join(skills_dir, entry)
        if os.path.isdir(entry_path):
            skill_md = os.path.join(entry_path, "SKILL.md")
            if os.path.isfile(skill_md):
                detected.append(entry)
        elif os.path.isfile(entry_path) and entry.endswith("-skill.md"):
            detected.append(entry)
    return detected


def main():
    """Run the migration."""
    global DB_PATH, SKILLS_DIR, CUSTOM_SKILLS

    # Parse CLI arguments
    import argparse
    parser = argparse.ArgumentParser(description="Migrate agent skills to SQLite FTS5")
    parser.add_argument("--skills-dir", default=None,
                        help="Directory containing skills (default: ~/.agents/skills/)")
    parser.add_argument("--skills", nargs="*", default=None,
                        help="Specific skill names to migrate (default: auto-detect all)")
    parser.add_argument("--db-path", default=None,
                        help="Path to SQLite database (default: ~/.konoha/skills.db)")
    parser.add_argument("--clean", action="store_true",
                        help="Purge all existing skills from the database before migration")
    parser.add_argument("--rebuild-embeddings", action="store_true",
                        help="Force rebuilding of all vector embeddings")
    parser.add_argument("--skip-embeddings", action="store_true",
                        help="Skip vector embedding generation during migration")
    parser.add_argument("--require-skill", action="append", default=[],
                        help="Require a canonical skill row after migration")
    args = parser.parse_args()

    # Apply overrides
    if args.skills_dir:
        SKILLS_DIR = os.path.expanduser(args.skills_dir)
    else:
        # Check if default home directory has any skills, otherwise fallback to local workspace directory
        default_dir = os.path.expanduser("~/.agents/skills/")
        has_skills = False
        if os.path.isdir(default_dir):
            try:
                has_skills = any(
                    os.path.isfile(os.path.join(default_dir, d, "SKILL.md"))
                    for d in os.listdir(default_dir)
                    if os.path.isdir(os.path.join(default_dir, d))
                )
            except Exception:
                pass
        
        if not has_skills:
            local_dir = os.path.abspath(os.path.join(os.getcwd(), ".agents", "skills"))
            if os.path.isdir(local_dir):
                SKILLS_DIR = local_dir
            else:
                SKILLS_DIR = default_dir
        else:
            SKILLS_DIR = default_dir

    if args.db_path:
        DB_PATH = os.path.expanduser(args.db_path)

    # Determine which skills to migrate
    if args.skills:
        skills_to_migrate = args.skills
    else:
        # Auto-detect: try custom list first, then fall back to auto-detect
        detected = auto_detect_skills(SKILLS_DIR)
        if detected:
            skills_to_migrate = detected
        else:
            skills_to_migrate = CUSTOM_SKILLS

    print("🚀 Skills Migration to SQLite FTS5 (v1.1.0 — Enhanced Optimization)")
    print(f"   Source: {SKILLS_DIR}")
    print(f"   Target: {DB_PATH}")
    print(f"   Skills: {', '.join(skills_to_migrate)}")
    print()

    # Ensure directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    conn = setup_db()
    seed_agents(conn)

    if args.clean:
        print("🧹 Purging existing skills from database...")
        try:
            conn.execute("DELETE FROM skill_chunks;")
        except Exception:
            pass
        conn.execute("DELETE FROM skills;")
        conn.commit()

    total = 0
    for skill_name in skills_to_migrate:
        print(f"\n📦 Migrating: {skill_name}")
        count = migrate_skill(conn, skill_name)
        total += count

    migrated_legacy, removed_legacy = normalize_legacy_skill_names(conn)
    conn.commit()
    if migrated_legacy or removed_legacy:
        print(f"  Canonicalized legacy skill rows: {migrated_legacy} migrated, {removed_legacy} duplicates removed.")

    missing_required, remaining_legacy = verify_required_skills(conn, args.require_skill)
    if missing_required or remaining_legacy:
        if missing_required:
            print(f"  ✗ Required canonical skills missing: {', '.join(missing_required)}")
        if remaining_legacy:
            print(f"  ✗ Legacy skill rows remain: {', '.join(remaining_legacy)}")
        conn.close()
        raise SystemExit(1)

    # Clean up deleted skills (skills in db that no longer exist on disk)
    cursor = conn.execute("SELECT DISTINCT skill_name FROM skills")
    rows = cursor.fetchall()
    deleted_skills = set()
    for (s_name,) in rows:
        # Get all file paths for this skill
        fp_rows = conn.execute(
            "SELECT file_path FROM skills WHERE skill_name = ? AND file_path IS NOT NULL",
            (s_name,)
        ).fetchall()
        # If none of the stored file_paths exist on disk, the skill is stale
        any_exists = any(os.path.exists(r[0]) for r in fp_rows if r[0])
        if not any_exists and fp_rows:
            deleted_skills.add(s_name)

    if deleted_skills:
        print("\n🗑️  Cleaning up deleted skills from database:")
        for s_name in sorted(deleted_skills):
            conn.execute("DELETE FROM skills WHERE skill_name = ?", (s_name,))
            print(f"  ✓ Cleaned up: {s_name}")
        conn.commit()

    # Verify FTS index
    print("\n🔍 Verifying FTS index...")
    for test_word in ['security', 'terraform', 'svelte']:
        try:
            result = conn.execute(
                "SELECT COUNT(*) FROM skills_fts WHERE skills_fts MATCH ?",
                (test_word,)
            ).fetchone()
            print(f"   FTS test query '{test_word}': {result[0]} matches")
        except Exception:
            print(f"   FTS test query '{test_word}': skipped (no matches)")

    # Generate / update vector embeddings (enabled by default, pre-caches models across platforms)
    try:
        import vector_search
        semantic_enabled = vector_search.is_semantic_search_enabled()
    except Exception:
        semantic_enabled = True

    should_embed = not args.skip_embeddings and (semantic_enabled or args.rebuild_embeddings)
    if should_embed:
        try:
            import vector_search
            print("\n⚡ Pre-caching neural models across platforms (IBM Granite + GTE Reranker)...")
            vector_search.predownload_all_models(silent=False)
            print("⚡ Synchronizing vector embeddings (IBM Granite Multilingual)...")
            chunks_indexed = vector_search.backfill_all_embeddings(conn, force_rebuild=args.rebuild_embeddings)
            print(f"   Vector index synchronized: {chunks_indexed} chunks processed.")
        except Exception as e:
            print(f"   ⚠ Vector embedding generation deferred/skipped: {e}")

    print_summary(conn)
    conn.close()

    print(f"\n✅ Migration complete! {total} entries indexed.")


if __name__ == "__main__":
    main()
