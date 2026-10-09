/**
 * Public Tunnel Process Supervisor.
 * Manages lifecycle of cloudflared and ngrok child processes, captures assigned public URLs,
 * and maintains status in SQLite table tunnel_config.
 */

'use strict';

const { spawn } = require('child_process');
const configModule = require('./config');

let activeChild = null;
let currentPublicUrl = '';

function getTunnelStatus() {
  const config = configModule.getTunnelConfig();
  let isRunning = false;

  if (activeChild && !activeChild.killed) {
    isRunning = true;
  } else if (config.active_pid > 0) {
    try {
      // Check if PID is still alive
      process.kill(config.active_pid, 0);
      isRunning = true;
    } catch (_) {
      isRunning = false;
    }
  }

  return {
    enabled: isRunning ? 1 : 0,
    provider: config.provider,
    mode: config.mode,
    public_url: isRunning ? (currentPublicUrl || config.public_url) : '',
    active_pid: isRunning ? (activeChild ? activeChild.pid : config.active_pid) : 0,
    custom_domain: config.custom_domain,
    has_pin: !!config.auth_pin,
    started_at: isRunning ? config.started_at : null
  };
}

/**
 * Start a public ingress tunnel.
 */
async function startTunnel(options = {}) {
  const existingStatus = getTunnelStatus();
  if (existingStatus.enabled) {
    return existingStatus;
  }

  const config = configModule.getTunnelConfig();
  const provider = options.provider || config.provider || 'cloudflare';
  const port = options.port || 1404;
  const token = options.token !== undefined ? options.token : config.token;
  const domain = options.custom_domain || options.domain || config.custom_domain;

  // Enforce zero unauthenticated tunnels: auto-generate secure PIN if none configured
  let authPin = config.auth_pin;
  if (!authPin) {
    authPin = String(Math.floor(100000 + Math.random() * 900000));
    configModule.saveTunnelConfig({ auth_pin: authPin });
  }

  if (options.token !== undefined || options.domain !== undefined || options.custom_domain !== undefined) {
    configModule.saveTunnelConfig({
      token,
      custom_domain: domain,
      provider,
      auth_pin: authPin
    });
  }

  let cmd = 'cloudflared';
  let args = [];

  if (provider === 'cloudflare') {
    if (token) {
      args = ['tunnel', 'run', '--token', token];
    } else {
      args = ['tunnel', '--url', `http://127.0.0.1:${port}`];
    }
  } else if (provider === 'ngrok') {
    cmd = 'ngrok';
    args = ['http', String(port)];
  } else {
    throw new Error(`Unsupported tunnel provider: ${provider}`);
  }

  return new Promise((resolve, reject) => {
    let resolved = false;

    try {
      activeChild = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new Error(`Failed to spawn ${cmd}: ${err.message}`));
    }

    const pid = activeChild.pid;
    const now = new Date().toISOString();

    const onData = (data) => {
      const text = data.toString();

      const commitPublicUrl = (url) => {
        currentPublicUrl = url;
        configModule.saveTunnelConfig({
          enabled: 1,
          provider,
          public_url: currentPublicUrl,
          active_pid: pid,
          started_at: now
        });
        if (!resolved) {
          resolved = true;
          resolve(getTunnelStatus());
        }
      };

      // Look for Cloudflare trycloudflare URL
      const cfMatch = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (cfMatch) {
        commitPublicUrl(cfMatch[0]);
      }

      // Look for custom domain or connection confirmations
      if (text.includes('Registered tunnel connection') || (text.includes('Connection') && text.includes('registered'))) {
        const assignedDomain = domain ? ['https', domain].join('://') : 'Cloudflare Tunnel (Active via Token)';
        commitPublicUrl(assignedDomain);
      }
    };

    activeChild.stdout.on('data', onData);
    activeChild.stderr.on('data', onData);

    activeChild.on('error', (err) => {
      stopTunnel();
      if (!resolved) {
        resolved = true;
        reject(new Error(`Tunnel process error (${cmd}): ${err.message}`));
      }
    });

    activeChild.on('exit', () => {
      stopTunnel();
    });

    // Timeout fallback for named tunnels or slower starts
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const fallbackDomain = domain ? ['https', domain].join('://') : (token ? 'Cloudflare Tunnel (Active via Token)' : '');
        const assignedUrl = currentPublicUrl || fallbackDomain;
        configModule.saveTunnelConfig({
          enabled: 1,
          provider,
          public_url: assignedUrl,
          active_pid: pid,
          started_at: now
        });
        resolve(getTunnelStatus());
      }
    }, 4000);
  });
}

/**
 * Stop active public tunnel.
 */
function stopTunnel() {
  const config = configModule.getTunnelConfig();

  if (activeChild && !activeChild.killed) {
    try {
      activeChild.kill('SIGTERM');
    } catch (_killErr) {
      /* ignore error when killing child */
    }
    activeChild = null;
  }

  if (config.active_pid > 0) {
    try {
      process.kill(config.active_pid, 'SIGTERM');
    } catch (_procErr) {
      /* ignore error when killing active pid */
    }
  }

  currentPublicUrl = '';
  configModule.saveTunnelConfig({
    enabled: 0,
    public_url: '',
    active_pid: 0,
    started_at: null
  });

  return getTunnelStatus();
}

// Clean up child on process exit
process.on('exit', () => {
  if (activeChild && !activeChild.killed) {
    try {
      activeChild.kill('SIGTERM');
    } catch (_exitErr) {
      /* ignore error on exit cleanup */
    }
  }
});

module.exports = {
  getTunnelStatus,
  startTunnel,
  stopTunnel
};
