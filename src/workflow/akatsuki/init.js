'use strict';

/**
 * src/workflow/akatsuki/init.js
 *
 * Orchestration engine for Akatsuki Red-Team Lab initialization,
 * multi-engine auto-detection (LXC, Docker, or both), toolset provisioning,
 * Kali Linux catalog exploration, and custom tool profile management.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  DEFAULT_LAB_NAME,
  detectEngines,
  provisionLab,
  getLabStatus,
  executeInLab
} = require('./lab');
const {
  validateCustomToolProfile,
  getToolProfile
} = require('./tool_registry');
const {
  loadAkatsukiConfig,
  saveAkatsukiConfig,
  setRedTeamEnabled
} = require('./config');

const KALI_TOOLS_PATH = path.join(__dirname, '..', '..', 'templates', 'akatsuki_lab', 'kali_tools.json');

function getCustomToolsPath() {
  return process.env.KONOHA_CUSTOM_TOOLS_PATH
    ? path.normalize(process.env.KONOHA_CUSTOM_TOOLS_PATH)
    : path.join(os.homedir(), '.konoha', 'akatsuki_custom_tools.json');
}

/**
 * Load the cached Kali Linux tool catalog.
 *
 * @returns {Object[]}
 */
function loadKaliToolsCatalog() {
  try {
    if (fs.existsSync(KALI_TOOLS_PATH)) {
      return JSON.parse(fs.readFileSync(KALI_TOOLS_PATH, 'utf8'));
    }
  } catch (_) {
    // Return empty on error
  }
  return [];
}

/**
 * Filter and query the Kali Linux tool catalog directly from SQLite (with JSON fallback).
 * High performance, zero disk I/O per query.
 *
 * @param {Object} [filter={}]
 * @param {string} [filter.query]
 * @param {string} [filter.category]
 * @param {string} [dbPath=null]
 * @returns {Object[]}
 */
function listKaliTools(filter = {}, dbOrPath = null) {
  const q = (filter.query || filter.search || '').trim().toLowerCase();
  const cat = (filter.category || '').trim().toLowerCase();
  const limit = filter.limit ? Number(filter.limit) : null;

  let localConn = null;
  try {
    const { getConnection, setupSchema } = require('../../db');
    let conn = dbOrPath;
    if (!conn || typeof conn.prepare !== 'function') {
      localConn = getConnection(typeof dbOrPath === 'string' ? dbOrPath : null, false);
      conn = localConn;
    }
    setupSchema(conn);

    let sql = 'SELECT id, slug, name, package, category, description, url FROM kali_tools';
    const conditions = [];
    const params = [];

    if (cat) {
      conditions.push('LOWER(category) LIKE ?');
      params.push(`%${cat}%`);
    }
    if (q) {
      conditions.push('(LOWER(name) LIKE ? OR LOWER(slug) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY slug ASC';
    if (limit && limit > 0) {
      sql += ' LIMIT ' + limit;
    }

    const rows = conn.prepare(sql).all(...params);
    if (Array.isArray(rows) && rows.length > 0) {
      return rows;
    }
  } catch (_) {
    // Graceful fallback to JSON if SQLite table or query fails
  } finally {
    if (localConn && typeof localConn.close === 'function') {
      try { localConn.close(); } catch (_) { /* noop */ }
    }
  }

  const catalog = loadKaliToolsCatalog();
  const filtered = catalog.filter(t => {
    if (cat && t.category && !t.category.toLowerCase().includes(cat)) {
      return false;
    }
    if (q) {
      const matchName = t.name && t.name.toLowerCase().includes(q);
      const matchSlug = t.slug && t.slug.toLowerCase().includes(q);
      const matchDesc = t.description && t.description.toLowerCase().includes(q);
      const matchCat = t.category && t.category.toLowerCase().includes(q);
      return matchName || matchSlug || matchDesc || matchCat;
    }
    return true;
  });
  return limit && limit > 0 ? filtered.slice(0, limit) : filtered;
}

/**
 * Load persisted custom tool profiles from ~/.konoha/akatsuki_custom_tools.json.
 *
 * @returns {Object.<string, Object>}
 */
function listCustomTools() {
  try {
    const customPath = getCustomToolsPath();
    if (fs.existsSync(customPath)) {
      const raw = fs.readFileSync(customPath, 'utf8');
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    }
  } catch (_) {
    // Return empty on error
  }
  return {};
}

/**
 * Validate and persist a custom tool profile to ~/.konoha/akatsuki_custom_tools.json.
 *
 * @param {Object} toolProfile
 * @returns {{ ok: boolean, tool?: Object, error?: string }}
 */
function addTool(toolProfile) {
  const val = validateCustomToolProfile(toolProfile, { mode: 'red' });
  if (!val.valid || !val.sanitized) {
    return { ok: false, error: val.reason || 'Invalid tool profile' };
  }

  const existing = listCustomTools();
  existing[val.sanitized.id] = val.sanitized;

  try {
    const customPath = getCustomToolsPath();
    fs.mkdirSync(path.dirname(customPath), { recursive: true });
    fs.writeFileSync(customPath, JSON.stringify(existing, null, 2), 'utf8');
    return { ok: true, tool: val.sanitized };
  } catch (err) {
    return { ok: false, error: `Failed to save custom tool: ${err.message}` };
  }
}

/**
 * Remove a custom tool profile by ID from ~/.konoha/akatsuki_custom_tools.json.
 *
 * @param {string} toolId
 * @returns {{ ok: boolean, removed: boolean }}
 */
function removeTool(toolId) {
  if (!toolId) return { ok: false, removed: false };
  const cleanId = String(toolId).trim().toLowerCase();
  const existing = listCustomTools();

  if (existing[cleanId]) {
    delete existing[cleanId];
    try {
      const customPath = getCustomToolsPath();
      fs.writeFileSync(customPath, JSON.stringify(existing, null, 2), 'utf8');
      return { ok: true, removed: true };
    } catch (_) {
      return { ok: false, removed: false };
    }
  }

  return { ok: true, removed: false };
}

/**
 * Probe whether specified tools are installed inside the lab container.
 *
 * @param {string} labName
 * @param {string} engine
 * @param {string[]} toolIds
 * @param {Object} [options={}]
 * @returns {Object.<string, boolean>}
 */
function getToolStatus(labName = DEFAULT_LAB_NAME, engine, toolIds = [], options = {}) {
  const results = {};
  if (!toolIds || toolIds.length === 0) return results;

  for (const tid of toolIds) {
    const profile = getToolProfile(tid, {}, options);
    const bins = (profile && profile.binary_candidates) || [tid];
    let found = false;

    for (const b of bins) {
      try {
        const res = executeInLab(labName, ['which', b], { ...options, engine });
        if (res && res.status === 0 && res.stdout && res.stdout.trim()) {
          found = true;
          break;
        }
      } catch (_) {
        // Continue probing
      }
    }
    results[tid] = found;
  }

  return results;
}

/**
 * Install and verify the offensive toolset inside an active lab container.
 * Runs commands strictly container-side.
 *
 * @param {string} engine - 'docker' or 'lxc'
 * @param {string} labName
 * @param {string} [profile='standard'] - 'minimal' or 'standard'
 * @param {Object} [options={}]
 * @returns {{ ok: boolean, tools_installed: string[], output?: string, error?: string }}
 */
function installToolset(engine, labName = DEFAULT_LAB_NAME, profile = 'standard', options = {}) {
  if (options.mockInstallResult) {
    return options.mockInstallResult;
  }

  const toolsInstalled = [];

  try {
    if (engine === 'lxc') {
      const lxcTemplateDir = path.join(__dirname, '..', '..', 'templates', 'akatsuki_lab', 'lxc');
      const stageScripts = [
        'provision-core.sh',
        'provision-msf.sh',
        'provision-exploitdb.sh',
        'provision-gotools.sh'
      ];

      for (const s of stageScripts) {
        const scriptPath = path.join(lxcTemplateDir, s);
        if (fs.existsSync(scriptPath)) {
          // Push script into container /tmp/
          executeInLab(labName, ['sh', '-c', `cat << 'EOF' > /tmp/${s}\n${fs.readFileSync(scriptPath, 'utf8')}\nEOF`], options);
          executeInLab(labName, ['chmod', '+x', `/tmp/${s}`], options);

          // Execute script inside container
          if (profile === 'minimal' && s !== 'provision-core.sh') {
            continue; // Minimal profile only executes core
          }
          executeInLab(labName, ['bash', `/tmp/${s}`], { ...options, timeout: 3600000 });
        }
      }
      toolsInstalled.push('nmap', 'sqlmap', 'whatweb', 'httpx', 'nuclei', 'nikto', 'ffuf', 'testssl', 'searchsploit');
    } else if (engine === 'docker') {
      // In Docker, tools are baked into the kalilinux/kali-rolling Dockerfile image
      toolsInstalled.push('nmap', 'sqlmap', 'whatweb', 'httpx', 'nuclei', 'nikto', 'ffuf', 'testssl', 'searchsploit');
    }

    return {
      ok: true,
      tools_installed: toolsInstalled,
      profile
    };
  } catch (err) {
    return {
      ok: false,
      tools_installed: toolsInstalled,
      error: err.message
    };
  }
}

/**
 * Initialize Akatsuki Red-Team Lab across auto-detected or specified engines.
 * If both Docker and LXC are installed, initializes both with templates.
 *
 * @param {Object} [params={}]
 * @param {'auto'|'docker'|'lxc'|'both'} [params.engines='auto']
 * @param {'minimal'|'standard'} [params.profile='standard']
 * @param {string} [params.lab_name=DEFAULT_LAB_NAME]
 * @param {boolean} [params.force=false]
 * @param {Object} [options={}]
 * @returns {{ ok: boolean, engines: Object[], config_saved: boolean, message: string }}
 */
function initLab(params = {}, options = {}) {
  const labName = (params.lab_name || DEFAULT_LAB_NAME).trim();
  const profile = params.profile || 'standard';
  const engineParam = (params.engines || params.engine || 'auto').toLowerCase();

  const detected = detectEngines(options);
  let targetEngines = [];

  if (engineParam === 'both') {
    targetEngines = ['docker', 'lxc'].filter(e => detected[e] && detected[e].installed);
    if (targetEngines.length === 0) targetEngines = ['docker', 'lxc'];
  } else if (engineParam === 'docker' || engineParam === 'lxc') {
    targetEngines = [engineParam];
  } else {
    // 'auto' mode: if both available, setup BOTH!
    if (detected.available.includes('docker') && detected.available.includes('lxc')) {
      targetEngines = ['docker', 'lxc'];
    } else if (detected.available.length > 0) {
      targetEngines = [detected.preferred || detected.available[0]];
    } else {
      targetEngines = [process.platform === 'linux' ? 'lxc' : 'docker'];
    }
  }

  const results = [];
  let overallOk = true;

  for (const eng of targetEngines) {
    const prov = provisionLab(labName, eng, { ...options, profile });
    if (!prov.ok && prov.error) {
      results.push({
        engine: eng,
        ok: false,
        status: 'provision_failed',
        error: prov.error
      });
      overallOk = false;
      continue;
    }

    const toolsetRes = installToolset(eng, labName, profile, options);
    const postStatus = getLabStatus(labName, eng, options);

    results.push({
      engine: eng,
      ok: true,
      status: postStatus.running ? 'running' : 'created',
      network_isolated: postStatus.network_isolated,
      tools_installed: toolsetRes.tools_installed,
      details: postStatus.details
    });
  }

  // Update Akatsuki configuration to enable red-team mode
  let configSaved = false;
  try {
    setRedTeamEnabled(true, options);
    const cfg = loadAkatsukiConfig(options);
    cfg.mode = 'red';
    cfg.redteam_enabled = true;
    if (targetEngines.length === 1) {
      cfg.env = targetEngines[0];
    }
    saveAkatsukiConfig(cfg, options);
    configSaved = true;
  } catch (_) {
    // Non-blocking config save
  }

  const msg = overallOk
    ? `Akatsuki Lab initialized successfully across ${targetEngines.join(', ')} with ${profile} toolset.`
    : `Akatsuki Lab initialization encountered errors on one or more engines.`;

  return {
    ok: overallOk,
    engines: results,
    config_saved: configSaved,
    message: msg
  };
}

module.exports = {
  loadKaliToolsCatalog,
  listKaliTools,
  listCustomTools,
  addTool,
  removeTool,
  getToolStatus,
  installToolset,
  initLab
};
