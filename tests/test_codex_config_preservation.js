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

  // 5. Test D3: Second rewrite keeps the FIRST backup
  // Make a modification to config.toml before 2nd rewrite
  fs.appendFileSync(configPath, '\nsecond_edit = true\n', 'utf-8');
  const result2 = codexManager.registerCodexMcp('python3', '/path/to/server.js', 'uvx', true);
  assert.strictEqual(result2.ok, true, 'Second registerCodexMcp must return ok');

  const bakContentAfterSecond = fs.readFileSync(bakPath, 'utf-8');
  assert.strictEqual(
    bakContentAfterSecond,
    initialUserToml,
    'Second rewrite must keep the FIRST pristine backup byte-for-byte, not overwrite it'
  );

  // 6. Test D3: Custom agents from agents.yaml are written without duplicate tables
  const yamlDir = path.join(tmpHome, '.agents');
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(yamlDir, 'agents.yaml'),
    '- name: yaml_custom_agent\n  purpose: Custom specialized agent from yaml\n'
  );

  // 3rd rewrite with custom agent in yaml
  const result3 = codexManager.registerCodexMcp('python3', '/path/to/server.js', 'uvx', true);
  assert.strictEqual(result3.ok, true, 'Third registerCodexMcp must return ok');

  const contentAfterThird = fs.readFileSync(configPath, 'utf-8');
  assert.ok(
    contentAfterThird.includes('[agents.yaml_custom_agent]'),
    'Custom agent from agents.yaml must be written to config.toml'
  );

  const customAgentMatchesAfterThird = contentAfterThird.match(/\[agents\.yaml_custom_agent\]/g) || [];
  assert.strictEqual(
    customAgentMatchesAfterThird.length,
    1,
    'Custom agent from agents.yaml must be present exactly once (no duplicate tables)'
  );

  // Assert user-owned table is still present exactly once after 3 rewrites
  const userAgentMatchesAfterThird = contentAfterThird.match(/\[agents\.my_custom_agent\]/g) || [];
  assert.strictEqual(
    userAgentMatchesAfterThird.length,
    1,
    'User-owned agent table must be present exactly once after 3 rewrites'
  );

  console.log('test_codex_config_preservation: PASS');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
