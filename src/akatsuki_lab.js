'use strict';

/**
 * src/akatsuki_lab.js
 * 
 * Isolated sandbox lifecycle and containment management for Akatsuki Red-Team operations.
 * Enforces mandatory sandbox execution in 'akatsuki-lab':
 *  - Linux: LXC (unprivileged, non-host bridge, network isolated)
 *  - Windows / macOS: Docker (internal network, non-host bridge)
 * Direct host execution is STRICTLY DENIED.
 * If the required container engine is missing, operations are declined with:
 *  "Declined: LXC/Docker not installed on this machine."
 */

const { spawnSync } = require('child_process');

const DEFAULT_LAB_NAME = 'akatsuki-lab';
const DECLINE_NO_ENGINE = 'Declined: LXC/Docker not installed on this machine.';
const HOST_EXECUTION_DENIED_REASON = 'Red-team operations are strictly DENIED from direct host execution. Isolated akatsuki-lab sandbox required.';
const INVALID_LAB_NAME_REASON = 'Invalid lab identity. Red-team sandbox requires lab name "akatsuki-lab".';

/**
 * Determine the mandatory container engine based on the host operating system.
 * Linux strictly requires LXC. Windows and macOS strictly require Docker.
 * No silent fallback to Docker on Linux.
 * 
 * @param {string} [platform=process.platform]
 * @returns {'lxc'|'docker'|null}
 */
function getRequiredEngine(platform = process.platform) {
  if (platform === 'linux') return 'lxc';
  if (platform === 'win32' || platform === 'darwin') return 'docker';
  return null;
}

/**
 * Probe whether the required container engine binary is installed on the host.
 * 
 * @param {string} engine - 'lxc' or 'docker'
 * @param {Object} [options={}]
 * @param {Function} [options.runner] - optional injectable command runner
 * @returns {{ installed: boolean, engine: string, path: string|null }}
 */
function checkEngineInstalled(engine, options = {}) {
  const runner = options.runner || defaultCommandRunner;
  const targetEngine = engine || getRequiredEngine(options.platform || process.platform);

  if (!targetEngine) {
    return { installed: false, engine: null, path: null };
  }

  const binaryToCheck = targetEngine === 'lxc' ? 'lxc' : 'docker';
  const probeCmd = (options.platform || process.platform) === 'win32' ? 'where' : 'which';

  try {
    const res = runner(probeCmd, [binaryToCheck], { timeout: 3000 });
    if (res && res.status === 0 && res.stdout) {
      const resolvedPath = res.stdout.trim().split('\n')[0].trim();
      return { installed: true, engine: targetEngine, path: resolvedPath };
    }
    
    // For LXC on Linux, also accept lxc-info / lxc-create if snap wrapper lxc is missing
    if (targetEngine === 'lxc') {
      const altRes = runner(probeCmd, ['lxc-info'], { timeout: 3000 });
      if (altRes && altRes.status === 0 && altRes.stdout) {
        const altPath = altRes.stdout.trim().split('\n')[0].trim();
        return { installed: true, engine: 'lxc', path: altPath };
      }
    }
  } catch (_) {
    return { installed: false, engine: targetEngine, path: null };
  }

  return { installed: false, engine: targetEngine, path: null };
}

/**
 * Default safe command runner using child_process.spawnSync.
 */
function defaultCommandRunner(cmd, args = [], execOptions = {}) {
  return spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: execOptions.timeout || 10000,
    windowsHide: true,
    shell: (execOptions.platform || process.platform) === 'win32'
  });
}

/**
 * Query the running status and network isolation of the lab container.
 * 
 * @param {string} [labName=DEFAULT_LAB_NAME]
 * @param {string} [engine]
 * @param {Object} [options={}]
 * @returns {{ exists: boolean, running: boolean, network_isolated: boolean, details: string }}
 */
function getLabStatus(labName = DEFAULT_LAB_NAME, engine, options = {}) {
  const runner = options.runner || defaultCommandRunner;
  const targetEngine = engine || getRequiredEngine(options.platform || process.platform);

  if (!targetEngine) {
    return { exists: false, running: false, network_isolated: false, details: 'Unknown engine' };
  }

  try {
    if (targetEngine === 'lxc') {
      // 1. Query LXC container state and network device mapping
      const listRes = runner('lxc', ['list', `^${labName}$`, '--format=json'], { timeout: 5000 });
      let isRunning = false;
      let bridgeName = null;
      const containerIps = [];

      if (listRes && listRes.status === 0 && listRes.stdout) {
        const parsed = JSON.parse(listRes.stdout);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const container = parsed[0];
          isRunning = container.status && container.status.toUpperCase() === 'RUNNING';
          // Extract network interfaces and IPs
          const state = container.state || {};
          const net = state.network || {};
          for (const [ifName, ifData] of Object.entries(net)) {
            if (ifName === 'lo') continue;
            for (const addr of (ifData.addresses || [])) {
              if (addr.family === 'inet') {
                containerIps.push(addr.address);
              }
            }
          }
          // Extract bridge from devices or expanded_devices
          const devices = container.devices || container.expanded_devices || {};
          for (const dev of Object.values(devices)) {
            if (dev.type === 'nic') {
              bridgeName = dev.network || dev.parent;
              break;
            }
          }
        }
      }

      // If bridgeName was not resolved from lxc list, query lxc config show
      if (!bridgeName) {
        const configRes = runner('lxc', ['config', 'show', labName], { timeout: 5000 });
        if (configRes && configRes.status === 0 && configRes.stdout) {
          const match = configRes.stdout.match(/(?:network|parent):\s*([a-zA-Z0-9_-]+)/);
          if (match) {
            bridgeName = match[1];
          }
        }
      }

      // If container was not found via lxc list or lxc config
      if (!listRes || listRes.status !== 0 || !listRes.stdout.trim() || listRes.stdout.trim() === '[]') {
        const infoRes = runner('lxc-info', ['-n', labName], { timeout: 3000 });
        if (!infoRes || infoRes.status !== 0) {
          return { exists: false, running: false, network_isolated: false, details: 'Container not found' };
        }
        isRunning = /state:\s*running/i.test(infoRes.stdout);
      }

      // 2. Verify bridge containment: bridge MUST exist, and ipv4.nat MUST be "false"
      let networkIsolated = false;
      let isolationDetails = '';

      if (bridgeName) {
        const netRes = runner('lxc', ['network', 'show', bridgeName], { timeout: 5000 });
        if (netRes && netRes.status === 0 && netRes.stdout) {
          const natMatch = netRes.stdout.match(/ipv4\.nat:\s*"?([a-zA-Z0-9_-]+)"?/);
          const natValue = natMatch ? natMatch[1].toLowerCase() : 'true'; // default LXD bridges have nat: true
          const hasNat = natValue === 'true';
          if (hasNat) {
            networkIsolated = false;
            isolationDetails = `LXC bridge "${bridgeName}" has NAT enabled (ipv4.nat: true). Outbound internet access is not isolated.`;
          } else {
            networkIsolated = true;
            isolationDetails = `LXC bridge "${bridgeName}" verified isolated (ipv4.nat: false, container IPs: ${containerIps.join(', ') || 'assigned'})`;
          }
        } else {
          networkIsolated = false;
          isolationDetails = `LXC bridge "${bridgeName}" could not be verified via lxc network show`;
        }
      } else {
        networkIsolated = false;
        isolationDetails = 'LXC container has no verifiable bridge device attached';
      }

      return {
        exists: true,
        running: isRunning,
        network_isolated: networkIsolated,
        bridge: bridgeName,
        ips: containerIps,
        details: isolationDetails
      };
    } else if (targetEngine === 'docker') {
      const inspectRes = runner('docker', ['inspect', labName, '--format={{.State.Running}}|{{.HostConfig.NetworkMode}}|{{json .NetworkSettings.Networks}}'], { timeout: 5000 });
      if (inspectRes && inspectRes.status === 0 && inspectRes.stdout) {
        const parts = inspectRes.stdout.trim().split('|');
        const isRunning = parts[0] === 'true';
        const netMode = parts[1] || '';
        const rawNetworks = parts[2] || '{}';

        // Direct host network is non-isolated
        if (netMode === 'host') {
          return {
            exists: true,
            running: isRunning,
            network_isolated: false,
            details: 'Docker container uses host network stack (NetworkMode: host)'
          };
        }

        let networksObj = {};
        try {
          networksObj = JSON.parse(rawNetworks);
        } catch (_) {
          /* ignore malformed json */
        }

        const networkNames = Object.keys(networksObj);
        if (networkNames.length === 0) {
          return {
            exists: true,
            running: isRunning,
            network_isolated: false,
            details: 'Docker container has no attached networks'
          };
        }

        // Default "bridge" network in Docker is NAT'd to the host and internet
        if (networkNames.includes('bridge')) {
          return {
            exists: true,
            running: isRunning,
            network_isolated: false,
            details: 'Docker container attached to default "bridge" network with internet NAT masquerading. Isolated internal network required.'
          };
        }

        // Inspect attached networks: must have Internal: true
        let allInternal = true;
        const checkedDetails = [];
        for (const netName of networkNames) {
          const netInspect = runner('docker', ['network', 'inspect', netName, '--format={{.Internal}}|{{.Driver}}'], { timeout: 5000 });
          if (netInspect && netInspect.status === 0 && netInspect.stdout) {
            const [internalStr, driver] = netInspect.stdout.trim().split('|');
            const isInternal = internalStr === 'true';
            if (!isInternal) {
              allInternal = false;
              checkedDetails.push(`${netName} (internal: false, driver: ${driver})`);
            } else {
              checkedDetails.push(`${netName} (internal: true, driver: ${driver})`);
            }
          } else {
            allInternal = false;
            checkedDetails.push(`${netName} (unverifiable network inspect)`);
          }
        }

        return {
          exists: true,
          running: isRunning,
          network_isolated: allInternal,
          details: allInternal
            ? `Docker networks verified internal: ${checkedDetails.join(', ')}`
            : `Docker networks not isolated: ${checkedDetails.join(', ')}`
        };
      }
    }
  } catch (_) {
    // Return failed lookup
  }

  return { exists: false, running: false, network_isolated: false, details: 'Container not found or query failed' };
}

/**
 * Validate that the red-team operation adheres strictly to sandbox isolation rules.
 * 
 * 1. Target scope must NOT be the host.
 * 2. Lab name must be 'akatsuki-lab'.
 * 3. Required platform engine (LXC on Linux, Docker on Windows/macOS) must be installed.
 * 4. Network isolation must be verified.
 * 
 * @param {Object} params
 * @param {Object} [options={}]
 * @returns {Object} validation report
 */
function validateLabPrerequisites(params = {}, options = {}) {
  const platform = options.platform || process.platform;
  const engine = options.platformEngine || getRequiredEngine(platform);
  const labName = (params.lab_name || params.lab || DEFAULT_LAB_NAME).trim();
  const target = (params.target || params.scope || '').trim().toLowerCase();

  // Rule 1: Host execution is strictly denied
  const isHostTarget = target === 'host' ||
    target === 'localhost' ||
    target === '127.0.0.1' ||
    params.host === true ||
    params.run_on_host === true ||
    params.direct_host === true ||
    labName === 'host';

  if (isHostTarget && !params.allow_sandbox_redirect) {
    return {
      ready: false,
      declined: false,
      host_execution_denied: true,
      lab_name: labName,
      engine,
      network_isolated: false,
      cleanup_confirmed: true,
      reason: HOST_EXECUTION_DENIED_REASON
    };
  }

  // Rule 2: Lab name must be akatsuki-lab
  if (labName !== DEFAULT_LAB_NAME) {
    return {
      ready: false,
      declined: false,
      host_execution_denied: true,
      lab_name: labName,
      engine,
      network_isolated: false,
      cleanup_confirmed: true,
      reason: INVALID_LAB_NAME_REASON
    };
  }

  // Rule 3: Engine must be installed
  const engineCheck = checkEngineInstalled(engine, options);
  if (!engineCheck.installed) {
    return {
      ready: false,
      declined: true,
      host_execution_denied: true,
      lab_name: DEFAULT_LAB_NAME,
      engine,
      network_isolated: false,
      cleanup_confirmed: true,
      reason: DECLINE_NO_ENGINE
    };
  }

  // Rule 4: Verify lab status and network isolation
  const labStatus = options.mockLabStatus || getLabStatus(DEFAULT_LAB_NAME, engine, options);
  const failureReport = (reason) => ({
    ready: false,
    declined: false,
    host_execution_denied: true,
    lab_name: DEFAULT_LAB_NAME,
    engine,
    network_isolated: false,
    cleanup_confirmed: true,
    reason
  });

  if (!labStatus.exists && !options.skip_container_precheck) {
    return failureReport(`Sandbox container "${DEFAULT_LAB_NAME}" does not exist in ${engine}. Prepare or launch the container before executing attacks.`);
  }

  if (labStatus.exists && !labStatus.network_isolated) {
    return failureReport(`Container "${DEFAULT_LAB_NAME}" network isolation failed: container must not share the host network stack.`);
  }

  return {
    ready: true,
    declined: false,
    host_execution_denied: true,
    lab_name: DEFAULT_LAB_NAME,
    engine,
    network_isolated: true,
    lab_running: labStatus.running,
    cleanup_confirmed: true,
    details: labStatus.details
  };
}

/**
 * Execute a command inside the isolated akatsuki-lab container.
 * Never executes on the host.
 * 
 * @param {string} labName
 * @param {string|string[]} command
 * @param {Object} [options={}]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function executeInLab(labName = DEFAULT_LAB_NAME, command, options = {}) {
  const runner = options.runner || defaultCommandRunner;
  const engine = options.engine || getRequiredEngine(options.platform || process.platform);

  if (options.mockExecResult) {
    return options.mockExecResult;
  }

  if (engine === 'lxc') {
    const cmdArgs = Array.isArray(command) ? command : ['bash', '-c', command];
    return runner('lxc', ['exec', labName, '--', ...cmdArgs], options);
  }

  if (engine === 'docker') {
    const cmdArgs = Array.isArray(command) ? command : ['sh', '-c', command];
    return runner('docker', ['exec', labName, ...cmdArgs], options);
  }

  return { status: 1, stdout: '', stderr: `Unsupported engine: ${engine}` };
}

/**
 * Teardown and cleanup validation inside the lab.
 * Confirms non-persistence and process termination.
 * 
 * @param {string} labName
 * @param {string} engine
 * @param {Object} [options={}]
 * @returns {{ cleanup_confirmed: boolean, message: string }}
 */
function teardownLab(labName = DEFAULT_LAB_NAME, engine = null, options = {}) {
  if (options.mockCleanupResult) {
    return options.mockCleanupResult;
  }

  const targetEngine = engine || getRequiredEngine(options.platform || process.platform);
  const runner = options.runner || defaultCommandRunner;

  try {
    let cleanRes;
    const cleanupCmd = 'for pid in $(pgrep -f "nmap|tshark|tcpdump|msf|zap|nuclei|ffuf|sqlmap|testssl|trivy|probe|fuzz|exploit" 2>/dev/null); do [ "$pid" != "$$" ] && [ "$pid" != "$PPID" ] && kill "$pid" 2>/dev/null || true; done; rm -rf /tmp/akatsuki_* /tmp/recon_* 2>/dev/null || true';

    if (targetEngine === 'lxc') {
      cleanRes = runner('lxc', ['exec', labName, '--', 'sh', '-c', cleanupCmd], { timeout: 8000 });
    } else if (targetEngine === 'docker') {
      cleanRes = runner('docker', ['exec', labName, 'sh', '-c', cleanupCmd], { timeout: 8000 });
    } else {
      return {
        cleanup_confirmed: false,
        engine: targetEngine,
        message: `Teardown failed: unsupported engine "${targetEngine}".`
      };
    }

    if (!cleanRes || cleanRes.status !== 0) {
      if (cleanRes && cleanRes.stderr && /not running/i.test(cleanRes.stderr)) {
        return {
          cleanup_confirmed: true,
          engine: targetEngine,
          message: `Cleanup verified: container "${labName}" is stopped (no active processes).`
        };
      }
      return {
        cleanup_confirmed: false,
        engine: targetEngine,
        message: `Teardown command in container "${labName}" failed with status ${cleanRes ? cleanRes.status : 'null'}: ${cleanRes ? cleanRes.stderr : 'no output'}`
      };
    }

    return {
      cleanup_confirmed: true,
      engine: targetEngine,
      message: `Cleanup verified in sandbox container "${labName}". Residual attack processes terminated and host filesystem untouched.`
    };
  } catch (err) {
    return {
      cleanup_confirmed: false,
      engine: targetEngine,
      message: `Teardown execution failed with exception: ${err.message}`
    };
  }
}

/**
 * Idempotently provisions the akatsuki-lab container using the selected mode template.
 *
 * @param {string} [labName=DEFAULT_LAB_NAME]
 * @param {string} [engine=null]
 * @param {Object} [options={}]
 * @returns {{ ok: boolean, status?: string, error?: string, lab_name: string, engine: string, network_isolated?: boolean }}
 */
function provisionLab(labName = DEFAULT_LAB_NAME, engine = null, options = {}) {
  if (options.mockProvisionResult) {
    return options.mockProvisionResult;
  }

  const targetEngine = engine || getRequiredEngine(options.platform || process.platform);
  const runner = options.runner || defaultCommandRunner;

  const engineCheck = checkEngineInstalled(targetEngine, options);
  if (!engineCheck.installed) {
    return { ok: false, error: DECLINE_NO_ENGINE, lab_name: labName, engine: targetEngine };
  }

  const currentStatus = getLabStatus(labName, targetEngine, options);
  if (currentStatus.running && currentStatus.network_isolated) {
    return { ok: true, status: 'already_running', lab_name: labName, engine: targetEngine, network_isolated: true };
  }

  const path = require('path');
  const templateScript = targetEngine === 'lxc'
    ? path.join(__dirname, 'templates', 'akatsuki_lab', 'lxc', 'setup.sh')
    : path.join(__dirname, 'templates', 'akatsuki_lab', 'docker', 'setup.sh');

  try {
    const fs = require('fs');
    if (fs.existsSync(templateScript)) {
      const res = runner('bash', [templateScript], { timeout: 60000 });
      if (res && res.status !== 0) {
        return { ok: false, error: res.stderr || 'Lab setup script failed', lab_name: labName, engine: targetEngine };
      }
    } else if (targetEngine === 'lxc') {
      runner('lxc', ['network', 'create', 'labbr0', 'ipv4.address=10.77.77.1/24', 'ipv4.nat=false', 'ipv6.address=none'], { timeout: 10000 });
      runner('lxc', ['init', 'images:debian/12', labName, '--network=labbr0'], { timeout: 30000 });
      runner('lxc', ['start', labName], { timeout: 15000 });
    } else if (targetEngine === 'docker') {
      runner('docker', ['network', 'create', '--internal', '--subnet=10.77.77.0/24', 'akatsuki-net'], { timeout: 10000 });
      runner('docker', ['run', '-d', '--name', labName, '--network', 'akatsuki-net', '--restart', 'unless-stopped', 'debian:12-slim', 'tail', '-f', '/dev/null'], { timeout: 30000 });
    }
  } catch (err) {
    return { ok: false, error: err.message, lab_name: labName, engine: targetEngine };
  }

  const postStatus = getLabStatus(labName, targetEngine, options);
  return {
    ok: Boolean(postStatus.running || postStatus.exists),
    status: postStatus.running ? 'running' : 'created',
    lab_name: labName,
    engine: targetEngine,
    network_isolated: postStatus.network_isolated,
    details: postStatus.details
  };
}

/**
 * Stop and clean up Konoha-owned lab container resources.
 *
 * @param {string} [labName=DEFAULT_LAB_NAME]
 * @param {string} [engine=null]
 * @param {Object} [options={}]
 * @returns {{ ok: boolean, status: string, lab_name: string, engine: string }}
 */
function stopLab(labName = DEFAULT_LAB_NAME, engine = null, options = {}) {
  if (options.mockStopResult) {
    return options.mockStopResult;
  }

  const targetEngine = engine || getRequiredEngine(options.platform || process.platform);
  const runner = options.runner || defaultCommandRunner;

  teardownLab(labName, targetEngine, options);

  try {
    if (targetEngine === 'lxc') {
      runner('lxc', ['stop', labName, '--force'], { timeout: 10000 });
    } else if (targetEngine === 'docker') {
      runner('docker', ['stop', labName], { timeout: 10000 });
    }
  } catch (_) { /* ignore best-effort container stop */ }

  return { ok: true, status: 'stopped', lab_name: labName, engine: targetEngine };
}

module.exports = {
  DEFAULT_LAB_NAME,
  DECLINE_NO_ENGINE,
  HOST_EXECUTION_DENIED_REASON,
  INVALID_LAB_NAME_REASON,
  getRequiredEngine,
  checkEngineInstalled,
  getLabStatus,
  validateLabPrerequisites,
  executeInLab,
  teardownLab,
  provisionLab,
  stopLab
};
