'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

function getUvxCommand() {
  const isWin = process.platform === 'win32';
  const uvCmd = isWin ? 'uv.exe' : 'uv';
  try {
    const res = spawnSync(uvCmd, ['--version'], { encoding: 'utf-8', timeout: 2000, shell: isWin });
    if (res.status === 0) {
      return isWin ? 'uvx.exe' : 'uvx';
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  return isWin ? 'uvx.exe' : 'uvx';
}

function isUvxUsable(uvxCmd) {
  try {
    const res = spawnSync(uvxCmd, ['--version'], {
      encoding: 'utf-8',
      timeout: 3000,
      shell: process.platform === 'win32'
    });
    return res.status === 0;
  } catch (_) {
    return false;
  }
}

function getSembleStatus() {
  const uvxCmd = getUvxCommand();
  const home = os.homedir();
  const cursorMcp = path.join(home, '.cursor', 'mcp.json');
  const antigravityMcp = path.join(home, '.gemini', 'config', 'mcp_config.json');

  let configured = false;
  try {
    if (fs.existsSync(cursorMcp)) {
      const content = fs.readFileSync(cursorMcp, 'utf-8');
      if (content.includes('semble')) configured = true;
    }
    if (!configured && fs.existsSync(antigravityMcp)) {
      const content = fs.readFileSync(antigravityMcp, 'utf-8');
      if (content.includes('semble')) configured = true;
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the runtime */ }

  return {
    name: 'Semble MCP',
    package: 'semble[mcp]@latest',
    engine: 'Semantic Code Search (Neural Embedding + Vector Index)',
    command: `${uvxCmd} --from semble[mcp]@latest semble`,
    configured,
    available: isUvxUsable(uvxCmd),
    features: ['search', 'find_related'],
    reduction_ratio: '98%',
    description: 'Semantic code search engine using ~98% fewer tokens than raw grep and direct file dumping.'
  };
}

let cachedSembleSavings = null;
let lastSembleSavingsFetch = 0;
const SEMBLE_SAVINGS_TTL_MS = 60000;

function getSembleSavings() {
  if (cachedSembleSavings && (Date.now() - lastSembleSavingsFetch < SEMBLE_SAVINGS_TTL_MS)) {
    return cachedSembleSavings;
  }

  const uvxCmd = getUvxCommand();
  let stdout = '';

  const candidates = [
    { cmd: 'semble', args: ['savings'], timeout: 1500 },
    { cmd: uvxCmd, args: ['semble', 'savings'], timeout: 2000 },
    { cmd: uvxCmd, args: ['--from', 'semble[mcp]@latest', 'semble', 'savings'], timeout: 3000 }
  ];

  for (const c of candidates) {
    try {
      const res = spawnSync(c.cmd, c.args, {
        encoding: 'utf-8',
        timeout: c.timeout,
        shell: process.platform === 'win32'
      });
      if (res.status === 0 && res.stdout && res.stdout.includes('Semble Token Savings')) {
        stdout = res.stdout;
        break;
      }
    } catch (_) { /* intentional best-effort fallback: failure here must never crash the runtime */ }
  }

  const result = {
    available: !!stdout,
    total_saved: '0 tokens',
    total_saved_pct: 0,
    total_calls: '0',
    today: { calls: 0, tokens_saved: '0 tokens', ratio_pct: 0 },
    last_7_days: { calls: 0, tokens_saved: '0 tokens', ratio_pct: 0 },
    all_time: { calls: 0, tokens_saved: '0 tokens', ratio_pct: 0 },
    call_types: []
  };

  if (!stdout) {
    return result;
  }

  try {
    const lines = stdout.split('\n');
    for (const line of lines) {
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (!clean) continue;

      if (/Total saved:\s*~?([0-9.kKmM]+)\s+tokens(?:\s*\((\d+)%\))?/i.test(clean)) {
        const m = clean.match(/Total saved:\s*~?([0-9.kKmM]+)\s+tokens(?:\s*\((\d+)%\))?/i);
        result.total_saved = `${m[1]} tokens`;
        if (m[2]) result.total_saved_pct = parseInt(m[2], 10);
      }
      if (/Total calls:\s*([0-9.kKmM]+)/i.test(clean)) {
        const m = clean.match(/Total calls:\s*([0-9.kKmM]+)/i);
        result.total_calls = m[1];
      }
      if (/Efficiency:\s*.*?\s*(\d+)%/i.test(clean)) {
        const m = clean.match(/Efficiency:\s*.*?\s*(\d+)%/i);
        result.total_saved_pct = parseInt(m[1], 10);
      }

      const semMatch = clean.match(/^(Today|Last\s+7\s+days|All\s+time)\s+(\d+\.?\d*)([kKmM]?)(?:\s+(?:calls|searches?))?\s+(?:~?)(\d+\.?\d*)([kKmM]?)\s+tokens(?:\s+\((\d+)%\))?(?:.*?(\d+)%)?/i);
      if (semMatch) {
        const period = semMatch[1];
        const rawCalls = parseFloat(semMatch[2]);
        const callUnit = (semMatch[3] || '').toLowerCase();
        const explicitPct = parseInt(semMatch[6], 10);
        const trailingPct = parseInt(semMatch[7], 10);
        const pct = explicitPct || trailingPct || 0;

        const calls = callUnit === 'm' ? Math.round(rawCalls * 1000000) : (callUnit === 'k' ? Math.round(rawCalls * 1000) : Math.round(rawCalls));
        const tokenFormatted = `~${semMatch[4]}${semMatch[5] || ''} tokens`;

        if (period.startsWith('Today')) {
          result.today = { calls, tokens_saved: tokenFormatted, ratio_pct: pct };
        } else if (period.startsWith('Last')) {
          result.last_7_days = { calls, tokens_saved: tokenFormatted, ratio_pct: pct };
        } else {
          result.all_time = { calls, tokens_saved: tokenFormatted, ratio_pct: pct };
        }
      }

      const callTypeMatch = clean.match(/^\d+\.\s+(\w+)\s+([0-9.kKmM]+)\s+.*?\s+(\d+)%/i);
      if (callTypeMatch) {
        result.call_types.push({
          name: callTypeMatch[1],
          calls: callTypeMatch[2],
          share_pct: parseInt(callTypeMatch[3], 10)
        });
      }
    }
  } catch (_) { /* intentional best-effort fallback: failure here must never crash the runtime */ }

  cachedSembleSavings = result;
  lastSembleSavingsFetch = Date.now();
  return result;
}

function searchSemble(query, searchPath = process.cwd(), topK = 5) {
  if (!query || !query.trim()) return { results: [], query: '' };
  const uvxCmd = getUvxCommand();
  const k = Math.min(Math.max(parseInt(topK, 10) || 5, 1), 20);

  try {
    const res = spawnSync(uvxCmd, ['--from', 'semble[mcp]@latest', 'semble', 'search', query.trim(), searchPath, '-k', String(k)], {
      encoding: 'utf-8',
      timeout: 8000,
      shell: process.platform === 'win32'
    });
    if (res.status === 0 && res.stdout) {
      const lines = res.stdout.split('\n');
      const results = [];
      let current = null;

      for (const line of lines) {
        if (line.startsWith('#') || line.match(/^[0-9]+\.\s+/)) {
          if (current) results.push(current);
          current = { title: line.trim(), snippet: '' };
        } else if (current) {
          current.snippet += (current.snippet ? '\n' : '') + line;
        }
      }
      if (current) results.push(current);

      return {
        query,
        raw: res.stdout,
        results: results.length > 0 ? results : [{ title: 'Results found', snippet: res.stdout }]
      };
    }
    return { query, raw: res.stdout || res.stderr || 'No results found', results: [] };
  } catch (err) {
    return { query, error: err.message, results: [] };
  }
}

module.exports = {
  getSembleStatus,
  getSembleSavings,
  searchSemble
};
