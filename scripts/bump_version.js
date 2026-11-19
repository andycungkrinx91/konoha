#!/usr/bin/env node
'use strict';

/**
 * scripts/bump_version.js — Automated, deterministic version bumping & consistency check.
 *
 * Usage:
 *   node scripts/bump_version.js <newVersion>   # Bumps version across all managed files
 *   node scripts/bump_version.js --check        # Verifies all managed files reflect package.json
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.env.KONOHA_BUMP_ROOT
  ? path.resolve(process.env.KONOHA_BUMP_ROOT)
  : path.resolve(__dirname, '..');

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?$/;

function readJson(relPath) {
  const full = path.join(ROOT_DIR, relPath);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function writeJson(relPath, obj) {
  const full = path.join(ROOT_DIR, relPath);
  fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function replaceInFile(relPath, pattern, replacement) {
  const full = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Managed file missing: ${relPath}`);
  }
  const original = fs.readFileSync(full, 'utf8');
  let count = 0;
  const updated = original.replace(pattern, (...args) => {
    count++;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (count === 0) {
    if (typeof replacement === 'string' && original.includes(replacement)) {
      return 0;
    }
    throw new Error(`Zero replacements in ${relPath} for pattern ${pattern}`);
  }
  fs.writeFileSync(full, updated, 'utf8');
  return count;
}

function getPackageFiles(version) {
  return [
    {
      path: 'package.json',
      check: (c) => JSON.parse(c).version === version,
      bump: (oldV, newV) => {
        const pkg = readJson('package.json');
        pkg.version = newV;
        writeJson('package.json', pkg);
        return 1;
      }
    },
    {
      path: 'apps/web/package.json',
      check: (c) => JSON.parse(c).version === version,
      bump: (oldV, newV) => {
        const pkg = readJson('apps/web/package.json');
        pkg.version = newV;
        writeJson('apps/web/package.json', pkg);
        return 1;
      }
    },
    {
      path: 'apps/web/src/routes/+layout.svelte',
      check: (c) => c.includes(`version: '${version}'`),
      bump: (oldV, newV) => replaceInFile('apps/web/src/routes/+layout.svelte', new RegExp(`version: '${oldV}'`, 'g'), `version: '${newV}'`)
    }
  ];
}

function getTemplateAndConfigFiles(version) {
  return [
    {
      path: 'Dockerfile',
      check: (c) => c.includes(`(v${version})`),
      bump: (oldV, newV) => replaceInFile('Dockerfile', new RegExp(`\\(v${oldV}\\)`, 'g'), `(v${newV})`)
    },
    {
      path: 'src/agent_contract.js',
      check: (c) => c.includes(`CONTRACT_VERSION = '${version}';`),
      bump: (oldV, newV) => replaceInFile('src/agent_contract.js', new RegExp(`CONTRACT_VERSION = '${oldV}';`, 'g'), `CONTRACT_VERSION = '${newV}';`)
    },
    {
      path: 'src/templates/AGENTS.md',
      check: (c) => c.includes(`## Konoha runtime contract (${version})`),
      bump: (oldV, newV) => replaceInFile('src/templates/AGENTS.md', new RegExp(`## Konoha runtime contract \\(${oldV}\\)`, 'g'), `## Konoha runtime contract (${newV})`)
    },
    {
      path: 'src/templates/GEMINI.md',
      check: (c) => c.includes(`## Konoha runtime contract (${version})`),
      bump: (oldV, newV) => replaceInFile('src/templates/GEMINI.md', new RegExp(`## Konoha runtime contract \\(${oldV}\\)`, 'g'), `## Konoha runtime contract (${newV})`)
    }
  ];
}

function getDocumentationFiles(version) {
  return [
    {
      path: 'README.md',
      check: (c) => c.includes(`Release-v${version}-blue`) && c.includes(`alt="Release v${version}"`),
      bump: (oldV, newV) => {
        let n = replaceInFile('README.md', new RegExp(`Release-v${oldV}-blue`, 'g'), `Release-v${newV}-blue`);
        n += replaceInFile('README.md', new RegExp(`alt="Release v${oldV}"`, 'g'), `alt="Release v${newV}"`);
        return n;
      }
    },
    {
      path: 'docs/QA-TEST-CHECKLIST.md',
      // Anchored to the matrix header and the `konoha version` row: the per-section
      // `(vX.Y.Z)` tags below the header are historical records and must never be rewritten.
      check: (c) => c.includes(`Authoritative verification matrix for Konoha MCP Tools Orchestrator (v${version})`)
        && c.includes(`| Displays \`${version}\`, queries npm registry`),
      bump: (oldV, newV) => {
        let n = replaceInFile(
          'docs/QA-TEST-CHECKLIST.md',
          new RegExp(`(Authoritative verification matrix for Konoha MCP Tools Orchestrator \\(v)${oldV.replace(/\./g, '\\.')}(\\))`),
          (_m, a, b) => `${a}${newV}${b}`
        );
        n += replaceInFile(
          'docs/QA-TEST-CHECKLIST.md',
          new RegExp(`(\\| Displays \`)${oldV.replace(/\./g, '\\.')}(\`, queries npm registry)`),
          (_m, a, b) => `${a}${newV}${b}`
        );
        return n;
      }
    },
    {
      path: 'docs/SECURITY.md',
      // Anchored to the document title: section tags record the release a control landed in.
      check: (c) => c.includes(`# Konoha MCP Security Architecture & Ingress Controls (v${version})`),
      bump: (oldV, newV) => replaceInFile(
        'docs/SECURITY.md',
        new RegExp(`(^# Konoha MCP Security Architecture & Ingress Controls \\(v)${oldV.replace(/\./g, '\\.')}(\\))`, 'm'),
        (_m, a, b) => `${a}${newV}${b}`
      )
    },
    {
      path: 'docs/BENCHMARK.md',
      check: (c) => c.includes(`(v${version})`),
      bump: (oldV, newV) => replaceInFile('docs/BENCHMARK.md', new RegExp(`\\(v${oldV}\\)`, 'g'), `(v${newV})`)
    },
    {
      path: 'docs/ARCHITECTURE.md',
      check: (c) => c.includes(`(version ${version})`),
      bump: (oldV, newV) => replaceInFile('docs/ARCHITECTURE.md', new RegExp(`\\(version ${oldV}\\)`, 'g'), `(version ${newV})`)
    },
    {
      path: 'docs/SETUP-CURSOR.md',
      // `verified at <version>` below the intro is a dated record of the last run, not a
      // current-version claim, so only the intro marker is managed.
      check: (c) => c.includes(`Konoha **v${version}**`),
      bump: (oldV, newV) => replaceInFile('docs/SETUP-CURSOR.md', new RegExp(`Konoha \\*\\*v${oldV.replace(/\./g, '\\.')}\\*\\*`, 'g'), `Konoha **v${newV}**`)
    },
    {
      path: 'docs/TELEGRAM_INTEGRATION_GUIDE.md',
      check: (c) => c.includes(`**Konoha MCP Version:** v${version}`),
      bump: (oldV, newV) => replaceInFile('docs/TELEGRAM_INTEGRATION_GUIDE.md', new RegExp(`\\*\\*Konoha MCP Version:\\*\\* v${oldV.replace(/\./g, '\\.')}`, 'g'), `**Konoha MCP Version:** v${newV}`)
    },
    {
      path: 'docs/architecture/CANONICAL-CLI.md',
      check: (c) => c.includes(`(Konoha v${version})`),
      bump: (oldV, newV) => replaceInFile('docs/architecture/CANONICAL-CLI.md', new RegExp(`\\(Konoha v${oldV.replace(/\./g, '\\.')}\\)`, 'g'), `(Konoha v${newV})`)
    },
    {
      path: 'docs/VPS-INSTALL.md',
      check: (c) => c.includes(`akatsuki-cyber-pack-${version}.tar.zst`),
      bump: (oldV, newV) => replaceInFile('docs/VPS-INSTALL.md', new RegExp(`akatsuki-cyber-pack-${oldV.replace(/\./g, '\\.')}\\.tar\\.zst`, 'g'), `akatsuki-cyber-pack-${newV}.tar.zst`)
    },
    {
      path: 'docs/MANUAL.md',
      check: (c) => c.includes(`**Version of record: ${version}**`),
      bump: (oldV, newV) => replaceInFile('docs/MANUAL.md', new RegExp(`\\*\\*Version of record: ${oldV.replace(/\./g, '\\.')}\\*\\*`, 'g'), `**Version of record: ${newV}**`)
    },
    {
      path: 'docs/README.md',
      check: (c) => c.includes(`Capability to file to tool mapping for v${version}`) && c.includes(`| v${version} ingress, auth`),
      bump: (oldV, newV) => {
        let n = replaceInFile('docs/README.md', new RegExp(`Capability to file to tool mapping for v${oldV.replace(/\./g, '\\.')}`, 'g'), `Capability to file to tool mapping for v${newV}`);
        n += replaceInFile('docs/README.md', new RegExp(`\\| v${oldV.replace(/\./g, '\\.')} ingress, auth`, 'g'), `| v${newV} ingress, auth`);
        return n;
      }
    },
    {
      path: 'docs/SETUP-CLI.md',
      check: (c) => c.includes(`\`${version}\``),
      bump: (oldV, newV) => replaceInFile('docs/SETUP-CLI.md', new RegExp(`\`${oldV}\``, 'g'), `\`${newV}\``)
    },
    {
      path: 'docs/architecture/CANONICAL-API.md',
      check: (c) => c.includes(`**Document Version:** ${version}`),
      bump: (oldV, newV) => {
        let n = replaceInFile('docs/architecture/CANONICAL-API.md', new RegExp(`\\*\\*Document Version:\\*\\* ${oldV}`, 'g'), `**Document Version:** ${newV}`);
        n += replaceInFile('docs/architecture/CANONICAL-API.md', new RegExp(`v${oldV.replace(/\./g, '\\.')}`, 'g'), `v${newV}`);
        return n;
      }
    },
    {
      path: 'docs/architecture/CAPABILITY-MAP.md',
      check: (c) => c.includes(`**Document Version:** ${version}`),
      bump: (oldV, newV) => {
        let n = replaceInFile('docs/architecture/CAPABILITY-MAP.md', new RegExp(`\\*\\*Document Version:\\*\\* ${oldV}`, 'g'), `**Document Version:** ${newV}`);
        n += replaceInFile('docs/architecture/CAPABILITY-MAP.md', new RegExp(`v${oldV.replace(/\./g, '\\.')}`, 'g'), `v${newV}`);
        return n;
      }
    },
    {
      path: 'scripts/lib/data.json',
      check: (c) => c.includes(`v${version}`),
      bump: (oldV, newV) => replaceInFile('scripts/lib/data.json', new RegExp(oldV, 'g'), newV)
    },
    {
      path: 'CHANGELOG.md',
      check: (c) => c.includes(`## [${version}]`),
      bump: (oldV, newV) => {
        const full = path.join(ROOT_DIR, 'CHANGELOG.md');
        const content = fs.readFileSync(full, 'utf8');
        const dateStr = new Date().toISOString().slice(0, 10);
        const header = `## [${newV}] - ${dateStr}\n\n`;
        if (content.includes(`## [${newV}]`)) {
          return 1;
        }
        fs.writeFileSync(full, header + content, 'utf8');
        return 1;
      }
    }
  ];
}

function getManagedFileList(version) {
  return [
    ...getPackageFiles(version),
    ...getTemplateAndConfigFiles(version),
    ...getDocumentationFiles(version)
  ];
}

function runCheck() {
  const pkg = readJson('package.json');
  const currentVersion = pkg.version;
  console.log(`Checking version consistency against package.json (v${currentVersion})...\n`);

  const manifest = getManagedFileList(currentVersion);
  let hasErrors = false;

  for (const item of manifest) {
    const full = path.join(ROOT_DIR, item.path);
    if (!fs.existsSync(full)) {
      console.error(`  ✗ [MISSING] ${item.path}`);
      hasErrors = true;
      continue;
    }
    const content = fs.readFileSync(full, 'utf8');
    if (item.check(content)) {
      console.log(`  ✓ ${item.path}`);
    } else {
      console.error(`  ✗ [STALE/INCONSISTENT] ${item.path} does not reflect v${currentVersion}`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error('\nVersion consistency check FAILED.');
    process.exit(1);
  } else {
    console.log(`\nVersion consistency check PASSED (all ${manifest.length} files synchronized at v${currentVersion}).`);
  }
}

function runBump(newVersion) {
  if (!SEMVER_REGEX.test(newVersion)) {
    console.error(`Invalid semver version: "${newVersion}". Expected format: x.y.z`);
    process.exit(1);
  }

  const pkg = readJson('package.json');
  const oldVersion = pkg.version;

  if (oldVersion === newVersion) {
    console.error(`Target version "${newVersion}" equals current version. Nothing to bump.`);
    process.exit(1);
  }

  console.log(`Bumping Konoha MCP version: v${oldVersion} → v${newVersion}\n`);
  const manifest = getManagedFileList(oldVersion);
  const results = [];

  for (const item of manifest) {
    try {
      const count = item.bump(oldVersion, newVersion);
      results.push({ path: item.path, status: 'UPDATED', count });
    } catch (err) {
      console.error(`Failed bumping ${item.path}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('┌────────────────────────────────────────────────────────┬───────────┬───────┐');
  console.log('│ Managed Target File                                    │ Status    │ Repl  │');
  console.log('├────────────────────────────────────────────────────────┼───────────┼───────┤');
  for (const r of results) {
    const p = r.path.padEnd(54, ' ');
    const s = r.status.padEnd(9, ' ');
    const c = String(r.count).padStart(5, ' ');
    console.log(`│ ${p} │ ${s} │ ${c} │`);
  }
  console.log('└────────────────────────────────────────────────────────┴───────────┴───────┘');
  console.log(`\n✨ Successfully bumped all ${manifest.length} files to v${newVersion}.`);
}

function main() {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    console.log('Usage:');
    console.log('  node scripts/bump_version.js <newVersion>   # Bump version');
    console.log('  node scripts/bump_version.js --check        # Verify consistency');
    process.exit(0);
  }

  if (arg === '--check') {
    runCheck();
  } else {
    runBump(arg);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getManagedFileList,
  runCheck,
  runBump,
  ROOT_DIR
};
