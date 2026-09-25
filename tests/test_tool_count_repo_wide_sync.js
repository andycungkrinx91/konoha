#!/usr/bin/env node
'use strict';

/**
 * tests/test_tool_count_repo_wide_sync.js — Verifies that EVERY file across the repository
 * stating a Konoha tool count matches the live schema count (35 tools) without drift.
 * 
 * Enforced by PLAN-RECONCILE-3.md to prevent narrow regression guards.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { listToolSchemas } = require('../src/file_tools_router');

console.log('Running test_tool_count_repo_wide_sync.js...');

const ROOT = path.resolve(__dirname, '..');
const liveSchemas = listToolSchemas();
const liveCount = liveSchemas.length;

assert.strictEqual(liveCount, 35, `Live canonical tool count must be exactly 35, found ${liveCount}`);
const liveToolNames = new Set(liveSchemas.map(t => t.name));

// Tracked files and their expected assertions
const TRACKED_FILES = [
  {
    relPath: 'README.md',
    mustInclude: [
      `[MCP Tools](https://img.shields.io/badge/MCP%20Tools-35%20Canonical-10b981)`,
      `The unified \`konoha\` server exposes 35 canonical tools`
    ],
    forbiddenPatterns: [
      /\b(?:43|42|39|38|33)\s+tools?\b/i
    ]
  },
  {
    relPath: 'docs/ARCHITECTURE.md',
    mustInclude: [
      `## 🛠️ Canonical Konoha MCP Tools Matrix (35 Canonical Tools)`,
      `across \`konoha\` (35 tools)`
    ],
    forbiddenPatterns: [
      /across\s+`konoha`\s+\((?:43|42|39|38|33)\s+tools\)/i,
      /\b(?:43|42|39|38|33)\s+canonical\s+tools\b/i
    ],
    verifyMatrix: true
  },
  {
    relPath: 'docs/architecture/CANONICAL-API.md',
    mustInclude: [
      `All tools (35 active) are served through the \`konoha\` MCP server`
    ],
    forbiddenPatterns: [
      /\bAll\s+tools\s+\((?:43|42|39|38|33)\s+active\)/i
    ]
  },
  {
    relPath: 'docs/architecture/TOKEN-BASELINE.md',
    mustInclude: [
      `35 Konoha + 2 Semble + 4 Aislop`,
      `exactly 35 canonical tools`
    ],
    forbiddenPatterns: [
      /\bbetween\s+33\s+and\s+38\b/i,
      /\b33\s+tools\b/i
    ]
  },
  {
    relPath: 'docs/TROUBLESHOOTING.md',
    mustInclude: [
      `serves all 35 canonical tools`,
      `JSON listing **35 canonical tools**`
    ],
    forbiddenPatterns: [
      /serves\s+all\s+(?:43|42|39|38|33)\s+tools/i,
      /JSON\s+listing\s+\*\*(?:43|42|39|38|20)\s+tools\*\*/i
    ]
  },
  {
    relPath: 'src/pi_manager.js',
    mustInclude: [
      `serves all 35 canonical tools through`
    ],
    forbiddenPatterns: [
      /serves\s+ALL\s+(?:43|42|39|38|33)\s+tools/i
    ]
  },
  {
    relPath: '.agents/skills/konoha/SKILL.md',
    mustInclude: [
      `All 35 canonical MCP tools`,
      `serves ALL 35 canonical tools`
    ],
    forbiddenPatterns: [
      /All\s+(?:43|42|39|38|33)\s+MCP\s+tools/i,
      /serves\s+ALL\s+(?:43|42|39|38|33)\s+tools/i
    ]
  },
  {
    relPath: 'src/templates/skills/konoha/SKILL.md',
    mustInclude: [
      `All 35 canonical MCP tools`,
      `serves ALL 35 canonical tools`
    ],
    forbiddenPatterns: [
      /All\s+(?:43|42|39|38|33)\s+MCP\s+tools/i,
      /serves\s+ALL\s+(?:43|42|39|38|33)\s+tools/i
    ]
  },
  {
    relPath: '.cursor/skills/konoha/SKILL.md',
    mustInclude: [
      `All 35 canonical MCP tools`,
      `serves ALL 35 canonical tools`
    ],
    forbiddenPatterns: [
      /All\s+(?:43|42|39|38|33)\s+MCP\s+tools/i,
      /serves\s+ALL\s+(?:43|42|39|38|33)\s+tools/i
    ]
  },
  {
    relPath: '.gemini/skills/konoha/SKILL.md',
    mustInclude: [
      `All 35 canonical MCP tools`,
      `serves ALL 35 canonical tools`
    ],
    forbiddenPatterns: [
      /All\s+(?:43|42|39|38|33)\s+MCP\s+tools/i,
      /serves\s+ALL\s+(?:43|42|39|38|33)\s+tools/i
    ]
  },
  {
    relPath: '.commandcode/skills/konoha/SKILL.md',
    mustInclude: [
      `All 35 canonical MCP tools`,
      `serves ALL 35 canonical tools`
    ],
    forbiddenPatterns: [
      /All\s+(?:43|42|39|38|33)\s+MCP\s+tools/i,
      /serves\s+ALL\s+(?:43|42|39|38|33)\s+tools/i
    ]
  },
  {
    relPath: '.claude/skills/konoha/SKILL.md',
    mustInclude: [
      `All 35 canonical MCP tools`,
      `serves ALL 35 canonical tools`
    ],
    forbiddenPatterns: [
      /All\s+(?:43|42|39|38|33)\s+MCP\s+tools/i,
      /serves\s+ALL\s+(?:43|42|39|38|33)\s+tools/i
    ]
  },
  {
    relPath: 'scripts/generate_premium_flow_gifs.js',
    mustInclude: [
      `35 canonical MCP tools · 7 coding clients`
    ],
    forbiddenPatterns: [
      /\b(?:43|42|39|38|33)\s+MCP\s+tools\b/i
    ]
  },
  {
    relPath: 'scripts/lib/data.json',
    mustInclude: [
      `Tool Registration (35 Tools)`
    ],
    forbiddenPatterns: [
      /Tool\s+Registration\s+\((?:43|42|39|38|33)\s+Tools\)/i
    ]
  }
];

// Execute validations
for (const item of TRACKED_FILES) {
  const filePath = path.join(ROOT, item.relPath);
  assert(fs.existsSync(filePath), `Tracked file must exist: ${item.relPath}`);
  const content = fs.readFileSync(filePath, 'utf-8');

  // Verify mandatory inclusions
  for (const expected of item.mustInclude) {
    assert(
      content.includes(expected),
      `[${item.relPath}] Missing expected count text: "${expected}"`
    );
  }

  // Verify forbidden stale patterns
  for (const pattern of item.forbiddenPatterns) {
    const match = content.match(pattern);
    assert(
      !match,
      `[${item.relPath}] Stale tool count pattern detected: "${match ? match[0] : ''}"`
    );
  }

  // For ARCHITECTURE.md: verify tool matrix covers all 35 canonical tools
  if (item.verifyMatrix) {
    const tableRegex = /## 🛠️ Canonical Konoha MCP Tools Matrix[\s\S]*?(?=\n###|\n##|\n---)/;
    const tableMatch = content.match(tableRegex);
    assert(tableMatch, `[${item.relPath}] Canonical Konoha MCP Tools Matrix table not found`);
    const tableContent = tableMatch[0];

    // Check that every live canonical tool name is mentioned in the matrix table
    const missingTools = [];
    for (const toolName of liveToolNames) {
      if (!tableContent.includes(`\`${toolName}\``)) {
        missingTools.push(toolName);
      }
    }
    assert.strictEqual(
      missingTools.length,
      0,
      `[${item.relPath}] Tools matrix is missing canonical tools: ${missingTools.join(', ')}`
    );
  }

  console.log(`  ✓ ${item.relPath} matches live count (35) with zero drift`);
}

console.log(`✓ All tracked repo files (${TRACKED_FILES.length} files) match the 35 live canonical tools cleanly!`);
