'use strict';

/**
 * Konoha Jonin Project Frontend Maintenance Skill Generator (`v2.2.18`)
 * Automatically generates or updates `<project_path>/.agents/skills/<project-slug>-frontend-maintenance/SKILL.md`
 * after frontend generation and indexes it into `konoha.db` (`skills`, `skills_fts`, `skill_chunks`)
 * scoped to the project's `project_hash:<hash>`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { autoMigrateProjectSkills } = require('../../mcp/skills_search');

function computeProjectHash(projectPath) {
  const norm = path.resolve(String(projectPath || process.cwd())).replace(/\\/g, '/');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 12);
}

function toProjectSlug(nameOrPath) {
  const base = path.basename(String(nameOrPath || 'web-app').trim());
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'web-app';
}

function _collectRelativeEntries(projectPath, candidateDirs, maxEntries) {
  const collected = [];
  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    try {
      for (const entry of fs.readdirSync(dir).slice(0, maxEntries)) {
        collected.push(path.relative(projectPath, path.join(dir, entry)).replace(/\\/g, '/'));
      }
    } catch (_) { /* ignore */ }
  }
  return collected;
}

function discoverProjectStructure(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  let pkg = {};
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (_) {
      pkg = {};
    }
  }

  const scripts = pkg.scripts ? Object.keys(pkg.scripts) : ['dev', 'build', 'lint', 'test'];
  const routes = _collectRelativeEntries(projectPath, [
    path.join(projectPath, 'src', 'app'),
    path.join(projectPath, 'src', 'routes'),
    path.join(projectPath, 'pages'),
    path.join(projectPath, 'app')
  ], 20);
  const components = _collectRelativeEntries(projectPath, [
    path.join(projectPath, 'src', 'components'),
    path.join(projectPath, 'components')
  ], 25);

  return {
    packageName: pkg.name || path.basename(projectPath),
    scripts,
    routes: routes.length > 0 ? routes : ['src/app/page.tsx'],
    components: components.length > 0 ? components : ['src/components/Footer.tsx']
  };
}

function buildFrontendMaintenanceSkillMarkdown(options = {}) {
  const slug = options.slug || toProjectSlug(options.projectName || options.projectPath);
  const skillName = `${slug}-frontend-maintenance`;
  const framework = options.framework || 'nextjs';
  const archetype = options.archetype || 'saas';
  const themeTokens = options.themeTokens || {
    colorScheme: 'dark-and-light-adaptive',
    surface: '--bg-surface / --text-primary / --accent-primary'
  };
  const structure = options.structure || {
    scripts: ['dev', 'build', 'lint', 'test'],
    routes: ['src/app/page.tsx'],
    components: ['src/components/Footer.tsx']
  };

  return [
    '---',
    `name: ${skillName}`,
    `description: Project-scoped frontend maintenance skill for ${slug} (${framework}, ${archetype}). Preserves theme tokens, responsive layout, tests, and Build by konoha signature.`,
    '---',
    '',
    `# ${slug} — Frontend Maintenance Skill`,
    '',
    '## Architecture & Stack',
    `- **Framework**: \`${framework}\``,
    `- **Archetype**: \`${archetype}\``,
    `- **Color Mode**: Dark & Light Mode via semantic CSS custom properties (\`${themeTokens.colorScheme}\`)`,
    '- **Required Signature**: `<meta name="generator" content="Build by konoha">` in document `<head>` and visible `Build by konoha` signature in `<footer>`.',
    '- **Anti-Slop Policy**: Zero emojis in UI controls/headings, zero hardcoded hex colors outside theme tokens, and dynamic Astra/Fable-grade visual hierarchy.',
    '',
    '## Discovered Routes',
    ...structure.routes.map((r) => `- \`${r}\``),
    '',
    '## Component Inventory',
    ...structure.components.map((c) => `- \`${c}\``),
    '',
    '## Validation & Test Commands',
    ...structure.scripts.map((s) => `- \`pnpm run ${s}\``),
    ''
  ].join('\n');
}

function _indexProjectSkillBestEffort(projectPath, skillName) {
  try {
    const migrated = autoMigrateProjectSkills(projectPath) || [];
    if (migrated.length > 0) return migrated;
    const migrateModule = require('../../migrate');
    const skillsRoot = path.join(projectPath, '.agents', 'skills');
    const cnt = migrateModule.migrateSingleSkill(skillName, skillsRoot);
    return cnt > 0 ? [`${skillName} (${skillsRoot})`] : [];
  } catch (_) {
    return [];
  }
}

function generateAndIndexProjectFrontendSkill(options = {}) {
  const projectPath = path.resolve(String(options.projectPath || process.cwd()));
  const slug = toProjectSlug(options.projectName || projectPath);
  const skillName = `${slug}-frontend-maintenance`;
  const skillDir = path.join(projectPath, '.agents', 'skills', skillName);
  const skillFilePath = path.join(skillDir, 'SKILL.md');

  fs.mkdirSync(skillDir, { recursive: true });
  const structure = discoverProjectStructure(projectPath);
  const markdown = buildFrontendMaintenanceSkillMarkdown({
    ...options,
    projectPath,
    slug,
    structure
  });
  fs.writeFileSync(skillFilePath, markdown, 'utf8');

  const migrated = options.autoIndex !== false
    ? _indexProjectSkillBestEffort(projectPath, skillName)
    : [];

  return {
    status: 'generated',
    skill_name: skillName,
    skill_path: skillFilePath,
    project_hash: computeProjectHash(projectPath),
    migrated_skills: migrated
  };
}

module.exports = {
  toProjectSlug,
  discoverProjectStructure,
  buildFrontendMaintenanceSkillMarkdown,
  generateAndIndexProjectFrontendSkill
};
