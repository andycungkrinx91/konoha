'use strict';

const agentManager = require('../../src/agent_manager');
const { DB_PATH } = require('../lib/paths');
const { fileExists } = require('../../src/platform_utils');
const {
  C,
  header,
  log,
  info,
  success,
  warn,
  error,
  drawTable,
  computeTableWidths,
  applyGradient,
  RASENGAN_THEME
} = require('../lib/format');
const { startAgentModelTui } = require('./agent_tui');

const AVAILABLE_MODELS = [
  { name: 'IBM Granite 3.3 2B (Ollama)', tag: 'Local/Edge', aliases: ['granite', 'granite-2b', 'granite-3.3-2b'] },
  { name: 'IBM Granite 3.3 8B (Ollama)', tag: 'Local/Edge', aliases: ['granite-8b', 'granite-3.3-8b'] },
  { name: 'DeepSeek R1 (Ollama)', tag: 'Local/Reasoning', aliases: ['deepseek-r1', 'r1'] },
  { name: 'Llama 3.3 70B (Ollama)', tag: 'Local/Heavy', aliases: ['llama', 'llama-3.3', 'llama-70b'] },
  { name: 'Qwen 2.5 Coder 7B (Ollama)', tag: 'Local/Code', aliases: ['qwen', 'qwen-coder', 'qwen-7b'] },
  { name: 'Qwen 2.5 Coder 32B (Ollama)', tag: 'Local/Code', aliases: ['qwen-32b', 'qwen-coder-32b'] },
  { name: 'Google Gemini 2.5 Flash', tag: 'Fast', aliases: ['gemini', 'gemini-flash', 'gemini-2.5-flash'] },
  { name: 'Google Gemini 2.5 Pro', tag: 'Standard', aliases: ['gemini-pro', 'gemini-2.5-pro'] },
  { name: 'OpenAI GPT-4.1', tag: 'Standard', aliases: ['gpt-4.1', 'gpt4'] },
  { name: 'OpenAI o3-mini', tag: 'Reasoning', aliases: ['o3-mini', 'o3'] },
  { name: 'OpenAI o4-mini', tag: 'Reasoning', aliases: ['o4-mini', 'o4'] },
  { name: 'Claude Haiku 4.5', tag: 'Fast', aliases: ['haiku', 'haiku-4.5', 'claude-haiku-4.5'] },
  { name: 'Claude Sonnet 4.6 (Thinking)', tag: 'Reasoning', aliases: ['sonnet', 'sonnet-4.6', 'claude-sonnet-4.6', 'sonnet-thinking'] },
  { name: 'Claude Opus 4.6 (Thinking)', tag: 'Advanced', aliases: ['opus', 'opus-4.6', 'claude-opus-4.6', 'opus-thinking'] }
];

function loadBridges() {
  if (!fileExists(DB_PATH)) return [];
  try {
    const Database = require('../../src/sqlite_driver');
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare('SELECT * FROM bridges ORDER BY name ASC').all();
    db.close();
    return rows;
  } catch {
    return [];
  }
}

function handleBridgeModelsResponse(res, resolveInner) {
  let d = '';
  res.on('data', c => { d += c; });
  res.on('end', () => {
    try {
      resolveInner(JSON.parse(d));
    } catch {
      resolveInner(null);
    }
  });
}

function sendBridgeModelsRequest(mod, url, headers, resolveInner) {
  const req = mod.get(url, { headers }, (res) => handleBridgeModelsResponse(res, resolveInner));
  req.on('error', () => resolveInner(null));
  req.setTimeout(8000, () => {
    req.destroy();
    resolveInner(null);
  });
}

function querySingleBridgeModels(bridge) {
  const targetPath = bridge.targetUrl.endsWith('/v1') ? `${bridge.targetUrl}/models` : bridge.targetUrl;
  const parsed = new URL(targetPath);
  const mod = parsed.protocol === 'https:' ? require('https') : require('http');
  const url = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
  const headers = {};
  if (bridge.apiKey) headers['Authorization'] = `Bearer ${bridge.apiKey}`;

  return new Promise((resolveInner) => {
    sendBridgeModelsRequest(mod, url, headers, resolveInner);
  });
}

function tagForModelId(id) {
  if (id.includes('claude')) return 'Reasoning';
  if (id.includes('gpt')) return 'Standard';
  if (id.includes('gemini')) {
    return id.includes('flash') ? 'Fast' : 'Standard';
  }
  return 'Bridge';
}

function appendBridgeModels(bridge, targetJson, existing, models) {
  if (!targetJson || !Array.isArray(targetJson.data)) return;
  for (const m of targetJson.data) {
    const id = m.id;
    const prefixedId = `${bridge.name}-${id}`;
    if (!existing.has(prefixedId.toLowerCase())) {
      const tag = tagForModelId(id);
      models.push({ name: prefixedId, tag, aliases: [prefixedId.toLowerCase()] });
      existing.add(prefixedId.toLowerCase());
    }
  }
}

async function getActiveModels() {
  const models = [...AVAILABLE_MODELS];
  const bridges = loadBridges();
  const existing = new Set(models.map(m => m.name.toLowerCase()));

  const bridgeList = bridges.filter(b => b.enabled && b.targetUrl);
  const bridgeTargets = bridgeList.map(b => querySingleBridgeModels(b));
  const targets = await Promise.all(bridgeTargets);

  for (let i = 0; i < targets.length; i++) {
    appendBridgeModels(bridgeList[i], targets[i], existing, models);
  }
  return models;
}

function parseModelSubArgs(subArgs) {
  const cleaned = [];
  let directModel;
  for (let i = 0; i < subArgs.length; i++) {
    if (subArgs[i] === '--model' && subArgs[i + 1]) {
      directModel = subArgs[++i];
      continue;
    }
    if (subArgs[i] === 'config') continue;
    cleaned.push(subArgs[i]);
  }
  return { cleaned, directModel };
}

function findTargetAgent(agentNameArg, agents) {
  if (!agentNameArg) return null;
  const target = agents.find(a => a.name.toLowerCase() === agentNameArg.toLowerCase());
  if (!target) {
    error(`Subagent "@${agentNameArg}" not found.`);
    process.exit(1);
  }
  return target;
}

function applyDirectAgentModel(targetAgent, directModel, models) {
  if (!targetAgent) {
    error('Usage: konoha agent models config <agent-name> --model <model-id>');
    process.exit(1);
  }
  const isClear = directModel === 'inherit' || directModel === 'none';
  const matched = models.find(m => m.name === directModel || (m.aliases || []).includes(directModel.toLowerCase()));
  const modelId = isClear ? null : (matched?.name || directModel);
  try {
    agentManager.updateAgentModel(targetAgent.name, modelId);
    success(modelId
      ? `Model "${modelId}" assigned to @${targetAgent.name}. Configurations re-deployed.`
      : `Model assignment cleared for @${targetAgent.name} (inherit). Configurations re-deployed.`);
  } catch (err) {
    error(`Failed to set model: ${err.message}`);
    process.exit(1);
  }
}

function renderPlainAgentModelsTable(agents, targetAgent) {
  header('Subagent Model Assignments');
  const headers = ['Subagent', 'Title', 'Current Model'];
  const rows = (targetAgent ? [targetAgent] : agents).map(a => [
    `${a.icon || '👤'} @${a.name}`,
    a.title || 'Ninja',
    a.model || 'inherit'
  ]);
  const widths = computeTableWidths(headers, rows, { minWidths: [15, 12, 12] });
  drawTable(headers, widths, ['left', 'left', 'left'], rows, [], RASENGAN_THEME, {
    columnFormatters: [
      (cell) => applyGradient(cell.trimEnd(), RASENGAN_THEME, 0.9) + cell.slice(cell.trimEnd().length),
      (cell) => cell,
      (cell) => `${C.green}${cell}${C.reset}`
    ]
  });
  info('Tip: Run interactively in a TTY (konoha agent models config) or use: konoha agent models config <agent> --model <model-id>');
}

function isInteractiveSession(subArgs) {
  const isPlain = subArgs.includes('--plain') || subArgs.includes('--table') || subArgs.includes('--no-tui');
  return Boolean(
    process.stdin &&
    process.stdin.isTTY &&
    process.stdout &&
    process.stdout.isTTY &&
    typeof process.stdin.setRawMode === 'function' &&
    !isPlain &&
    !process.env.CI &&
    !process.env.NON_INTERACTIVE
  );
}

async function cmdAgentModels(subArgs) {
  const { cleaned, directModel } = parseModelSubArgs(subArgs);
  const agents = agentManager.loadAgents(false, true);
  if (agents.length === 0) {
    warn('No subagents found.');
    return;
  }

  const targetAgent = findTargetAgent(cleaned[0], agents);
  const models = await getActiveModels();
  if (models.length === 0) {
    warn('No bridge-served models found. Run "konoha bridge models" or start/configure bridges first.');
    return;
  }

  if (directModel !== undefined) {
    applyDirectAgentModel(targetAgent, directModel, models);
    return;
  }

  if (!isInteractiveSession(subArgs)) {
    renderPlainAgentModelsTable(agents, targetAgent);
    return;
  }

  const selection = await startAgentModelTui(targetAgent ? [targetAgent] : agents, models);
  if (!selection) {
    log('  Model config cancelled.');
    return;
  }

  try {
    agentManager.updateAgentModel(selection.agent.name, selection.model ? selection.model.name : null);
    success(selection.model
      ? `Model "${selection.model.name}" assigned to @${selection.agent.name}. Configurations re-deployed.`
      : `Model assignment cleared for @${selection.agent.name} (inherit). Configurations re-deployed.`);
  } catch (err) {
    error(`Failed to set model: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  AVAILABLE_MODELS,
  loadBridges,
  getActiveModels,
  cmdAgentModels
};
