#!/usr/bin/env node
'use strict';

/**
 * Fails when a blue skill template carries an executable privileged pattern.
 *
 * Rule: instructional privileged content makes a skill red. A pattern counts as
 * instructional when the skill tells the reader to run it; it counts as a
 * prohibition when the skill names it in order to forbid it. Only the
 * instructional case is a violation, so deny-lists and threat-model prose stay
 * legal in blue skills.
 *
 * Usage: node scripts/audit_skill_privileged_patterns.js [--json]
 * Exit code 1 when any violation is found.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT_DIR, 'src', 'templates', 'skills');
const RED_ROOTS = new Set(['akatsuki-skill']);

/** Privileged patterns that must never appear as a runnable instruction in blue skills. */
const PATTERNS = [
  { id: 'pipe-to-shell', re: /(?:curl|wget)\s[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/ },
  { id: 'powershell-iex-download', re: /(?:irm|Invoke-WebRequest|iwr)\s[^\n]*\|\s*iex\b/i },
  { id: 'sudo-install', re: /^\s*(?:\$\s*)?sudo\s+(?:apt|apt-get|dnf|yum|pacman|apk|snap|brew)\s+install\b/m },
  { id: 'chmod-setuid', re: /\bchmod\s+(?:[0-7]*[4-7][0-7]{2}|u\+s)\b/ },
  { id: 'reverse-shell', re: /\b(?:bash\s+-i\s+>&|\/dev\/tcp\/|nc\s+-e\b|socat\s+.*exec)/ },
  { id: 'credential-dump', re: /\b(?:mimikatz|secretsdump\.py|hashdump|lsass\.dmp)\b/i }
];

/** A line is a prohibition when it names the pattern to forbid it. */
const PROHIBITION_RE = /\b(?:never|must not|must never|do not|don't|forbidden|prohibited|avoid|deny|denied|blocked|refuse|no)\b/i;

function listSkillRoots() {
  return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function walkMarkdown(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkMarkdown(full, out);
    } else if (/\.(?:md|markdown|txt|sh)$/i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(file) {
  const violations = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const [idx, line] of lines.entries()) {
    if (PROHIBITION_RE.test(line)) continue;
    for (const pattern of PATTERNS) {
      if (pattern.re.test(line)) {
        violations.push({
          file: path.relative(ROOT_DIR, file),
          line: idx + 1,
          pattern: pattern.id,
          text: line.trim().slice(0, 160)
        });
      }
    }
  }
  return violations;
}

function audit() {
  const violations = [];
  const scanned = [];
  for (const skill of listSkillRoots()) {
    if (RED_ROOTS.has(skill)) continue;
    const dir = path.join(SKILLS_DIR, skill);
    for (const file of walkMarkdown(dir, [])) {
      scanned.push(path.relative(ROOT_DIR, file));
      violations.push(...scanFile(file));
    }
  }
  return { scanned: scanned.length, violations };
}

if (require.main === module) {
  const json = process.argv.includes('--json');
  const { scanned, violations } = audit();
  if (json) {
    console.log(JSON.stringify({ scanned, violations }, null, 2));
  } else if (violations.length === 0) {
    console.log(`✔ No instructional privileged patterns in ${scanned} blue skill files.`);
  } else {
    console.error(`✖ ${violations.length} privileged pattern(s) in blue skills:`);
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.pattern}] ${v.text}`);
    }
  }
  process.exit(violations.length === 0 ? 0 : 1);
}

module.exports = { audit, scanFile, PATTERNS, PROHIBITION_RE };