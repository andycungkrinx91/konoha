#!/usr/bin/env node
'use strict';

/**
 * sync_canonical_api.js
 * Automatically generates and verifies Section 1 of docs/architecture/CANONICAL-API.md
 * from the live listToolSchemas() definition in src/file_tools_router.js.
 *
 * Usage:
 *   node scripts/sync_canonical_api.js         # Updates CANONICAL-API.md in-place
 *   node scripts/sync_canonical_api.js --check # Exits with 0 if in sync, 1 if drift detected
 */

const fs = require('fs');
const path = require('path');
const { listToolSchemas } = require('../src/file_tools_router');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_API_PATH = path.join(ROOT, 'docs', 'architecture', 'CANONICAL-API.md');

// Returns standard return description based on tool name
function getReturnDescription(toolName) {
  const returnTypes = {
    read_file_head: 'Line-numbered text content',
    read_file_range: 'Line-numbered text content',
    file_info: 'JSON metadata object',
    token_efficient_grep: 'JSON match array with line numbers',
    get_file_structure: 'ASCII directory tree',
    find_files_clean: 'JSON file list object',
    website_ai_detector: 'Heuristic score object',
    docs_ai_detector: 'Heuristic score object (0-100)',
    get_resolved_task_dir: 'Absolute path string',
    find_skill: 'JSON array of matched skills & snippets',
    list_skills: 'JSON array of skill records',
    get_skill: 'Markdown skill text with section metadata',
    optimize_report: 'Formatted skill token analysis',
    build_from_source: 'Structured JSON specification',
    build_from_text: 'Structured JSON specification',
    sannin: 'Structured task result JSON',
    kage: 'Confidence report & verdict JSON',
    jonin: 'UI implementation results JSON',
    anbu: 'Backend implementation results JSON',
    chunin: 'Citation-backed report JSON',
    tokubetsu_jonin: 'Generated documentation JSON',
    genin: 'Structured exploration report JSON',
    report_from_agent: 'Checkpoint confirmation JSON',
    get_project_context: 'JSON context object',
    save_project_context: 'Save confirmation JSON',
    query_project_memory: 'JSON match list',
    web_search: 'Search result JSON with citations',
    migrate_skills: 'Migration summary JSON',
    save_persona_memory: 'Record ID confirmation',
    query_persona_memory: 'Matched persona records JSON',
    list_persona_memories: 'Persona record list JSON',
    delete_persona_memory: 'Deletion confirmation JSON',
    check_readiness: 'Gate approval status JSON',
    get_task_evidence: 'Evidence log JSON',
    get_slop_findings: 'Anti-slop scanner report JSON'
  };
  return returnTypes[toolName] || 'JSON result object';
}

function formatParameters(schema) {
  const inputSchema = schema.inputSchema || {};
  const props = inputSchema.properties || {};
  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];

  const paramParts = Object.keys(props).map(paramName => {
    const prop = props[paramName];
    const isRequired = required.includes(paramName);
    const type = prop.type || (prop.items ? 'array' : 'any');
    return isRequired ? `${paramName}: ${type}` : `${paramName}?: ${type}`;
  });

  return paramParts.length > 0 ? paramParts.join(', ') : 'none';
}

function generateSection1() {
  const schemas = listToolSchemas();
  const rows = [
    '## 1. Canonical MCP Tools (Active Advertised Roster)',
    '',
    `All tools (${schemas.length} active) are served through the \`konoha\` MCP server over stdio JSON-RPC.`,
    '',
    '| Tool Name | Parameters | Purpose | Return Schema |',
    '|---|---|---|---|'
  ];

  for (const schema of schemas) {
    const params = formatParameters(schema);
    const desc = (schema.description || '').replace(/\|/g, '\\|');
    const returnDesc = getReturnDescription(schema.name);
    rows.push(`| \`${schema.name}\` | \`${params}\` | ${desc} | ${returnDesc} |`);
  }

  return rows.join('\n');
}

function syncCanonicalApi(checkOnly = false) {
  if (!fs.existsSync(CANONICAL_API_PATH)) {
    throw new Error(`CANONICAL-API.md not found at ${CANONICAL_API_PATH}`);
  }

  const existingContent = fs.readFileSync(CANONICAL_API_PATH, 'utf8');
  const section1Start = existingContent.indexOf('## 1. Canonical MCP Tools');
  const section2Divider = existingContent.indexOf('\n---\n\n## 2. Canonical Subagents Roster');

  if (section1Start === -1 || section2Divider === -1) {
    throw new Error('Could not find Section 1 or Section 2 boundary in CANONICAL-API.md');
  }

  const newSection1 = generateSection1();
  const existingSection1 = existingContent.substring(section1Start, section2Divider).trim();

  // Normalize newlines for strict comparison
  const normExisting = existingSection1.replace(/\r\n/g, '\n');
  const normNew = newSection1.trim().replace(/\r\n/g, '\n');

  if (checkOnly) {
    if (normExisting !== normNew) {
      console.error('❌ CANONICAL-API.md Section 1 is out of sync with live listToolSchemas()!');
      console.error('\nRun `node scripts/sync_canonical_api.js` to update CANONICAL-API.md automatically.');
      process.exit(1);
    }
    console.log(`✓ CANONICAL-API.md is in exact sync with live listToolSchemas() (${listToolSchemas().length} tools).`);
    return true;
  }

  // Update in place
  const updatedContent = existingContent.substring(0, section1Start) +
    newSection1 +
    existingContent.substring(section2Divider);

  fs.writeFileSync(CANONICAL_API_PATH, updatedContent, 'utf8');
  console.log(`✓ Successfully updated CANONICAL-API.md Section 1 from live listToolSchemas() (${listToolSchemas().length} tools).`);
  return true;
}

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  try {
    syncCanonicalApi(checkOnly);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { syncCanonicalApi, generateSection1 };
