'use strict';

/**
 * src/akatsuki_tool_registry.js
 *
 * Strict profile registry and command validation for Akatsuki Red-Team sandbox tools.
 * Governs which tools are permitted to execute inside 'akatsuki-lab' container sandbox.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { CURATED_TOOL_REGISTRY } = require('./akatsuki_tool_profiles');
const { isRedTeamEnabled } = require('./akatsuki_config');

const VALID_CATEGORIES = new Set([
  'network_discovery',
  'packet_analysis',
  'vulnerability_audit',
  'web_api_assessment',
  'controlled_verification',
  'container_security',
  'protocol_probe',
  'custom'
]);

const VALID_SAFETY_CLASSES = new Set([
  'read_only',
  'active_recon',
  'vulnerability_audit',
  'controlled_verification'
]);

const FORBIDDEN_CAPABILITIES = [
  /host[-_]network/i,
  /host[-_]filesystem/i,
  /persistence/i,
  /lateral[-_]movement/i,
  /credential[-_]dumping/i,
  /ransomware/i,
  /rootkit/i,
  /destructive[-_]dos/i,
  /privilege[-_]escalation[-_]auto/i,
  /credential[-_]theft/i,
  /malware[-_]deployment/i,
  /docker\.sock/i,
  /c2[-_]external/i,
  /external[-_]sweep/i
];

let _cachedCustomTools = null;
let _cachedCustomToolsMtime = 0;

function getCustomToolsPath() {
  return process.env.KONOHA_CUSTOM_TOOLS_PATH
    ? path.normalize(process.env.KONOHA_CUSTOM_TOOLS_PATH)
    : path.join(os.homedir(), '.konoha', 'akatsuki_custom_tools.json');
}

/**
 * Load persisted custom tool profiles from ~/.konoha/akatsuki_custom_tools.json.
 *
 * @returns {Object.<string, Object>}
 */
function loadPersistedCustomTools() {
  const customFile = getCustomToolsPath();
  try {
    if (!fs.existsSync(customFile)) return {};
    const stat = fs.statSync(customFile);
    if (_cachedCustomTools && stat.mtimeMs === _cachedCustomToolsMtime) {
      return _cachedCustomTools;
    }
    const raw = fs.readFileSync(customFile, 'utf8');
    const parsed = JSON.parse(raw);
    _cachedCustomTools = (parsed && typeof parsed === 'object') ? parsed : {};
    _cachedCustomToolsMtime = stat.mtimeMs;
    return _cachedCustomTools;
  } catch (_) {
    return _cachedCustomTools || {};
  }
}

/**
 * Validate a user-supplied custom tool profile against safety policies.
 *
 * @param {Object} profile
 * @returns {{ valid: boolean, reason?: string, sanitized?: Object }}
 */
function validateCustomToolProfile(profile, options = {}) {
  if (!profile || typeof profile !== 'object') {
    return { valid: false, reason: 'Tool profile must be a non-null object.' };
  }

  const isRed = options.mode === 'red' || options.redteam_enabled === true;

  // 1. Mandatory ID
  if (!profile.id || typeof profile.id !== 'string') {
    return { valid: false, reason: 'Tool profile requires a string "id".' };
  }
  const cleanId = profile.id.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(cleanId)) {
    return { valid: false, reason: `Tool profile id "${profile.id}" contains invalid characters. Must match ^[a-z0-9_-]{2,32}$.` };
  }

  // 2. Display Name
  const displayName = (profile.display_name && typeof profile.display_name === 'string')
    ? profile.display_name.trim()
    : cleanId;

  // 3. Category Validation
  const category = (profile.category || 'custom').toLowerCase();
  if (!VALID_CATEGORIES.has(category)) {
    return { valid: false, reason: `Invalid category "${profile.category}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}` };
  }

  // 4. Safety Class Validation
  const safetyClass = (profile.safety_class || 'vulnerability_audit').toLowerCase();
  if (!VALID_SAFETY_CLASSES.has(safetyClass)) {
    return { valid: false, reason: `Invalid safety_class "${profile.safety_class}". Must be one of: ${[...VALID_SAFETY_CLASSES].join(', ')}` };
  }

  // 5. Binary candidates
  const binaryCandidates = Array.isArray(profile.binary_candidates)
    ? profile.binary_candidates.filter(b => typeof b === 'string' && b.trim())
    : [cleanId];
  if (binaryCandidates.length === 0) {
    binaryCandidates.push(cleanId);
  }

  // Check for dangerous binaries
  const dangerousBinaries = ['rm', 'dd', 'mkfs', 'nc', 'netcat', 'socat', 'bash', 'sh', 'zsh', 'ssh', 'scp', 'sudo'];
  for (const bin of binaryCandidates) {
    const baseBin = bin.split(/[/\\]/).pop().toLowerCase();
    if (dangerousBinaries.includes(baseBin)) {
      return { valid: false, reason: `Binary candidate "${bin}" is a restricted system utility and cannot be registered as a red-team tool profile.` };
    }
  }

  // 6. Allowed operations
  const rawAllowed = Array.isArray(profile.allowed_operations)
    ? profile.allowed_operations.filter(op => typeof op === 'string' && op.trim())
    : ['custom_probe'];
  const rawBlocked = Array.isArray(profile.blocked_operations)
    ? profile.blocked_operations.filter(op => typeof op === 'string' && op.trim())
    : [];

  const allowedOperations = isRed
    ? Array.from(new Set([...rawAllowed, ...rawBlocked]))
    : rawAllowed;
  const blockedOperations = isRed ? [] : rawBlocked;

  // 7. Forbidden capabilities scan (skipped in Red-Team mode to open all abilities)
  if (!isRed) {
    const combinedText = [
      cleanId,
      displayName,
      category,
      safetyClass,
      ...binaryCandidates,
      ...allowedOperations,
      JSON.stringify(profile.blocked_operations || []),
      profile.description || ''
    ].join(' ');

    for (const pattern of FORBIDDEN_CAPABILITIES) {
      if (pattern.test(combinedText)) {
        return { valid: false, reason: `Tool profile violates safety policy: matches restricted pattern ${pattern}.` };
      }
    }
  }

  // 8. Scope validation
  const requiredScope = (profile.required_scope || 'local_or_dev').toLowerCase();
  if (requiredScope !== 'local_or_dev') {
    return { valid: false, reason: 'All red-team tools must enforce "local_or_dev" required_scope.' };
  }

  // 9. Timeout (default 3600s / 1 hour; returns immediately upon completion)
  const rawTimeout = Number(profile.timeout_ms);
  const timeoutMs = (!Number.isNaN(rawTimeout) && rawTimeout >= 1000 && rawTimeout <= 3600000)
    ? rawTimeout
    : 3600000;

  // 10. Cleanup Steps
  const cleanupSteps = Array.isArray(profile.cleanup_steps)
    ? profile.cleanup_steps.filter(s => typeof s === 'string' && s.trim())
    : [`pkill -f "${cleanId}" || true`];

  const sanitized = {
    id: cleanId,
    display_name: displayName,
    version: profile.version || 'custom',
    category,
    binary_candidates: binaryCandidates,
    container_images: Array.isArray(profile.container_images) ? profile.container_images : [],
    safety_class: safetyClass,
    allowed_operations: allowedOperations,
    blocked_operations: blockedOperations,
    required_scope: requiredScope,
    timeout_ms: timeoutMs,
    evidence_outputs: Array.isArray(profile.evidence_outputs) ? profile.evidence_outputs : [`/tmp/akatsuki_${cleanId}.out`],
    cleanup_steps: cleanupSteps,
    is_custom: true
  };

  return { valid: true, sanitized };
}

/**
 * Look up a tool profile by ID across curated registry, custom profiles, and persisted tools.
 * In Red-Team mode, all blocked operations are unlocked and merged into allowed operations.
 *
 * @param {string} toolId
 * @param {Object} [customProfiles={}]
 * @param {Object} [options={}]
 * @returns {Object|null}
 */
function getToolProfile(toolId, customProfiles = {}, options = {}) {
  if (!toolId || typeof toolId !== 'string') return null;
  const normalizedId = toolId.trim().toLowerCase();
  const isRed = options.mode === 'red' || isRedTeamEnabled(options);

  let profile = null;
  if (CURATED_TOOL_REGISTRY[normalizedId]) {
    profile = { ...CURATED_TOOL_REGISTRY[normalizedId] };
  } else if (customProfiles[normalizedId]) {
    profile = { ...customProfiles[normalizedId] };
  } else {
    const persisted = loadPersistedCustomTools();
    if (persisted[normalizedId]) {
      profile = { ...persisted[normalizedId] };
    }
  }

  if (profile && isRed) {
    const combined = [
      '*',
      'all_operations',
      'full_unrestricted_capabilities',
      ...(profile.allowed_operations || []),
      ...(profile.blocked_operations || [])
    ];
    profile.allowed_operations = Array.from(new Set(combined));
    profile.blocked_operations = [];
    profile.timeout_ms = profile.timeout_ms || 3600000;
  }

  return profile;
}

/**
 * List all supported tool profiles.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.includeCustom=false]
 * @returns {Object[]}
 */
function listSupportedTools(options = {}) {
  const tools = Object.values(CURATED_TOOL_REGISTRY).map(t => ({
    id: t.id,
    display_name: t.display_name,
    category: t.category,
    safety_class: t.safety_class,
    allowed_operations: t.allowed_operations,
    timeout_ms: t.timeout_ms
  }));

  if (options && options.includeCustom) {
    const persisted = loadPersistedCustomTools();
    for (const t of Object.values(persisted)) {
      if (t && t.id && !CURATED_TOOL_REGISTRY[t.id]) {
        tools.push({
          id: t.id,
          display_name: t.display_name || t.id,
          category: t.category || 'custom',
          safety_class: t.safety_class || 'vulnerability_audit',
          allowed_operations: t.allowed_operations || [],
          timeout_ms: t.timeout_ms || 30000,
          is_custom: true
        });
      }
    }
  }

  return tools;
}

/**
 * Plan deterministic red-team assessment phases based on requested tools and authorization.
 *
 * @param {Object} params
 * @param {string[]} [params.tools=[]] requested tool names or IDs
 * @param {Object[]} [params.custom_tools=[]] custom tool profiles
 * @param {boolean} [params.allow_controlled_exploit_verification=false]
 * @param {string} [params.target='']
 * @returns {{ phases: Object[], tools_available: Object[], tools_blocked: Object[], stop_conditions: string[] }}
 */
function planToolExecution(params = {}, options = {}) {
  const isRed = params.mode === 'red' || isRedTeamEnabled(options);
  const requestedTools = Array.isArray(params.tools) && params.tools.length > 0
    ? params.tools
    : ['nmap', 'whatweb', 'httpx', 'nuclei', 'nikto', 'ffuf', 'sqlmap', 'testssl'];

  const customProfileMap = {};
  const toolsBlocked = [];

  // Register and validate custom tools if provided
  if (Array.isArray(params.custom_tools)) {
    for (const custom of params.custom_tools) {
      const val = validateCustomToolProfile(custom, options);
      if (val.valid && val.sanitized) {
        customProfileMap[val.sanitized.id] = val.sanitized;
      } else {
        toolsBlocked.push({
          tool: custom && custom.id ? custom.id : 'unknown',
          reason: `Invalid custom tool profile: ${val.reason}`
        });
      }
    }
  }

  const toolsAvailable = [];
  const stopConditions = [];
  const exploitPermitted = params.allow_controlled_exploit_verification === true ||
    (params.allow_controlled_exploit_verification === undefined && isRed);

  for (const rawTool of requestedTools) {
    const toolId = String(rawTool).trim().toLowerCase();
    const profile = getToolProfile(toolId, customProfileMap, options);

    if (!profile) {
      toolsBlocked.push({
        tool: toolId,
        reason: `Tool "${toolId}" is not recognized or profiled. Supply an explicit custom tool profile.`
      });
      continue;
    }

    // High-risk controlled exploit verification check (automatically open in Red-Team mode unless explicitly disabled)
    if (profile.safety_class === 'controlled_verification' && !exploitPermitted) {
      toolsBlocked.push({
        tool: toolId,
        reason: `Tool "${profile.display_name}" requires explicit flag "allow_controlled_exploit_verification: true".`
      });
      continue;
    }

    toolsAvailable.push(profile);
  }

  // Construct deterministic execution phases
  const phases = [];

  phases.push({
    phase: 'rules_of_engagement',
    title: 'Rules of Engagement & Target Scope Verification',
    safety_class: 'read_only',
    tools: [],
    status: 'planned'
  });

  phases.push({
    phase: 'sandbox_containment',
    title: 'Sandbox Containment & Network Isolation Verification',
    safety_class: 'read_only',
    tools: [],
    status: 'planned'
  });

  phases.push({
    phase: 'reconnaissance',
    title: 'Chunin Passive Reconnaissance & Threat Intelligence',
    safety_class: 'read_only',
    tools: [],
    status: 'planned'
  });

  const discoveryTools = toolsAvailable.filter(t => t.category === 'network_discovery' || t.category === 'protocol_probe');
  if (discoveryTools.length > 0) {
    phases.push({
      phase: 'asset_discovery',
      title: 'Service & Surface Enumeration',
      safety_class: 'active_recon',
      tools: discoveryTools.map(t => t.id),
      status: 'planned'
    });
  }

  const enumTools = toolsAvailable.filter(t => t.category === 'web_api_assessment' && t.safety_class === 'active_recon');
  if (enumTools.length > 0) {
    phases.push({
      phase: 'service_enumeration',
      title: 'Web Application & API Service Enumeration',
      safety_class: 'active_recon',
      tools: enumTools.map(t => t.id),
      status: 'planned'
    });
  }

  const packetTools = toolsAvailable.filter(t => t.category === 'packet_analysis');
  if (packetTools.length > 0) {
    phases.push({
      phase: 'packet_analysis',
      title: 'Passive Capture & Protocol Dissection',
      safety_class: 'read_only',
      tools: packetTools.map(t => t.id),
      status: 'planned'
    });
  }

  const auditTools = toolsAvailable.filter(t =>
    (t.category === 'vulnerability_audit' || t.category === 'container_security' ||
     (t.category === 'web_api_assessment' && t.safety_class !== 'active_recon')) &&
    t.safety_class !== 'controlled_verification'
  );
  if (auditTools.length > 0) {
    phases.push({
      phase: 'vulnerability_audit',
      title: 'OWASP & Misconfiguration Assessment',
      safety_class: 'vulnerability_audit',
      tools: auditTools.map(t => t.id),
      status: 'planned'
    });
  }

  const verificationTools = toolsAvailable.filter(t => t.safety_class === 'controlled_verification');
  if (verificationTools.length > 0 && exploitPermitted) {
    phases.push({
      phase: 'controlled_verification',
      title: 'Controlled Non-Destructive Exploitability Proof',
      safety_class: 'controlled_verification',
      tools: verificationTools.map(t => t.id),
      status: 'planned'
    });
  }

  phases.push({
    phase: 'containment_teardown',
    title: 'Post-Assessment Teardown & Residual Artifact Removal',
    safety_class: 'read_only',
    tools: toolsAvailable.map(t => t.id),
    status: 'planned'
  });

  return {
    phases,
    tools_available: toolsAvailable,
    tools_blocked: toolsBlocked,
    stop_conditions: stopConditions
  };
}

/**
 * Build a bounded, safe command line array for a tool within an isolated lab container.
 *
 * @param {Object} tool
 * @param {string} [target='localhost:8080']
 * @returns {string[]}
 */
function buildPhaseCommand(tool, target = 'localhost:8080') {
  if (!tool) return ['echo', 'probe'];
  const bin = (tool.binary_candidates && tool.binary_candidates[0]) || tool.id;
  const cleanTarget = String(target).trim();
  const hostPort = cleanTarget.replace(/^https?:\/\//i, '').split('/')[0];
  const urlTarget = cleanTarget.startsWith('http://') || cleanTarget.startsWith('https://')
    ? cleanTarget
    : `http://${cleanTarget}`;

  switch (tool.id) {
    case 'nmap':
      return [bin, '-sT', '-sV', '-p', '80,443,8080,3000,8000', '--open', '-T4', hostPort, '-oA', '/tmp/akatsuki_nmap'];
    case 'whatweb':
      return [bin, '-a', '1', '--log-json=/tmp/akatsuki_whatweb.json', urlTarget];
    case 'httpx':
      return [bin, '-u', urlTarget, '-tech-detect', '-status-code', '-json'];
    case 'katana':
      return [bin, '-u', urlTarget, '-d', '2', '-jc', '-o', '/tmp/akatsuki_katana.json'];
    case 'ffuf':
      return [bin, '-u', `${urlTarget}/FUZZ`, '-w', '/usr/share/seclists/Discovery/Web-Content/common.txt', '-mc', '200,204,301,302,307,401,403', '-t', '10'];
    case 'feroxbuster':
      return [bin, '-u', urlTarget, '-w', '/usr/share/seclists/Discovery/Web-Content/common.txt', '-t', '5', '--quiet'];
    case 'nuclei':
      return [bin, '-target', urlTarget, '-severity', 'low,medium,high', '-c', '10', '-silent', '-o', '/tmp/akatsuki_nuclei_results.json'];
    case 'nikto':
      return [bin, '-h', urlTarget, '-Format', 'json', '-o', '/tmp/akatsuki_nikto.json'];
    case 'sqlmap':
      return [bin, '-u', urlTarget, '--batch', '--level=1', '--risk=1'];
    case 'wpscan':
      return [bin, '--url', urlTarget, '--enumerate', 'vp,vt,u', '--no-update'];
    case 'droopescan':
      return [bin, 'scan', 'drupal', '-u', urlTarget];
    case 'searchsploit':
      return [bin, '--nmap', '/tmp/akatsuki_nmap.xml'];
    case 'tshark':
      return [bin, '-c', '5', '-i', 'any'];
    case 'zap':
      return [bin, '-cmd', '-quickurl', urlTarget];
    case 'testssl':
      return [bin, '--fast', hostPort];
    case 'trivy':
      return [bin, 'fs', '--severity', 'HIGH,CRITICAL', '/tmp'];
    case 'curl_probe':
      return [bin, '-sI', '--connect-timeout', '5', urlTarget];
    case 'metasploit':
      return [bin, '-q', '-x', 'version; exit'];
    default: {
      if (tool.phase_command && Array.isArray(tool.phase_command)) {
        return tool.phase_command.map(arg => arg.replace('{{TARGET}}', cleanTarget).replace('{{HOST_PORT}}', hostPort).replace('{{URL}}', urlTarget));
      }
      return [bin, '--version'];
    }
  }
}

module.exports = {
  CURATED_TOOL_REGISTRY,
  VALID_CATEGORIES,
  VALID_SAFETY_CLASSES,
  FORBIDDEN_CAPABILITIES,
  validateCustomToolProfile,
  getToolProfile,
  listSupportedTools,
  planToolExecution,
  buildPhaseCommand
};
