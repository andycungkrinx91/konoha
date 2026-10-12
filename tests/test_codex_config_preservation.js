'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate HOME so tests never touch real user dotfiles
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_codex_test_'));
process.env.HOME = tmpHome;

const paths = require('../bin/lib/paths');
const codexManager = require('../src/codex_manager');

try {
  const codexDir = paths.CODEX_DIR;
  const configPath = paths.CODEX_CONFIG;
  const bakPath = `${configPath}.bak`;

  fs.mkdirSync(codexDir, { recursive: true });

  const initialUserToml = [
    'my_user_setting = "preserved_value"',
    '',
    '[agents.my_custom_agent]',
    'description = "User custom specialized agent"',
    'prompt = "You are a user-defined custom agent with custom instructions."',
    'model = "gpt-4o-custom"',
    '',
    '[agents.kage]',
    'description = "Old obsolete kage description"',
    'prompt = "old prompt"'
  ].join('\n');

  fs.writeFileSync(configPath, initialUserToml, 'utf-8');

  // Trigger Codex MCP registration / rewrite
  const result = codexManager.registerCodexMcp('python3', '/path/to/server.js', 'uvx', true);
  assert.strictEqual(result.ok, true, 'registerCodexMcp must return ok');

  // 1. Verify that .bak backup was created byte-for-byte before rewriting
  assert.strictEqual(
    fs.existsSync(bakPath),
    true,
    'writeCodexConfig must write a .bak backup file before overwriting config.toml'
  );
  const bakContent = fs.readFileSync(bakPath, 'utf-8');
  assert.strictEqual(
    bakContent,
    initialUserToml,
    '.bak backup must match original config.toml content byte-for-byte'
  );

  // 2. Verify that user-owned table was preserved byte-for-byte in new config
  const updatedContent = fs.readFileSync(configPath, 'utf-8');

  const expectedUserSection = [
    '[agents.my_custom_agent]',
    'description = "User custom specialized agent"',
    'prompt = "You are a user-defined custom agent with custom instructions."',
    'model = "gpt-4o-custom"'
  ].join('\n');

  assert.ok(
    updatedContent.includes(expectedUserSection),
    'User-owned table [agents.my_custom_agent] must be preserved byte-for-byte'
  );

  assert.ok(
    updatedContent.includes('my_user_setting = "preserved_value"'),
    'User top-level settings must be preserved'
  );

  // 3. Ensure custom agent is not duplicated
  const customAgentMatches = updatedContent.match(/\[agents\.my_custom_agent\]/g) || [];
  assert.strictEqual(
    customAgentMatches.length,
    1,
    'User-owned agent table must not be duplicated'
  );

  // 4. Verify old managed table was stripped and replaced by official Konoha agent
  assert.strictEqual(
    updatedContent.includes('Old obsolete kage description'),
    false,
    'Old managed agent table must be stripped'
  );
  assert.ok(
    updatedContent.includes('Village Leader for architecture decisions'),
    'Official managed kage agent must be configured'
  );

  console.log('test_codex_config_preservation: PASS');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
