'use strict';

/**
 * src/workflow/akatsuki/tool_profiles.js
 *
 * Curated, versioned tool profiles approved for Akatsuki sandbox execution.
 * Includes network discovery, packet analysis, web enumeration,
 * vulnerability audit, and controlled verification tools.
 *
 * In Red-Team mode, all operational capabilities are open with zero artificial blocked operations.
 */

const CURATED_TOOL_REGISTRY = {
  nmap: {
    id: 'nmap',
    display_name: 'Nmap Network Scanner',
    version: '7.94+',
    category: 'network_discovery',
    binary_candidates: ['nmap'],
    container_images: ['instrumentisto/nmap', 'alpine/nmap', 'kalilinux/kali-rolling'],
    safety_class: 'active_recon',
    allowed_operations: [
      'port_scan',
      'service_version_detection',
      'banner_grab',
      'os_detection',
      'default_script_scan',
      'vuln_scripts'
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

  whatweb: {
    id: 'whatweb',
    display_name: 'WhatWeb NextGen Web Scanner',
    version: '0.5+',
    category: 'network_discovery',
    binary_candidates: ['whatweb'],
    container_images: ['kalilinux/kali-rolling'],
    safety_class: 'read_only',
    allowed_operations: [
      'technology_fingerprinting',
      'server_banner_detection',
      'header_analysis',
      'cms_identification'
    ],
    blocked_operations: [
      'aggressive_probing',
      'exploit_injection',
      'external_scan'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 20000,
    evidence_outputs: ['/tmp/akatsuki_whatweb.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_whatweb.*',
      'pkill -f "whatweb" || true'
    ]
  },

  httpx: {
    id: 'httpx',
    display_name: 'ProjectDiscovery HTTPX Probe',
    version: '1.6+',
    category: 'web_api_assessment',
    binary_candidates: ['httpx', '/root/go/bin/httpx', '/usr/local/go/bin/httpx'],
    container_images: ['projectdiscovery/httpx', 'kalilinux/kali-rolling'],
    safety_class: 'active_recon',
    allowed_operations: [
      'http_probe',
      'status_code_check',
      'technology_detection',
      'tls_inspection',
      'title_grab'
    ],
    blocked_operations: [
      'denial_of_service',
      'high_concurrency_flooding',
      'external_target_sweep'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 25000,
    evidence_outputs: ['/tmp/akatsuki_httpx.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_httpx.*',
      'pkill -f "httpx" || true'
    ]
  },

  katana: {
    id: 'katana',
    display_name: 'ProjectDiscovery Katana Web Crawler',
    version: '1.1+',
    category: 'web_api_assessment',
    binary_candidates: ['katana', '/root/go/bin/katana', '/usr/local/go/bin/katana'],
    container_images: ['projectdiscovery/katana', 'kalilinux/kali-rolling'],
    safety_class: 'active_recon',
    allowed_operations: [
      'endpoint_discovery',
      'form_crawling',
      'javascript_parsing',
      'api_path_enumeration',
      'recursive_crawl'
    ],
    blocked_operations: [
      'credential_stuffing',
      'deep_scope_crawl'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_katana.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_katana.*',
      'pkill -f "katana" || true'
    ]
  },

  ffuf: {
    id: 'ffuf',
    display_name: 'Fast Web Fuzzer (FFUF)',
    version: '2.1+',
    category: 'web_api_assessment',
    binary_candidates: ['ffuf', '/root/go/bin/ffuf', '/usr/local/go/bin/ffuf'],
    container_images: ['ffuf/ffuf', 'kalilinux/kali-rolling'],
    safety_class: 'active_recon',
    allowed_operations: [
      'directory_enumeration',
      'parameter_fuzzing',
      'header_fuzzing',
      'status_code_filtering'
    ],
    blocked_operations: [
      'rate_flooding',
      'comprehensive_fuzzing'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_ffuf.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_ffuf.*',
      'pkill -f "ffuf" || true'
    ]
  },

  feroxbuster: {
    id: 'feroxbuster',
    display_name: 'Feroxbuster Recursive Content Discovery',
    version: '2.10+',
    category: 'web_api_assessment',
    binary_candidates: ['feroxbuster', '/usr/bin/feroxbuster', '/usr/local/bin/feroxbuster'],
    container_images: ['epi052/feroxbuster', 'kalilinux/kali-rolling'],
    safety_class: 'active_recon',
    allowed_operations: [
      'recursive_directory_bruteforce',
      'status_filter',
      'extension_probing',
      'hidden_resource_discovery'
    ],
    blocked_operations: [
      'high_concurrency_crawl',
      'deep_payloads'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_feroxbuster.txt'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_feroxbuster.*',
      'pkill -f "feroxbuster" || true'
    ]
  },

  nuclei: {
    id: 'nuclei',
    display_name: 'ProjectDiscovery Nuclei Vulnerability Scanner',
    version: '3.1+',
    category: 'vulnerability_audit',
    binary_candidates: ['nuclei', '/root/go/bin/nuclei', '/usr/local/go/bin/nuclei'],
    container_images: ['projectdiscovery/nuclei', 'kalilinux/kali-rolling'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'template_scan_cve',
      'template_scan_misconfiguration',
      'template_scan_exposed_panels',
      'safe_protocol_probes'
    ],
    blocked_operations: [
      'full_cve_exploit_templates',
      'protocol_fuzzing'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 45000,
    evidence_outputs: ['/tmp/akatsuki_nuclei_results.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_nuclei*',
      'pkill -f "nuclei" || true'
    ]
  },

  nikto: {
    id: 'nikto',
    display_name: 'Nikto Web Server Scanner',
    version: '2.5+',
    category: 'vulnerability_audit',
    binary_candidates: ['nikto'],
    container_images: ['sullo/nikto', 'kalilinux/kali-rolling'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'misconfiguration_check',
      'outdated_server_detection',
      'dangerous_files_check',
      'http_option_enumeration'
    ],
    blocked_operations: [
      'full_tuning_scan'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 35000,
    evidence_outputs: ['/tmp/akatsuki_nikto.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_nikto.*',
      'pkill -f "nikto" || true'
    ]
  },

  sqlmap: {
    id: 'sqlmap',
    display_name: 'SQLMap Automatic SQL Injection Assessor',
    version: '1.8+',
    category: 'vulnerability_audit',
    binary_candidates: ['sqlmap'],
    container_images: ['sqlmapproject/sqlmap', 'kalilinux/kali-rolling'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'boolean_based_blind',
      'error_based_sql_probe',
      'union_query_assessment',
      'time_based_blind_bounded',
      'batch_mode_non_destructive'
    ],
    blocked_operations: [
      'database_dump',
      'table_enumeration',
      'os_shell_injection',
      'privilege_escalation_audit'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_sqlmap.log'],
    cleanup_steps: [
      'rm -rf /tmp/akatsuki_sqlmap* ~/.local/share/sqlmap',
      'pkill -f "sqlmap" || true'
    ]
  },

  wpscan: {
    id: 'wpscan',
    display_name: 'WPScan WordPress Security Scanner',
    version: '3.8+',
    category: 'web_api_assessment',
    binary_candidates: ['wpscan'],
    container_images: ['wpscanteam/wpscan', 'kalilinux/kali-rolling'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'wordpress_core_vuln_check',
      'plugin_enumeration',
      'theme_enumeration',
      'user_enumeration'
    ],
    blocked_operations: [
      'password_bruteforce_audit',
      'vulnerable_plugin_exploit_proof'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_wpscan.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_wpscan.*',
      'pkill -f "wpscan" || true'
    ]
  },

  droopescan: {
    id: 'droopescan',
    display_name: 'Droopescan CMS Vulnerability Scanner',
    version: '1.4+',
    category: 'vulnerability_audit',
    binary_candidates: ['droopescan', '/root/.local/bin/droopescan'],
    container_images: ['kalilinux/kali-rolling'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'drupal_audit',
      'silverstripe_audit',
      'wordpress_audit',
      'moodle_audit',
      'cms_plugin_audit'
    ],
    blocked_operations: [
      'credential_audit'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 25000,
    evidence_outputs: ['/tmp/akatsuki_droopescan.txt'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_droopescan.*',
      'pkill -f "droopescan" || true'
    ]
  },

  searchsploit: {
    id: 'searchsploit',
    display_name: 'ExploitDB SearchSploit Offline Search',
    version: '2024+',
    category: 'vulnerability_audit',
    binary_candidates: ['searchsploit', '/opt/exploitdb/searchsploit'],
    container_images: ['kalilinux/kali-rolling'],
    safety_class: 'read_only',
    allowed_operations: [
      'cve_lookup',
      'nmap_xml_exploit_match',
      'software_version_correlation',
      'exploit_source_inspection'
    ],
    blocked_operations: [
      'exploit_compilation_verification'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 20000,
    evidence_outputs: ['/tmp/akatsuki_searchsploit.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_searchsploit.*'
    ]
  },

  testssl: {
    id: 'testssl',
    display_name: 'testssl.sh TLS/SSL Cipher & Protocol Tester',
    version: '3.0+',
    category: 'network_discovery',
    binary_candidates: ['testssl.sh', 'testssl'],
    container_images: ['drwetter/testssl.sh', 'kalilinux/kali-rolling'],
    safety_class: 'read_only',
    allowed_operations: [
      'tls_version_check',
      'cipher_suite_enumeration',
      'certificate_validation',
      'vulnerability_checks_heartbleed_poodle'
    ],
    blocked_operations: [
      'robot_breach_poodle_checks'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 30000,
    evidence_outputs: ['/tmp/akatsuki_testssl.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_testssl*',
      'pkill -f "testssl" || true'
    ]
  },

  tshark: {
    id: 'tshark',
    display_name: 'TShark / Wireshark Network Packet Analyzer',
    version: '4.0+',
    category: 'packet_analysis',
    binary_candidates: ['tshark', 'tcpdump'],
    container_images: ['corfr/tshark', 'wireshark/wireshark', 'kalilinux/kali-rolling'],
    safety_class: 'read_only',
    allowed_operations: [
      'traffic_capture_local_interface',
      'protocol_dissection',
      'pcap_analysis',
      'tcp_stream_inspection'
    ],
    blocked_operations: [
      'promiscuous_sniffing',
      'packet_injection_audit'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 20000,
    evidence_outputs: ['/tmp/akatsuki_tshark.pcap'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_tshark*',
      'pkill -f "tshark" || true'
    ]
  },

  zap: {
    id: 'zap',
    display_name: 'OWASP ZAP Baseline Security Scanner',
    version: '2.14+',
    category: 'vulnerability_audit',
    binary_candidates: ['zap-baseline.py', 'zap-cli', 'zap.sh'],
    container_images: ['zaproxy/zap-stable'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'passive_baseline_scan',
      'header_security_audit',
      'cookie_flags_inspection',
      'cors_misconfiguration'
    ],
    blocked_operations: [
      'active_exploit_attack',
      'ajax_spider_deep',
      'full_fuzzing_audit'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 60000,
    evidence_outputs: ['/tmp/akatsuki_zap_report.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_zap*',
      'pkill -f "zap" || true'
    ]
  },

  trivy: {
    id: 'trivy',
    display_name: 'Trivy Container & Dependency Security Scanner',
    version: '0.48+',
    category: 'container_security',
    binary_candidates: ['trivy'],
    container_images: ['aquasec/trivy', 'kalilinux/kali-rolling'],
    safety_class: 'read_only',
    allowed_operations: [
      'image_scan',
      'filesystem_scan',
      'config_scan',
      'sbom_generation'
    ],
    blocked_operations: [
      'rootfs_audit',
      'secret_scan'
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
    container_images: ['curlimages/curl', 'kalilinux/kali-rolling'],
    safety_class: 'active_recon',
    allowed_operations: [
      'header_inspection',
      'http_methods_check',
      'api_request_response_validation',
      'auth_header_check'
    ],
    blocked_operations: [
      'arbitrary_header_injection',
      'raw_payload_delivery'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 15000,
    evidence_outputs: ['/tmp/akatsuki_curl.out'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_curl.out'
    ]
  },

  metasploit: {
    id: 'metasploit',
    display_name: 'Metasploit Framework (Controlled PoC Verification)',
    version: '6.3+',
    category: 'controlled_verification',
    binary_candidates: ['msfconsole', '/usr/bin/msfconsole', '/opt/metasploit-framework/bin/msfconsole'],
    container_images: ['metasploitframework/metasploit-framework', 'kalilinux/kali-rolling'],
    safety_class: 'controlled_verification',
    allowed_operations: [
      'exploit_check_method_only',
      'auxiliary_scanner_read_only',
      'version_probe',
      'controlled_poc_verification'
    ],
    blocked_operations: [
      'module_execution',
      'payload_generation',
      'session_verification'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 45000,
    evidence_outputs: ['/tmp/akatsuki_msf.log'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_msf*',
      'pkill -f "msfconsole" || true'
    ]
  },

  burpsuite: {
    id: 'burpsuite',
    display_name: 'PortSwigger Burp Suite Community / Headless Security Proxy',
    version: '2024+',
    category: 'web_api_assessment',
    binary_candidates: ['burpsuite', '/usr/bin/burpsuite'],
    container_images: ['kalilinux/kali-rolling'],
    safety_class: 'vulnerability_audit',
    allowed_operations: [
      'proxy_traffic_interception',
      'passive_vulnerability_scan',
      'csrf_poc_generation',
      'auth_token_analysis',
      'headless_project_analysis'
    ],
    blocked_operations: [
      'active_vulnerability_scan'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 60000,
    evidence_outputs: ['/tmp/akatsuki_burpsuite.xml', '/tmp/akatsuki_burpsuite.json'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_burpsuite.*',
      'pkill -f "burpsuite" || true'
    ]
  },

  msfvenom: {
    id: 'msfvenom',
    display_name: 'Metasploit Standalone Payload Generator (msfvenom)',
    version: '6.x+',
    category: 'controlled_verification',
    binary_candidates: ['msfvenom', '/usr/bin/msfvenom', '/opt/metasploit-framework/bin/msfvenom'],
    container_images: ['kalilinux/kali-rolling'],
    safety_class: 'controlled_verification',
    allowed_operations: [
      'controlled_poc_verification',
      'shellcode_encoding',
      'format_conversion',
      'architecture_validation'
    ],
    blocked_operations: [
      'payload_generation'
    ],
    required_scope: 'local_or_dev',
    timeout_ms: 45000,
    evidence_outputs: ['/tmp/akatsuki_payload.bin', '/tmp/akatsuki_msfvenom.log'],
    cleanup_steps: [
      'rm -f /tmp/akatsuki_payload.* /tmp/akatsuki_msfvenom.log',
      'pkill -f "msfvenom" || true'
    ]
  }
};



module.exports = {
  CURATED_TOOL_REGISTRY
};
