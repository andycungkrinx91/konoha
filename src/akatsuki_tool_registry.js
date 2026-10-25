'use strict';

/**
 * src/akatsuki_tool_registry.js
 *
 * Canonical Akatsuki Red-Team Tool Registry & Phase Planner.
 * Centralizes approved red-team tool capabilities, safety classes,
 * schema validation for user-supplied custom tool profiles,
 * and deterministic execution phase planning inside `akatsuki-lab`.
 *
 * Direct host execution is STRICTLY DENIED for all tools.
 * All tools must run exclusively inside an isolated container (`akatsuki-lab`).
 */

const VALID_CATEGORIES = new Set([
  'network_discovery',
  'packet_analysis',
  'controlled_verification',
  'web_api_assessment',
  'vulnerability_audit',
  'protocol_probe',
  'container_security',
  'forensic_evidence',
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
  /rootkit/i,
  /ransomware/i,
  /credential[-_]theft/i,
  /malware[-_]deployment/i,
  /docker\.sock/i,
  /c2[-_]external/i,
  /external[-_]sweep/i
];

/**
 * Curated, versioned tool profiles approved for sandbox execution.
 */
const CURATED_TOOL_REGISTRY = {
  nmap: {
    id: 'nmap',
    display_name: 'Nmap Network Scanner',
    version: '7.94+',
    category: 'network_discovery',
    binary_candidates: ['nmap'],
    container_images: ['instrumentisto/nmap', 'alpine/nmap'],
    safety_class: 'active_recon',
    allowed_operations: [
      'port_scan',
      'service_version_detection',
      'banner_grab',
      'os_detection',
      'default_script_scan'
    ],
    blocked_operations: [
      'dos_scripts',
      'brute_force_credentials',
      'raw_packet_flooding',
      'external_scan'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_nmap.xml', '/tmp/akatsuki_nmap.txt'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_nmap.*',
      'pkill -f "nmap" || true'
    ]
  },

  tshark: {
    id: 'tshark',
    display_name: 'TShark / Wireshark Network Packet Analyzer',
    version: '4.0+',
    category: 'packet_analysis',
    binary_candidates: ['tshark', 'tcpdump'],
    container_images: ['corfr/tshark', 'wireshark/wireshark'],
    safety_class: 'read_only',
    allowed_operations: [
      'traffic_capture_local_interface',
      'protocol_dissection',
      'pcap_analysis',
      'tcp_stream_inspection'
    ],
    blocked_operations: [
      'promiscuous_host_sniffing',
      'packet_injection',
      'arp_spoofing',
      'external_capture'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 20000,
    evidence_outputs: ['/tmp/akatsuki_capture.pcap', '/tmp/akatsuki_tshark.txt'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_capture.pcap /tmp/akatsuki_tshark.txt',
      'pkill -f "tshark|tcpdump" || true'
    ]
  },

  metasploit: {
    id: 'metasploit',
    display_name: 'Metasploit Framework (Lab-Only Controlled Verification)',
    version: '6.3+',
    category: 'controlled_verification',
    binary_candidates: ['msfconsole', 'msfvenom'],
    container_images: ['metasploitframework/metasploit-framework'],
    safety_class: 'controlled_verification',
    requires_flag: 'allow_controlled_exploit_verification',
    allowed_operations: [
      'auxiliary_scanner',
      'vulnerability_verification',
      'banner_enum',
      'protocol_fuzzing_check'
    ],
    blocked_operations: [
      'remote_payload_execution',
      'persistence_establishment',
      'c2_listener_external',
      'ransomware_simulation',
      'host_breakout',
      'credential_harvesting'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 45000,
    evidence_outputs: ['/tmp/akatsuki_msf_report.json', '/tmp/akatsuki_msf.log'],
    cleanup_steps: [
      'rm -rf /tmp/akatsuki_msf* ~/.msf4/logs',
      'pkill -f "msfconsole|msfd" || true'
    ]
  },

  zap: {
    id: 'zap',
    display_name: 'OWASP Zed Attack Proxy (ZAP) / Burp Web Scanner',
    version: '2.14+',
    category: 'web_api_assessment',
    binary_candidates: ['zap.sh', 'zap-cli', 'owasp-zap'],
    container_images: ['ghcr.io/zaproxy/zaproxy:stable'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'spider',
      'passive_scan',
      'active_api_scan',
      'header_analysis',
      'openapi_probe'
    ],
    blocked_operations: [
      'destructive_fuzzing',
      'denial_of_service',
      'credential_stuffing',
      'external_api_crawl'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 60000,
    evidence_outputs: ['/tmp/akatsuki_zap_report.json', '/tmp/akatsuki_zap_report.html'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_zap* /tmp/zap.log',
      'pkill -f "zap" || true'
    ]
  },

  nuclei: {
    id: 'nuclei',
    display_name: 'Nuclei Vulnerability Scanner',
    version: '3.0+',
    category: 'vulnerability_audit',
    binary_candidates: ['nuclei'],
    container_images: ['projectdiscovery/nuclei'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'template_scan_local',
      'cve_detection',
      'misconfiguration_check',
      'tech_detection'
    ],
    blocked_operations: [
      'dos_templates',
      'destructive_templates',
      'remote_code_execution_weaponized',
      'external_target_sweep'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_nuclei_results.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_nuclei*',
      'pkill -f "nuclei" || true'
    ]
  },

  ffuf: {
    id: 'ffuf',
    display_name: 'FFUF Fast Web Fuzzer',
    version: '2.0+',
    category: 'web_api_assessment',
    binary_candidates: ['ffuf'],
    container_images: ['ffuf/ffuf'],
    safety_class: 'active_recon',
    allowed_operations: [
      'endpoint_discovery',
      'parameter_fuzzing',
      'virtual_host_discovery',
      'status_code_filtering'
    ],
    blocked_operations: [
      'destructive_payload_flooding',
      'exhaustion_dos',
      'brute_force_user_accounts',
      'external_fuzzing'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_ffuf_results.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_ffuf*',
      'pkill -f "ffuf" || true'
    ]
  },

  sqlmap: {
    id: 'sqlmap',
    display_name: 'SQLMap (Safe Non-Destructive In-Lab Probe)',
    version: '1.7+',
    category: 'vulnerability_audit',
    binary_candidates: ['sqlmap'],
    container_images: ['paoloo/sqlmap'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'detection_only',
      'parameter_risk_assessment',
      'technique_boolean_time_blind_check'
    ],
    blocked_operations: [
      'database_dump',
      'table_drop',
      'file_write_remote',
      'os_shell',
      'external_db_probe'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_sqlmap.log'],
    cleanup_steps: [
      'rm -rf /tmp/akatsuki_sqlmap* ~/.local/share/sqlmap',
      'pkill -f "sqlmap" || true'
    ]
  },

  testssl: {
    id: 'testssl',
    display_name: 'testssl.sh TLS/SSL Cipher & Protocol Tester',
    version: '3.0+',
    category: 'network_discovery',
    binary_candidates: ['testssl.sh', 'testssl'],
    container_images: ['drwetter/testssl.sh'],
    safety_class: 'read_only',
    allowed_operations: [
      'tls_version_check',
      'cipher_suite_enumeration',
      'certificate_validation',
      'vulnerability_checks_heartbleed_poodle'
    ],
    blocked_operations: [
      'denial_of_service',
      'mitm_interception',
      'external_ip_testing'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_testssl.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_testssl*',
      'pkill -f "testssl" || true'
    ]
  },

  trivy: {
    id: 'trivy',
    display_name: 'Trivy Container & Dependency Security Scanner',
    version: '0.48+',
    category: 'container_security',
    binary_candidates: ['trivy'],
    container_images: ['aquasec/trivy'],
    safety_class: 'read_only',
    allowed_operations: [
      'image_scan',
      'filesystem_scan',
      'config_scan',
      'sbom_generation'
    ],
    blocked_operations: [
      'container_modification',
      'registry_push',
      'external_registry_exfiltration'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 40000,
    evidence_outputs: ['/tmp/akatsuki_trivy.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_trivy*',
      'pkill -f "trivy" || true'
    ]
  },

  curl_probe: {
    id: 'curl_probe',
    display_name: 'cURL HTTP / API Protocol Probe',
    version: '8.0+',
    category: 'protocol_probe',
    binary_candidates: ['curl'],
    container_images: ['curlimages/curl'],
    safety_class: 'active_recon',
    allowed_operations: [
      'header_inspection',
      'http_methods_check',
      'api_request_response_validation',
      'auth_header_check'
    ],
    blocked_operations: [
      'external_upload',
      'raw_file_exfiltration',
      'reverse_shell_pipe'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 15000,
    evidence_outputs: ['/tmp/akatsuki_curl.out'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_curl.out'
    ]
  }
};

/**
 * Validate a user-supplied custom tool profile against safety policies.
 *
 * @param {Object} profile
 * @returns {{ valid: boolean, reason?: string, sanitized?: Object }}
 */
function validateCustomToolProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return { valid: false, reason: 'Tool profile must be a non-null object.' };
  }

  // 1. Mandatory ID
  if (!profile.id || typeof profile.id !== 'string') {
    return { valid: false, reason: 'Tool profile requires a string "id".' };
  }
  const cleanId = profile.id.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(cleanId)) {
    return { valid: false, reason: `Tool profile id "${profile.id}" contains invalid characters. Must match ^[a-z0-9_-]{2,32}$.` };
  }

  // 2. Display Name
  const displayName = typeof profile.display_name === 'string' && profile.display_name.trim()
    ? profile.display_name.trim()
    : cleanId;

  // 3. Category
  const category = (profile.category || 'custom').toLowerCase();
  if (!VALID_CATEGORIES.has(category)) {
    return { valid: false, reason: `Invalid tool category "${profile.category}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}.` };
  }

  // 4. Binary Candidates
  const binaryCandidates = Array.isArray(profile.binary_candidates)
    ? profile.binary_candidates.filter(b => typeof b === 'string' && b.trim())
    : (typeof profile.binary === 'string' ? [profile.binary.trim()] : []);
  if (binaryCandidates.length === 0) {
    return { valid: false, reason: 'Tool profile requires at least one binary candidate in "binary_candidates".' };
  }

  // Check for dangerous binaries
  const dangerousBinaries = ['rm', 'dd', 'mkfs', 'nc', 'netcat', 'socat', 'bash', 'sh', 'zsh', 'ssh', 'scp', 'sudo'];
  for (const bin of binaryCandidates) {
    const baseBin = bin.split(/[/\\]/).pop().toLowerCase();
    if (dangerousBinaries.includes(baseBin)) {
      return { valid: false, reason: `Binary candidate "${bin}" is a restricted system utility and cannot be registered as a red-team tool profile.` };
    }
  }

  // 5. Safety Class
  const safetyClass = (profile.safety_class || 'vulnerability_audit').toLowerCase();
  if (!VALID_SAFETY_CLASSES.has(safetyClass)) {
    return { valid: false, reason: `Invalid safety class "${profile.safety_class}". Must be one of: ${[...VALID_SAFETY_CLASSES].join(', ')}.` };
  }

  // 6. Allowed Operations
  const allowedOperations = Array.isArray(profile.allowed_operations)
    ? profile.allowed_operations.filter(op => typeof op === 'string' && op.trim())
    : [];
  if (allowedOperations.length === 0) {
    return { valid: false, reason: 'Tool profile must explicitly declare permitted operations in "allowed_operations".' };
  }

  // 7. Check for forbidden capabilities in allowed operations or description
  const combinedText = [
    cleanId,
    displayName,
    category,
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

  // 8. Scope validation
  const requiredScope = (profile.required_scope || 'local_or_dev').toLowerCase();
  if (requiredScope !== 'local_or_dev') {
    return { valid: false, reason: 'All red-team tools must enforce "local_or_dev" required_scope.' };
  }

  // 9. Timeout
  const rawTimeout = Number(profile.timeout_ms);
  const timeoutMs = (!Number.isNaN(rawTimeout) && rawTimeout >= 1000 && rawTimeout <= 120000)
    ? rawTimeout
    : 30000;

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
    blocked_operations: Array.isArray(profile.blocked_operations) ? profile.blocked_operations : ['host_access', 'persistence'],
    required_scope: requiredScope,
    timeout_ms: timeoutMs,
    evidence_outputs: Array.isArray(profile.evidence_outputs) ? profile.evidence_outputs : [`/tmp/akatsuki_${cleanId}.out`],
    cleanup_steps: cleanupSteps,
    is_custom: true
  };

  return { valid: true, sanitized };
}

/**
 * Look up a tool profile by ID across curated registry and custom profiles.
 *
 * @param {string} toolId
 * @param {Object} [customProfiles={}]
 * @returns {Object|null}
 */
function getToolProfile(toolId, customProfiles = {}) {
  if (!toolId || typeof toolId !== 'string') return null;
  const normalizedId = toolId.trim().toLowerCase();

  if (CURATED_TOOL_REGISTRY[normalizedId]) {
    return { ...CURATED_TOOL_REGISTRY[normalizedId] };
  }

  if (customProfiles[normalizedId]) {
    return { ...customProfiles[normalizedId] };
  }

  return null;
}

/**
 * List all supported curated tool profiles.
 *
 * @returns {Object[]}
 */
function listSupportedTools() {
  return Object.values(CURATED_TOOL_REGISTRY).map(t => ({
    id: t.id,
    display_name: t.display_name,
    category: t.category,
    safety_class: t.safety_class,
    allowed_operations: t.allowed_operations,
    timeout_ms: t.timeout_ms
  }));
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
function planToolExecution(params = {}) {
  const requestedTools = Array.isArray(params.tools) && params.tools.length > 0
    ? params.tools
    : ['nmap', 'curl_probe']; // Default minimal assessment set

  const customProfileMap = {};
  const toolsBlocked = [];

  // Register and validate custom tools if provided
  if (Array.isArray(params.custom_tools)) {
    for (const custom of params.custom_tools) {
      const val = validateCustomToolProfile(custom);
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

  for (const rawTool of requestedTools) {
    const toolId = String(rawTool).trim().toLowerCase();
    const profile = getToolProfile(toolId, customProfileMap);

    if (!profile) {
      toolsBlocked.push({
        tool: toolId,
        reason: `Tool "${toolId}" is not recognized or profiled. Supply an explicit custom tool profile.`
      });
      continue;
    }

    // High-risk controlled exploit verification check
    if (profile.safety_class === 'controlled_verification' && !params.allow_controlled_exploit_verification) {
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

  // Phase 1: Rules of Engagement & Boundary Verification
  phases.push({
    phase: 'rules_of_engagement',
    title: 'Rules of Engagement & Target Scope Verification',
    safety_class: 'read_only',
    tools: [],
    status: 'planned'
  });

  // Phase 2: Sandbox Network Containment Proof
  phases.push({
    phase: 'sandbox_containment',
    title: 'Sandbox Containment & Network Isolation Verification',
    safety_class: 'read_only',
    tools: [],
    status: 'planned'
  });

  // Phase 3: Network & Service Discovery
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

  // Phase 4: Packet & Protocol Analysis
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

  // Phase 5: Web & Application Vulnerability Audit
  const auditTools = toolsAvailable.filter(t => t.category === 'web_api_assessment' || t.category === 'vulnerability_audit' || t.category === 'container_security');
  if (auditTools.length > 0) {
    phases.push({
      phase: 'vulnerability_audit',
      title: 'OWASP & Misconfiguration Assessment',
      safety_class: 'vulnerability_audit',
      tools: auditTools.map(t => t.id),
      status: 'planned'
    });
  }

  // Phase 6: Controlled Verification (Only if explicitly authorized)
  const verificationTools = toolsAvailable.filter(t => t.safety_class === 'controlled_verification');
  if (verificationTools.length > 0 && params.allow_controlled_exploit_verification) {
    phases.push({
      phase: 'controlled_verification',
      title: 'Controlled Non-Destructive Exploitability Proof',
      safety_class: 'controlled_verification',
      tools: verificationTools.map(t => t.id),
      status: 'planned'
    });
  }

  // Phase 7: Post-Assessment Containment Teardown
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

module.exports = {
  CURATED_TOOL_REGISTRY,
  VALID_CATEGORIES,
  VALID_SAFETY_CLASSES,
  FORBIDDEN_CAPABILITIES,
  validateCustomToolProfile,
  getToolProfile,
  listSupportedTools,
  planToolExecution
};
