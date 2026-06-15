#!/usr/bin/env python3
"""
Security Auditor — Multi-Layer Security Posture Auditor

Performs comprehensive security assessment across multiple layers:
- Secrets scanning (API keys, tokens, passwords, private keys)
- Dependency vulnerability pattern detection
- Configuration audit (Docker, K8s, Terraform anti-patterns)
- Code pattern analysis (injection, XSS, deserialization)
- Permission and access control review

Usage:
    python security_auditor.py <target_dir> [--scope full|secrets|deps|config|code] [--severity high] [--sarif] [--json]

Requires: Python 3.8+ (stdlib only)
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Enums & Data Classes
# ---------------------------------------------------------------------------

class Severity(Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"

    @property
    def numeric(self) -> int:
        return {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "INFO": 0}[self.value]


class AuditScope(Enum):
    SECRETS = "secrets"
    DEPS = "deps"
    CONFIG = "config"
    CODE = "code"
    FULL = "full"


@dataclass
class Finding:
    """Represents a security finding."""
    rule_id: str
    title: str
    severity: Severity
    category: str
    description: str
    file_path: str
    line_number: int = 0
    evidence: str = ""
    remediation: str = ""
    cwe: str = ""  # CWE reference
    owasp: str = ""  # OWASP category


# ---------------------------------------------------------------------------
# Secret Patterns
# ---------------------------------------------------------------------------

SECRET_PATTERNS = {
    # AWS
    'aws_access_key': {
        'pattern': r'(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}',
        'severity': Severity.CRITICAL,
        'description': 'AWS Access Key ID detected',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021 — Identification and Authentication Failures',
    },
    'aws_secret_key': {
        'pattern': r'(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["\']?[A-Za-z0-9/+=]{40}',
        'severity': Severity.CRITICAL,
        'description': 'AWS Secret Access Key detected',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
    # GCP
    'gcp_service_account': {
        'pattern': r'"type"\s*:\s*"service_account"',
        'severity': Severity.HIGH,
        'description': 'GCP service account JSON key file detected',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
    # GitHub
    'github_token': {
        'pattern': r'gh[pousr]_[A-Za-z0-9_]{36,}',
        'severity': Severity.CRITICAL,
        'description': 'GitHub personal access token detected',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
    # Generic API keys
    'generic_api_key': {
        'pattern': r'(?:api[_-]?key|apikey|api_secret)\s*[=:]\s*["\'][A-Za-z0-9_\-]{16,}["\']',
        'severity': Severity.HIGH,
        'description': 'Generic API key detected in source code',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
    # JWT secrets
    'jwt_secret': {
        'pattern': r'(?:jwt[_-]?secret|JWT_SECRET|token[_-]?secret)\s*[=:]\s*["\'][^"\']{8,}["\']',
        'severity': Severity.CRITICAL,
        'description': 'JWT secret key hardcoded in source',
        'cwe': 'CWE-798',
        'owasp': 'A02:2021 — Cryptographic Failures',
    },
    # Private keys
    'private_key': {
        'pattern': r'-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----',
        'severity': Severity.CRITICAL,
        'description': 'Private key file detected in repository',
        'cwe': 'CWE-321',
        'owasp': 'A02:2021',
    },
    # Database connection strings
    'db_connection_string': {
        'pattern': r'(?:mongodb|postgres|mysql|redis|amqp)://[^"\'\s]{10,}',
        'severity': Severity.HIGH,
        'description': 'Database connection string with potential credentials',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
    # Passwords
    'hardcoded_password': {
        'pattern': r'(?:password|passwd|pwd)\s*[=:]\s*["\'][^"\']{4,}["\']',
        'severity': Severity.HIGH,
        'description': 'Hardcoded password detected',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
    # Slack tokens
    'slack_token': {
        'pattern': r'xox[bpsa]-[0-9]{10,}-[A-Za-z0-9]{10,}',
        'severity': Severity.HIGH,
        'description': 'Slack token detected',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
    # Stripe
    'stripe_key': {
        'pattern': r'(?:sk|pk)_(test|live)_[A-Za-z0-9]{20,}',
        'severity': Severity.CRITICAL,
        'description': 'Stripe API key detected',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
    # SendGrid
    'sendgrid_key': {
        'pattern': r'SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}',
        'severity': Severity.HIGH,
        'description': 'SendGrid API key detected',
        'cwe': 'CWE-798',
        'owasp': 'A07:2021',
    },
}

# ---------------------------------------------------------------------------
# Code Vulnerability Patterns
# ---------------------------------------------------------------------------

CODE_PATTERNS = {
    'sql_injection': {
        'pattern': r'(?:f"[^"]*(?:SELECT|INSERT|UPDATE|DELETE|DROP)[^"]*\{|"[^"]*(?:SELECT|INSERT|UPDATE|DELETE)\s[^"]*"\s*\+|`[^`]*\$\{[^}]+\}[^`]*(?:SELECT|INSERT|UPDATE|DELETE))',
        'severity': Severity.CRITICAL,
        'description': 'Potential SQL injection via string interpolation',
        'remediation': 'Use parameterized queries or ORM methods',
        'cwe': 'CWE-89',
        'owasp': 'A03:2021 — Injection',
    },
    'xss_innerhtml': {
        'pattern': r'(\.innerHTML\s*=|dangerouslySetInnerHTML|\{@html\s)',
        'severity': Severity.HIGH,
        'description': 'Potential XSS via innerHTML or equivalent',
        'remediation': 'Use textContent or sanitize HTML with DOMPurify',
        'cwe': 'CWE-79',
        'owasp': 'A03:2021 — Injection',
    },
    'command_injection': {
        'pattern': r'(?:os\.system\(|subprocess\.(?:call|run|Popen)\([^)]*shell\s*=\s*True|exec\(\s*["\']|child_process\.exec\()',
        'severity': Severity.CRITICAL,
        'description': 'Potential command injection via shell execution',
        'remediation': 'Use subprocess with shell=False, avoid exec()',
        'cwe': 'CWE-78',
        'owasp': 'A03:2021 — Injection',
    },
    'path_traversal': {
        'pattern': r'(?:\.\.\/|\.\.\\\\|open\([^)]*\+[^)]*\)|os\.path\.join\([^)]*(?:request|req|input|param))',
        'severity': Severity.HIGH,
        'description': 'Potential path traversal vulnerability',
        'remediation': 'Validate paths, use os.path.realpath, restrict to allowed directories',
        'cwe': 'CWE-22',
        'owasp': 'A01:2021 — Broken Access Control',
    },
    'insecure_deserialization': {
        'pattern': r'(?:pickle\.loads?\(|yaml\.load\([^)]*(?!Loader)|yaml\.unsafe_load|unserialize\(|Marshal\.load)',
        'severity': Severity.HIGH,
        'description': 'Insecure deserialization detected',
        'remediation': 'Use yaml.safe_load, avoid pickle for untrusted data',
        'cwe': 'CWE-502',
        'owasp': 'A08:2021 — Software and Data Integrity Failures',
    },
    'eval_usage': {
        'pattern': r'(?:^|\s)eval\s*\((?!.*#\s*nosec)',
        'severity': Severity.HIGH,
        'description': 'Use of eval() can execute arbitrary code',
        'remediation': 'Use ast.literal_eval or safer alternatives',
        'cwe': 'CWE-95',
        'owasp': 'A03:2021 — Injection',
    },
    'weak_random': {
        'pattern': r'(?:Math\.random\(\)|random\.random\(\)|rand\(\))\s*.*(?:token|secret|password|key|session|nonce)',
        'severity': Severity.MEDIUM,
        'description': 'Weak random number generator used for security-sensitive value',
        'remediation': 'Use secrets module (Python) or crypto.randomBytes (Node.js)',
        'cwe': 'CWE-338',
        'owasp': 'A02:2021 — Cryptographic Failures',
    },
    'weak_hash': {
        'pattern': r'(?:hashlib\.md5|hashlib\.sha1|MD5\(|SHA1\(|createHash\(["\'](?:md5|sha1)["\'])',
        'severity': Severity.MEDIUM,
        'description': 'Weak hash algorithm (MD5/SHA1) used',
        'remediation': 'Use SHA-256 or stronger (SHA-3, BLAKE2)',
        'cwe': 'CWE-328',
        'owasp': 'A02:2021 — Cryptographic Failures',
    },
    'cors_wildcard': {
        'pattern': r'(?:Access-Control-Allow-Origin["\'\s:]*\*|origin:\s*(?:true|\*)|CORS_ALLOW_ALL|cors\(\))',
        'severity': Severity.MEDIUM,
        'description': 'CORS allows all origins',
        'remediation': 'Restrict CORS to specific trusted origins',
        'cwe': 'CWE-942',
        'owasp': 'A05:2021 — Security Misconfiguration',
    },
    'debug_mode': {
        'pattern': r'(?:DEBUG\s*=\s*True|"debug"\s*:\s*true|NODE_ENV\s*[=:]\s*["\']?development)',
        'severity': Severity.LOW,
        'description': 'Debug mode enabled — may expose sensitive information',
        'remediation': 'Ensure debug is disabled in production',
        'cwe': 'CWE-489',
        'owasp': 'A05:2021 — Security Misconfiguration',
    },
    'open_redirect': {
        'pattern': r'(?:redirect\(.*(?:request|req|params|query).*\)|res\.redirect\(.*(?:req|params|query))',
        'severity': Severity.MEDIUM,
        'description': 'Potential open redirect via user-controlled input',
        'remediation': 'Validate redirect URLs against allowlist',
        'cwe': 'CWE-601',
        'owasp': 'A01:2021 — Broken Access Control',
    },
}

# ---------------------------------------------------------------------------
# Config Audit Patterns
# ---------------------------------------------------------------------------

DOCKER_PATTERNS = {
    'privileged_container': {
        'pattern': r'privileged:\s*true',
        'severity': Severity.CRITICAL,
        'description': 'Container runs in privileged mode',
        'remediation': 'Remove privileged mode, use specific capabilities instead',
    },
    'root_user': {
        'pattern': r'(?:^USER\s+root|user:\s*["\']?root)',
        'severity': Severity.HIGH,
        'description': 'Container runs as root user',
        'remediation': 'Add USER directive with non-root user',
    },
    'latest_tag': {
        'pattern': r'(?:FROM\s+\S+:latest|image:\s*\S+:latest)',
        'severity': Severity.MEDIUM,
        'description': 'Using :latest tag — not reproducible',
        'remediation': 'Pin to specific version tags',
    },
    'no_healthcheck': {
        'pattern': r'^FROM\s',  # Trigger: Dockerfile exists but...
        'severity': Severity.LOW,
        'description': 'Dockerfile may be missing HEALTHCHECK instruction',
        'remediation': 'Add HEALTHCHECK for container orchestration',
    },
    'exposed_sensitive_port': {
        'pattern': r'EXPOSE\s+(?:22|3306|5432|6379|27017|9200)',
        'severity': Severity.MEDIUM,
        'description': 'Sensitive service port exposed in container',
        'remediation': 'Avoid exposing database/admin ports publicly',
    },
}

K8S_PATTERNS = {
    'no_resource_limits': {
        'pattern': r'containers:(?:(?!resources:).)*$',
        'severity': Severity.MEDIUM,
        'description': 'Container without resource limits — risk of DoS',
        'remediation': 'Set CPU and memory requests/limits',
    },
    'host_network': {
        'pattern': r'hostNetwork:\s*true',
        'severity': Severity.HIGH,
        'description': 'Pod uses host network — breaks network isolation',
        'remediation': 'Remove hostNetwork unless absolutely required',
    },
    'host_pid': {
        'pattern': r'hostPID:\s*true',
        'severity': Severity.HIGH,
        'description': 'Pod uses host PID namespace',
        'remediation': 'Remove hostPID to maintain process isolation',
    },
    'run_as_root': {
        'pattern': r'runAsUser:\s*0',
        'severity': Severity.HIGH,
        'description': 'Container configured to run as root (UID 0)',
        'remediation': 'Set runAsNonRoot: true and specify non-root UID',
    },
    'allow_privilege_escalation': {
        'pattern': r'allowPrivilegeEscalation:\s*true',
        'severity': Severity.HIGH,
        'description': 'Container allows privilege escalation',
        'remediation': 'Set allowPrivilegeEscalation: false',
    },
}

TERRAFORM_PATTERNS = {
    'wildcard_iam': {
        'pattern': r'(?:actions|Action)\s*[=:]\s*\[?\s*["\']?\*["\']?',
        'severity': Severity.CRITICAL,
        'description': 'Wildcard (*) IAM permissions — violates least privilege',
        'remediation': 'Scope IAM policies to specific actions and resources',
    },
    'public_s3': {
        'pattern': r'(?:acl\s*=\s*["\']public|block_public_acls\s*=\s*false)',
        'severity': Severity.CRITICAL,
        'description': 'S3 bucket configured for public access',
        'remediation': 'Enable block_public_acls, block_public_policy, restrict ACL',
    },
    'no_encryption': {
        'pattern': r'(?:encrypted\s*=\s*false|storage_encrypted\s*=\s*false)',
        'severity': Severity.HIGH,
        'description': 'Resource encryption explicitly disabled',
        'remediation': 'Enable encryption at rest for all data stores',
    },
    'open_security_group': {
        'pattern': r'cidr_blocks\s*=\s*\[?\s*["\']0\.0\.0\.0/0["\']',
        'severity': Severity.HIGH,
        'description': 'Security group allows traffic from 0.0.0.0/0',
        'remediation': 'Restrict CIDR blocks to specific IP ranges',
    },
    'no_logging': {
        'pattern': r'enable_logging\s*=\s*false',
        'severity': Severity.MEDIUM,
        'description': 'Logging explicitly disabled on resource',
        'remediation': 'Enable access logging and audit trails',
    },
}

# ---------------------------------------------------------------------------
# Dependency Patterns
# ---------------------------------------------------------------------------

VULNERABLE_DEP_PATTERNS = {
    'lodash_old': {
        'pattern': r'"lodash":\s*"[<^~]?[0-3]\.',
        'severity': Severity.MEDIUM,
        'description': 'Lodash < 4.x has known prototype pollution vulnerabilities',
        'remediation': 'Upgrade to lodash >= 4.17.21',
    },
    'express_old': {
        'pattern': r'"express":\s*"[<^~]?[0-3]\.',
        'severity': Severity.HIGH,
        'description': 'Express < 4.x has known security vulnerabilities',
        'remediation': 'Upgrade to express >= 4.18+',
    },
    'django_old': {
        'pattern': r'Django[<>=]+[12]\.',
        'severity': Severity.HIGH,
        'description': 'Django 1.x/2.x is end-of-life with unpatched vulnerabilities',
        'remediation': 'Upgrade to Django 4.2+ LTS',
    },
    'flask_old': {
        'pattern': r'Flask[<>=]+0\.',
        'severity': Severity.MEDIUM,
        'description': 'Flask 0.x lacks modern security defaults',
        'remediation': 'Upgrade to Flask 3.x',
    },
    'requests_no_verify': {
        'pattern': r'verify\s*=\s*False',
        'severity': Severity.HIGH,
        'description': 'SSL verification disabled for HTTP requests',
        'remediation': 'Enable SSL verification (remove verify=False)',
    },
}

# ---------------------------------------------------------------------------
# File Configuration
# ---------------------------------------------------------------------------

SCANNABLE_EXTENSIONS = {
    '.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.java', '.rb', '.php',
    '.rs', '.cs', '.yaml', '.yml', '.json', '.toml', '.tf', '.hcl',
    '.sh', '.bash', '.sql', '.svelte', '.vue', '.astro',
    '.env', '.env.example', '.env.local',
}

SKIP_DIRS = {
    'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
    '.next', '.svelte-kit', 'dist', 'build', 'target', '.terraform',
    'vendor', '.idea', '.vscode', 'coverage', '.cache', '.tox',
}

CONFIG_FILES = {
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    '.dockerignore', 'Containerfile',
}

DEP_FILES = {
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'requirements.txt', 'Pipfile', 'Pipfile.lock', 'pyproject.toml',
    'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock',
    'pom.xml', 'build.gradle', 'Gemfile', 'Gemfile.lock',
    'composer.json', 'composer.lock',
}


# ---------------------------------------------------------------------------
# Security Auditor Engine
# ---------------------------------------------------------------------------

class SecurityAuditor:
    """Multi-layer security posture auditor."""

    def __init__(self, target_path: str, scope: str = "full",
                 min_severity: str = "low", verbose: bool = False):
        self.target_path = Path(target_path).resolve()
        self.scope = AuditScope(scope)
        self.min_severity = Severity[min_severity.upper()]
        self.verbose = verbose
        self.findings: List[Finding] = []
        self.files_scanned = 0
        self.stats: Dict[str, int] = defaultdict(int)

    def run(self) -> Dict:
        """Execute the full security audit."""
        print(f"\n{'='*70}")
        print(f"  SECURITY AUDITOR — Multi-Layer Posture Assessment")
        print(f"  Target: {self.target_path}")
        print(f"  Scope: {self.scope.value}")
        print(f"  Min Severity: {self.min_severity.value}")
        print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*70}\n")

        if not self.target_path.exists():
            print(f"❌ Target path does not exist: {self.target_path}")
            sys.exit(1)

        scopes = {
            AuditScope.FULL: ['secrets', 'deps', 'config', 'code'],
            AuditScope.SECRETS: ['secrets'],
            AuditScope.DEPS: ['deps'],
            AuditScope.CONFIG: ['config'],
            AuditScope.CODE: ['code'],
        }

        active_scopes = scopes[self.scope]

        if 'secrets' in active_scopes:
            print("🔐 Scanning for secrets...")
            self._scan_secrets()
            print(f"   Found {self.stats['secrets']} secret(s)\n")

        if 'deps' in active_scopes:
            print("📦 Checking dependencies...")
            self._scan_dependencies()
            print(f"   Found {self.stats['deps']} dependency issue(s)\n")

        if 'config' in active_scopes:
            print("⚙️  Auditing configurations...")
            self._audit_configs()
            print(f"   Found {self.stats['config']} config issue(s)\n")

        if 'code' in active_scopes:
            print("🔍 Analyzing code patterns...")
            self._scan_code_patterns()
            print(f"   Found {self.stats['code']} code vulnerability pattern(s)\n")

        # Filter by minimum severity
        self.findings = [
            f for f in self.findings
            if f.severity.numeric >= self.min_severity.numeric
        ]

        return self._build_results()

    def _scan_secrets(self):
        """Scan for hardcoded secrets."""
        for fpath in self._walk_files():
            # Skip binary files and lock files
            if fpath.suffix in ('.lock', '.png', '.jpg', '.gif', '.ico', '.woff', '.woff2'):
                continue

            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            rel_path = str(fpath.relative_to(self.target_path))

            for rule_id, rule in SECRET_PATTERNS.items():
                for line_num, line in enumerate(content.splitlines(), 1):
                    if re.search(rule['pattern'], line, re.IGNORECASE):
                        # Skip test files and examples
                        if any(skip in rel_path.lower() for skip in ['test', 'spec', 'mock', 'fixture', 'example']):
                            continue
                        # Redact the actual secret
                        evidence = re.sub(
                            r'(["\'])[^"\']{4}[^"\']*(["\'])',
                            r'\1****REDACTED****\2',
                            line.strip()[:120]
                        )
                        self.findings.append(Finding(
                            rule_id=f"SEC-{rule_id.upper()}",
                            title=rule['description'],
                            severity=rule['severity'],
                            category="Secrets",
                            description=rule['description'],
                            file_path=rel_path,
                            line_number=line_num,
                            evidence=evidence,
                            remediation=f"Move to environment variable or secret manager",
                            cwe=rule.get('cwe', ''),
                            owasp=rule.get('owasp', ''),
                        ))
                        self.stats['secrets'] += 1

    def _scan_dependencies(self):
        """Scan dependency files for known vulnerable patterns."""
        for fpath in self._walk_files():
            if fpath.name not in DEP_FILES:
                continue

            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            rel_path = str(fpath.relative_to(self.target_path))

            for rule_id, rule in VULNERABLE_DEP_PATTERNS.items():
                for line_num, line in enumerate(content.splitlines(), 1):
                    if re.search(rule['pattern'], line, re.IGNORECASE):
                        self.findings.append(Finding(
                            rule_id=f"DEP-{rule_id.upper()}",
                            title=rule['description'],
                            severity=rule['severity'],
                            category="Dependencies",
                            description=rule['description'],
                            file_path=rel_path,
                            line_number=line_num,
                            evidence=line.strip()[:120],
                            remediation=rule['remediation'],
                        ))
                        self.stats['deps'] += 1

    def _audit_configs(self):
        """Audit configuration files for security anti-patterns."""
        config_pattern_sets = {
            'Docker': (DOCKER_PATTERNS, {'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'Containerfile'}),
            'Kubernetes': (K8S_PATTERNS, {'.yaml', '.yml'}),
            'Terraform': (TERRAFORM_PATTERNS, {'.tf', '.hcl'}),
        }

        for fpath in self._walk_files():
            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            rel_path = str(fpath.relative_to(self.target_path))

            for config_type, (patterns, file_match) in config_pattern_sets.items():
                # Check if file matches this config type
                matches = fpath.name in file_match or fpath.suffix in file_match
                if not matches:
                    continue

                for rule_id, rule in patterns.items():
                    for line_num, line in enumerate(content.splitlines(), 1):
                        if re.search(rule['pattern'], line, re.IGNORECASE):
                            self.findings.append(Finding(
                                rule_id=f"CFG-{rule_id.upper()}",
                                title=f"[{config_type}] {rule['description']}",
                                severity=rule['severity'],
                                category=f"Configuration ({config_type})",
                                description=rule['description'],
                                file_path=rel_path,
                                line_number=line_num,
                                evidence=line.strip()[:120],
                                remediation=rule['remediation'],
                            ))
                            self.stats['config'] += 1

    def _scan_code_patterns(self):
        """Scan code for vulnerability patterns."""
        code_extensions = {'.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.java',
                          '.rb', '.php', '.rs', '.cs', '.svelte', '.vue'}

        for fpath in self._walk_files():
            if fpath.suffix not in code_extensions:
                continue

            self.files_scanned += 1

            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            rel_path = str(fpath.relative_to(self.target_path))

            for rule_id, rule in CODE_PATTERNS.items():
                for line_num, line in enumerate(content.splitlines(), 1):
                    # Skip comments
                    stripped = line.strip()
                    if stripped.startswith(('#', '//', '/*', '*', '<!--')):
                        continue
                    if re.search(rule['pattern'], line, re.IGNORECASE):
                        self.findings.append(Finding(
                            rule_id=f"CODE-{rule_id.upper()}",
                            title=rule['description'],
                            severity=rule['severity'],
                            category="Code Vulnerability",
                            description=rule['description'],
                            file_path=rel_path,
                            line_number=line_num,
                            evidence=stripped[:120],
                            remediation=rule.get('remediation', ''),
                            cwe=rule.get('cwe', ''),
                            owasp=rule.get('owasp', ''),
                        ))
                        self.stats['code'] += 1

    def _build_results(self) -> Dict:
        """Build structured results."""
        by_severity = defaultdict(int)
        by_category = defaultdict(int)
        for f in self.findings:
            by_severity[f.severity.value] += 1
            by_category[f.category] += 1

        return {
            'metadata': {
                'target': str(self.target_path),
                'scope': self.scope.value,
                'min_severity': self.min_severity.value,
                'timestamp': datetime.now().isoformat(),
                'files_scanned': self.files_scanned,
            },
            'summary': {
                'total_findings': len(self.findings),
                'by_severity': dict(by_severity),
                'by_category': dict(by_category),
            },
            'findings': [
                {
                    'rule_id': f.rule_id,
                    'title': f.title,
                    'severity': f.severity.value,
                    'category': f.category,
                    'description': f.description,
                    'file': f.file_path,
                    'line': f.line_number,
                    'evidence': f.evidence,
                    'remediation': f.remediation,
                    'cwe': f.cwe,
                    'owasp': f.owasp,
                }
                for f in sorted(self.findings, key=lambda x: -x.severity.numeric)
            ],
        }

    def generate_markdown_report(self, results: Dict) -> str:
        """Generate markdown audit report."""
        lines = []
        meta = results['metadata']
        summary = results['summary']

        lines.append(f"# Security Audit Report")
        lines.append(f"")
        lines.append(f"**Target**: `{meta['target']}`")
        lines.append(f"**Scope**: {meta['scope']}")
        lines.append(f"**Generated**: {meta['timestamp']}")
        lines.append(f"**Files Scanned**: {meta['files_scanned']}")
        lines.append(f"**Total Findings**: {summary['total_findings']}")
        lines.append(f"")

        # Severity summary
        lines.append(f"## Severity Summary")
        lines.append(f"")
        lines.append(f"| Severity | Count |")
        lines.append(f"|----------|-------|")
        for sev in ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']:
            count = summary['by_severity'].get(sev, 0)
            if count > 0:
                icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}.get(sev, "⚪")
                lines.append(f"| {icon} {sev} | {count} |")
        lines.append(f"")

        # Category summary
        lines.append(f"## Category Breakdown")
        lines.append(f"")
        lines.append(f"| Category | Findings |")
        lines.append(f"|----------|----------|")
        for cat, count in summary['by_category'].items():
            lines.append(f"| {cat} | {count} |")
        lines.append(f"")

        # Findings
        lines.append(f"## Findings")
        lines.append(f"")

        current_severity = None
        for f in results['findings']:
            if f['severity'] != current_severity:
                current_severity = f['severity']
                icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}.get(current_severity, "⚪")
                lines.append(f"### {icon} {current_severity}")
                lines.append(f"")

            lines.append(f"#### [{f['rule_id']}] {f['title']}")
            lines.append(f"")
            lines.append(f"- **File**: `{f['file']}:{f['line']}`")
            lines.append(f"- **Category**: {f['category']}")
            if f['evidence']:
                lines.append(f"- **Evidence**: `{f['evidence']}`")
            if f['remediation']:
                lines.append(f"- **Remediation**: {f['remediation']}")
            if f['cwe']:
                lines.append(f"- **CWE**: {f['cwe']}")
            if f['owasp']:
                lines.append(f"- **OWASP**: {f['owasp']}")
            lines.append(f"")

        return "\n".join(lines)

    def generate_sarif(self, results: Dict) -> Dict:
        """Generate SARIF v2.1 output for integration with GitHub/GitLab."""
        rules = {}
        sarif_results = []

        for f in results['findings']:
            if f['rule_id'] not in rules:
                rules[f['rule_id']] = {
                    "id": f['rule_id'],
                    "name": f['rule_id'],
                    "shortDescription": {"text": f['title']},
                    "fullDescription": {"text": f['description']},
                    "defaultConfiguration": {
                        "level": {
                            "CRITICAL": "error",
                            "HIGH": "error",
                            "MEDIUM": "warning",
                            "LOW": "note",
                            "INFO": "note",
                        }.get(f['severity'], "warning")
                    },
                    "helpUri": f"https://cwe.mitre.org/data/definitions/{f['cwe'].split('-')[-1]}.html" if f['cwe'] else "",
                }

            sarif_results.append({
                "ruleId": f['rule_id'],
                "level": {
                    "CRITICAL": "error", "HIGH": "error",
                    "MEDIUM": "warning", "LOW": "note", "INFO": "note",
                }.get(f['severity'], "warning"),
                "message": {"text": f['description']},
                "locations": [{
                    "physicalLocation": {
                        "artifactLocation": {"uri": f['file']},
                        "region": {"startLine": f['line']},
                    }
                }],
            })

        return {
            "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
            "version": "2.1.0",
            "runs": [{
                "tool": {
                    "driver": {
                        "name": "SecurityAuditor",
                        "version": "2.0.0",
                        "rules": list(rules.values()),
                    }
                },
                "results": sarif_results,
            }],
        }

    def _walk_files(self):
        """Walk target directory yielding scannable files."""
        if self.target_path.is_file():
            yield self.target_path
            return

        for root, dirs, files in os.walk(self.target_path):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                fpath = Path(root) / fname
                if (fpath.suffix in SCANNABLE_EXTENSIONS or
                        fname in CONFIG_FILES or fname in DEP_FILES or
                        fname.startswith('.env')):
                    yield fpath


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Multi-Layer Security Posture Auditor",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python security_auditor.py /path/to/project
  python security_auditor.py ./my-app --scope secrets --severity critical
  python security_auditor.py ./my-app --scope full --json --output audit.json
  python security_auditor.py ./my-app --sarif --output audit.sarif.json
  python security_auditor.py ./my-app --scope config -v
        """
    )
    parser.add_argument('target', help='Target directory or file to audit')
    parser.add_argument('--scope', '-s', choices=['full', 'secrets', 'deps', 'config', 'code'],
                        default='full', help='Audit scope (default: full)')
    parser.add_argument('--severity', choices=['critical', 'high', 'medium', 'low', 'info'],
                        default='low', help='Minimum severity to report (default: low)')
    parser.add_argument('--output', '-o', help='Output file path')
    parser.add_argument('--json', action='store_true', help='Output as JSON')
    parser.add_argument('--sarif', action='store_true', help='Output in SARIF format')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')

    args = parser.parse_args()

    auditor = SecurityAuditor(
        args.target, scope=args.scope,
        min_severity=args.severity, verbose=args.verbose
    )
    results = auditor.run()

    if args.sarif:
        sarif = auditor.generate_sarif(results)
        output = json.dumps(sarif, indent=2)
        if args.output:
            Path(args.output).write_text(output)
            print(f"\n✅ SARIF report saved to: {args.output}")
        else:
            print(output)
    elif args.json:
        output = json.dumps(results, indent=2)
        if args.output:
            Path(args.output).write_text(output)
            print(f"\n✅ JSON report saved to: {args.output}")
        else:
            print(output)
    else:
        report = auditor.generate_markdown_report(results)
        if args.output:
            Path(args.output).write_text(report)
            print(f"\n✅ Markdown report saved to: {args.output}")
        else:
            print(report)

    # Exit summary
    total = results['summary']['total_findings']
    critical = results['summary']['by_severity'].get('CRITICAL', 0)
    high = results['summary']['by_severity'].get('HIGH', 0)

    print(f"\n{'='*70}")
    print(f"  SECURITY AUDIT COMPLETE")
    print(f"  {total} finding(s) ({critical} critical, {high} high)")
    print(f"{'='*70}\n")

    sys.exit(1 if critical > 0 else 0)


if __name__ == '__main__':
    main()
