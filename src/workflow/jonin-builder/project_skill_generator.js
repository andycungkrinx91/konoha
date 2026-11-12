'use strict';

/**
 * Konoha Jonin Project Frontend Maintenance Skill Generator (`v2.2.20`)
 * Automatically generates or updates `<project_path>/.agents/skills/<project-slug>-frontend-maintenance/SKILL.md`
 * after frontend generation and indexes it into `konoha.db` (`skills`, `skills_fts`, `skill_chunks`)
 * scoped to the project's `project_hash:<hash>`.
 */

const fs = require('fs');
const path = require('path');
const { autoMigrateProjectSkills } = require('../../mcp/skills_search');
const { computeProjectHash } = require('../../persona_memory_projects');
const { getConfigValue } = require('../../config_access');

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
  const provenanceList = Array.isArray(options.componentProvenance) && options.componentProvenance.length > 0
    ? options.componentProvenance
    : [
      {
        component_name: 'Framer Marketplace Adapted Surface',
        marketplace_url: getConfigValue('framer_marketplace_url'),
        pricing_tier: 'free+paid-preview-rea',
        licensing_mode: 'native_clean_room_recreation',
        target_framework: framework
      }
    ];

  return [
    '---',
    `name: ${skillName}`,
    `description: Project-scoped frontend maintenance skill for ${slug} (${framework}, ${archetype}). Preserves theme tokens, responsive layout, Framer Marketplace provenance, tests, and Build by konoha signature.`,
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
    '## Framer Marketplace Component Provenance (Chunin REA -> Jonin Native)',
    ...provenanceList.map((p) => (
      `- **${p.component_name || p.component_id || 'Component'}**: Source \`${p.marketplace_url || getConfigValue('framer_marketplace_url')}\` | Tier: \`${p.pricing_tier || 'free'}\` | Mode: \`${p.licensing_mode || 'native_clean_room_recreation'}\` | Framework: \`${p.target_framework || framework}\` (No iframe injection; no protected source extraction)`
    )),
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
