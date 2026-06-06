#!/usr/bin/env python3
"""
Skills Migration Script
Migrates skill content from ~/.agents/skills/ into SQLite FTS5 database.

Each SKILL.md is stored as type='skill'.
Each references/*.md is stored as type='reference' with parent skill tagged.
Scripts are NOT stored — they remain on disk. Script metadata (paths, commands)
is captured from SKILL.md content.

Idempotent: safe to re-run (uses INSERT OR REPLACE).
"""

import sqlite3
import os
import glob
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DB_PATH = os.path.expanduser("~/.gemini/skills-db/skills.db")
SKILLS_DIR = os.path.expanduser("~/.agents/skills/")

# Skills to migrate (our custom skills, not Google DataCloud ones)
CUSTOM_SKILLS = [
    "deep-code-explorer",
    "modern-full-stack",
    "devsecops-engineer",
    "websearch-deep",
    "agent-skills-creator",
]


def setup_db():
    """Create the database schema."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS skills (
            name TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL,
            type TEXT NOT NULL,
            tags TEXT,
            content TEXT,
            file_path TEXT,
            byte_size INTEGER,
            line_count INTEGER
        );

        -- FTS5 virtual table for full-text search
        -- content= means it's an external content table (shares data with skills)
        CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts
        USING fts5(
            name,
            skill_name,
            tags,
            content,
            content=skills,
            content_rowid=rowid
        );

        -- Triggers to keep FTS index in sync
        CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
            INSERT INTO skills_fts(rowid, name, skill_name, tags, content)
            VALUES (new.rowid, new.name, new.skill_name, new.tags, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
            INSERT INTO skills_fts(skills_fts, rowid, name, skill_name, tags, content)
            VALUES('delete', old.rowid, old.name, old.skill_name, old.tags, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
            INSERT INTO skills_fts(skills_fts, rowid, name, skill_name, tags, content)
            VALUES('delete', old.rowid, old.name, old.skill_name, old.tags, old.content);
            INSERT INTO skills_fts(rowid, name, skill_name, tags, content)
            VALUES (new.rowid, new.name, new.skill_name, new.tags, new.content);
        END;

        -- Table to store tool call statistics and token savings
        CREATE TABLE IF NOT EXISTS tool_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            tool TEXT NOT NULL,
            query TEXT,
            returned_bytes INTEGER,
            total_library_bytes INTEGER,
            bytes_saved INTEGER,
            tokens_saved INTEGER
        );
    """)
    conn.commit()
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
        conn.execute("DELETE FROM skills WHERE skill_name = ?", (skill_name_clean,))

        content = open(file_path, "r", encoding="utf-8").read()
        tags = extract_tags_from_frontmatter(content)
        byte_size = len(content.encode("utf-8"))
        line_count = content.count("\n") + 1

        conn.execute("DELETE FROM skills WHERE name = ?", (skill_name_clean,))
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (skill_name_clean, skill_name_clean, "skill", tags, content, file_path, byte_size, line_count)
        )
        print(f"  ✓ {skill_name} ({byte_size:,} bytes)")
        return 1

    skill_dir = os.path.join(SKILLS_DIR, skill_name)

    if not os.path.isdir(skill_dir):
        print(f"  ✗ Directory not found: {skill_dir}")
        return 0

    # Clean existing entries for this skill to prevent stale references
    conn.execute("DELETE FROM skills WHERE skill_name = ?", (skill_name,))

    count = 0

    # 1. Migrate SKILL.md
    skill_md = os.path.join(skill_dir, "SKILL.md")
    if os.path.isfile(skill_md):
        content = open(skill_md, "r", encoding="utf-8").read()
        tags = extract_tags_from_frontmatter(content)
        byte_size = len(content.encode("utf-8"))
        line_count = content.count("\n") + 1

        # For INSERT OR REPLACE with FTS sync triggers,
        # we need to delete first then insert
        conn.execute("DELETE FROM skills WHERE name = ?", (skill_name,))
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (skill_name, skill_name, "skill", tags, content, skill_md, byte_size, line_count)
        )
        print(f"  ✓ SKILL.md ({byte_size:,} bytes, {line_count} lines)")
        count += 1

    # 2. Migrate references/*.md
    refs_dir = os.path.join(skill_dir, "references")
    if os.path.isdir(refs_dir):
        for ref_path in sorted(glob.glob(os.path.join(refs_dir, "*.md"))):
            ref_name_raw = os.path.splitext(os.path.basename(ref_path))[0]
            ref_key = f"{skill_name}/{ref_name_raw}"

            content = open(ref_path, "r", encoding="utf-8").read()
            tags = extract_tags_from_filename(ref_path, skill_name)
            byte_size = len(content.encode("utf-8"))
            line_count = content.count("\n") + 1

            conn.execute("DELETE FROM skills WHERE name = ?", (ref_key,))
            conn.execute(
                "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (ref_key, skill_name, "reference", tags, content, ref_path, byte_size, line_count)
            )
            print(f"  ✓ references/{ref_name_raw}.md ({byte_size:,} bytes)")
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

        content = open(file_path, "r", encoding="utf-8").read()
        tags = extract_tags_from_filename(file_path, skill_name)
        byte_size = len(content.encode("utf-8"))
        line_count = content.count("\n") + 1

        conn.execute("DELETE FROM skills WHERE name = ?", (ref_key,))
        conn.execute(
            "INSERT INTO skills (name, skill_name, type, tags, content, file_path, byte_size, line_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (ref_key, skill_name, "reference", tags, content, file_path, byte_size, line_count)
        )
        print(f"  ✓ {filename} ({byte_size:,} bytes) [root reference]")
        count += 1

    return count


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
        print(f"   {label}: {row[2]} file(s), {row[3]:,} bytes")
        total_rows += row[2]
        total_bytes += row[3]

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
                        help="Path to SQLite database (default: ~/.gemini/skills-db/skills.db)")
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

    print("🚀 Skills Migration to SQLite FTS5")
    print(f"   Source: {SKILLS_DIR}")
    print(f"   Target: {DB_PATH}")
    print(f"   Skills: {', '.join(skills_to_migrate)}")
    print()

    # Ensure directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    conn = setup_db()

    total = 0
    for skill_name in skills_to_migrate:
        print(f"\n📦 Migrating: {skill_name}")
        count = migrate_skill(conn, skill_name)
        total += count

    conn.commit()

    # Clean up deleted skills (skills in db that no longer exist on disk)
    cursor = conn.execute("SELECT DISTINCT skill_name, file_path FROM skills")
    rows = cursor.fetchall()
    deleted_skills = set()
    for s_name, f_path in rows:
        if f_path and f_path.startswith(SKILLS_DIR):
            skill_folder_path = os.path.join(SKILLS_DIR, s_name)
            skill_file_path = os.path.join(SKILLS_DIR, f"{s_name}.md")
            if not os.path.isdir(skill_folder_path) and not os.path.isfile(skill_file_path):
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

    print_summary(conn)
    conn.close()

    print(f"\n✅ Migration complete! {total} entries indexed.")


if __name__ == "__main__":
    main()

