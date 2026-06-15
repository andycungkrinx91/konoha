#!/usr/bin/env python3
"""
Threat Modeler — STRIDE-Based Threat Modeling Engine

Scans project structure to identify entry points, classify assets, apply the
STRIDE framework, detect common attack surfaces, and generate threat models
with DREAD severity scoring.

Usage:
    python threat_modeler.py <target_dir> [--framework stride|pasta] [--output report.md] [--json]

Requires: Python 3.8+ (stdlib only)
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Enums & Data Classes
# ---------------------------------------------------------------------------

class ThreatCategory(Enum):
    SPOOFING = "Spoofing"
    TAMPERING = "Tampering"
    REPUDIATION = "Repudiation"
    INFORMATION_DISCLOSURE = "Information Disclosure"
    DENIAL_OF_SERVICE = "Denial of Service"
    ELEVATION_OF_PRIVILEGE = "Elevation of Privilege"


class Severity(Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


class AssetType(Enum):
    API_ENDPOINT = "API Endpoint"
    DATABASE = "Database"
    AUTH_GATE = "Authentication Gate"
    FILE_IO = "File I/O"
    NETWORK_INTERFACE = "Network Interface"
    SECRET_STORE = "Secret Store"
    USER_INPUT = "User Input Handler"
    EXTERNAL_SERVICE = "External Service Integration"
    MESSAGE_QUEUE = "Message Queue"
    CACHE = "Cache Layer"


@dataclass
class DREADScore:
    """DREAD risk scoring model."""
    damage: int = 5          # 1-10
    reproducibility: int = 5 # 1-10
    exploitability: int = 5  # 1-10
    affected_users: int = 5  # 1-10
    discoverability: int = 5 # 1-10

    @property
    def overall(self) -> float:
        return (self.damage + self.reproducibility + self.exploitability +
                self.affected_users + self.discoverability) / 5.0

    @property
    def severity(self) -> Severity:
        score = self.overall
        if score >= 8.0:
            return Severity.CRITICAL
        elif score >= 6.0:
            return Severity.HIGH
        elif score >= 4.0:
            return Severity.MEDIUM
        elif score >= 2.0:
            return Severity.LOW
        return Severity.INFO


@dataclass
class Asset:
    """Represents an identified asset in the project."""
    name: str
    asset_type: AssetType
    file_path: str
    line_number: int = 0
    description: str = ""
    trust_boundary: str = "internal"  # internal, external, dmz


@dataclass
class Threat:
    """Represents an identified threat."""
    id: str
    title: str
    category: ThreatCategory
    description: str
    affected_asset: str
    attack_vector: str
    dread: DREADScore
    mitigation: str
    file_path: str = ""
    line_number: int = 0

    @property
    def severity(self) -> Severity:
        return self.dread.severity


@dataclass
class DataFlow:
    """Represents a data flow between components."""
    source: str
    destination: str
    data_type: str
    protocol: str = "internal"
    encrypted: bool = False
    trust_boundary_crossing: bool = False


# ---------------------------------------------------------------------------
# Pattern Detectors
# ---------------------------------------------------------------------------

# Patterns for detecting entry points and assets
ENDPOINT_PATTERNS = {
    # Python/FastAPI/Flask/Django
    r'@app\.(get|post|put|delete|patch|route)\s*\(': ('API Endpoint', 'Python web framework route'),
    r'@router\.(get|post|put|delete|patch)\s*\(': ('API Endpoint', 'FastAPI router'),
    r'path\s*\(\s*["\']': ('API Endpoint', 'Django URL pattern'),
    r'url\s*\(\s*r?["\']': ('API Endpoint', 'Django URL conf'),
    # Node.js/Express
    r'(app|router)\.(get|post|put|delete|patch|all)\s*\(': ('API Endpoint', 'Express.js route'),
    r'export\s+(async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)': ('API Endpoint', 'Next.js route handler'),
    # Go
    r'(http\.HandleFunc|mux\.Handle|r\.HandleFunc)\s*\(': ('API Endpoint', 'Go HTTP handler'),
    # Java/Spring
    r'@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping)': ('API Endpoint', 'Spring MVC mapping'),
    # Laravel
    r'Route::(get|post|put|delete|patch|any)\s*\(': ('API Endpoint', 'Laravel route'),
}

AUTH_PATTERNS = {
    r'(authenticate|login|signin|sign_in|auth_required|requires_auth)': ('Authentication Gate', 'Auth function'),
    r'@(login_required|auth|authenticated|requires_login)': ('Authentication Gate', 'Auth decorator'),
    r'(jwt|bearer|oauth|saml|openid)': ('Authentication Gate', 'Auth protocol reference'),
    r'(passport\.authenticate|next-auth|authMiddleware|AuthGuard)': ('Authentication Gate', 'Auth middleware'),
    r'(bcrypt|argon2|scrypt|pbkdf2)': ('Authentication Gate', 'Password hashing'),
}

DATABASE_PATTERNS = {
    r'(mongoose\.|sequelize\.|prisma\.|typeorm\.|sqlalchemy\.)': ('Database', 'ORM usage'),
    r'(CREATE TABLE|ALTER TABLE|DROP TABLE|INSERT INTO|SELECT .+ FROM)': ('Database', 'Raw SQL'),
    r'(\.query\(|\.execute\(|\.raw\(|cursor\.)': ('Database', 'DB query execution'),
    r'(redis\.|memcached|elasticsearch)': ('Cache', 'Cache/search engine'),
    r'(MongoDB|PostgreSQL|MySQL|SQLite|DynamoDB)': ('Database', 'DB reference'),
}

FILE_IO_PATTERNS = {
    r'(open\(|readFile|writeFile|createReadStream|createWriteStream)': ('File I/O', 'File operation'),
    r'(fs\.(read|write|unlink|mkdir|rmdir|rename))': ('File I/O', 'Node.js fs operation'),
    r'(multer|formidable|busboy|upload|multipart)': ('File I/O', 'File upload handler'),
    r'(Path\(|os\.path\.|shutil\.)': ('File I/O', 'Python path operation'),
}

SECRET_PATTERNS = {
    r'(API_KEY|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN|CLIENT_SECRET)': ('Secret Store', 'Secret reference'),
    r'(process\.env\.|os\.environ|getenv|dotenv)': ('Secret Store', 'Environment variable'),
    r'(vault|aws_secret|secret_manager|keyring)': ('Secret Store', 'Secret manager'),
}

EXTERNAL_SERVICE_PATTERNS = {
    r'(fetch\(|axios\.|requests\.|http\.get|urllib|httpx\.)': ('External Service', 'HTTP client call'),
    r'(smtp|sendgrid|ses\.send|twilio|stripe|paypal)': ('External Service', 'Third-party service'),
    r'(grpc|graphql|websocket|socket\.io)': ('External Service', 'Protocol/transport'),
    r'(kafka|rabbitmq|amqp|celery|bull|sqs|pubsub)': ('Message Queue', 'Message broker'),
}

# Patterns indicating security concerns
SECURITY_CONCERN_PATTERNS = {
    'hardcoded_secret': (
        r'(password|secret|token|key|api_key)\s*=\s*["\'][^"\']{8,}["\']',
        DREADScore(damage=8, reproducibility=9, exploitability=9, affected_users=8, discoverability=7),
        'Hardcoded secret detected',
        'Move to environment variable or secret manager'
    ),
    'sql_injection': (
        r'(f".*SELECT|f".*INSERT|f".*UPDATE|f".*DELETE|".*\+.*SELECT|`\$\{.*\}.*SELECT)',
        DREADScore(damage=9, reproducibility=8, exploitability=8, affected_users=9, discoverability=6),
        'Potential SQL injection via string interpolation',
        'Use parameterized queries or ORM'
    ),
    'command_injection': (
        r'(os\.system\(|subprocess\.call\(.*shell=True|exec\(|eval\()',
        DREADScore(damage=10, reproducibility=7, exploitability=7, affected_users=9, discoverability=5),
        'Potential command injection',
        'Use subprocess with shell=False, avoid eval/exec'
    ),
    'path_traversal': (
        r'(\.\.\/|\.\.\\\\|path\.join\(.*req\.|os\.path\.join\(.*input)',
        DREADScore(damage=7, reproducibility=8, exploitability=7, affected_users=6, discoverability=6),
        'Potential path traversal vulnerability',
        'Validate and sanitize file paths, use allowlists'
    ),
    'insecure_deserialization': (
        r'(pickle\.loads?|yaml\.load\((?!.*Loader)|unserialize\(|JSON\.parse\(.*req)',
        DREADScore(damage=9, reproducibility=6, exploitability=6, affected_users=8, discoverability=4),
        'Potential insecure deserialization',
        'Use safe loaders (yaml.safe_load), validate input before deserializing'
    ),
    'ssrf_prone': (
        r'(requests\.get\(.*\+|fetch\(.*\+|urllib\.request\.urlopen\(.*\+|http\.get\(.*\+)',
        DREADScore(damage=7, reproducibility=7, exploitability=7, affected_users=6, discoverability=5),
        'Potential SSRF — URL constructed from user input',
        'Validate URLs against allowlist, block internal IPs'
    ),
    'cors_wildcard': (
        r'(Access-Control-Allow-Origin.*\*|cors\(\{.*origin.*\*|CORS_ALLOW_ALL)',
        DREADScore(damage=5, reproducibility=9, exploitability=8, affected_users=7, discoverability=8),
        'CORS wildcard allows any origin',
        'Restrict CORS to specific trusted origins'
    ),
    'weak_crypto': (
        r'(md5|sha1|DES|RC4|ECB)\s*[\(\.]',
        DREADScore(damage=6, reproducibility=9, exploitability=5, affected_users=7, discoverability=4),
        'Weak cryptographic algorithm',
        'Use SHA-256+, AES-GCM, or modern alternatives'
    ),
    'debug_mode': (
        r'(DEBUG\s*=\s*True|debug:\s*true|NODE_ENV.*development)',
        DREADScore(damage=4, reproducibility=9, exploitability=6, affected_users=5, discoverability=8),
        'Debug mode enabled — may expose sensitive info in production',
        'Ensure debug is disabled in production deployments'
    ),
    'missing_auth_check': (
        r'(# ?TODO:?\s*auth|// ?TODO:?\s*auth|# ?FIXME:?\s*auth)',
        DREADScore(damage=8, reproducibility=8, exploitability=8, affected_users=8, discoverability=3),
        'Missing authentication check (TODO marker found)',
        'Implement proper authentication before deployment'
    ),
}

# File extensions to scan
SCANNABLE_EXTENSIONS = {
    '.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.java', '.rb', '.php',
    '.rs', '.cs', '.yaml', '.yml', '.json', '.toml', '.tf', '.hcl',
    '.sh', '.bash', '.env', '.env.example', '.sql',
    '.svelte', '.vue', '.astro',
}

# Files/directories to skip
SKIP_DIRS = {
    'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
    '.next', '.svelte-kit', 'dist', 'build', 'target', '.terraform',
    'vendor', '.idea', '.vscode', 'coverage', '.cache',
}


# ---------------------------------------------------------------------------
# Threat Modeler Engine
# ---------------------------------------------------------------------------

class ThreatModeler:
    """STRIDE-based threat modeling engine."""

    def __init__(self, target_path: str, framework: str = "stride", verbose: bool = False):
        self.target_path = Path(target_path).resolve()
        self.framework = framework
        self.verbose = verbose
        self.assets: List[Asset] = []
        self.threats: List[Threat] = []
        self.data_flows: List[DataFlow] = []
        self.files_scanned = 0
        self.threat_counter = 0

    def run(self) -> Dict:
        """Execute the full threat modeling pipeline."""
        print(f"\n{'='*70}")
        print(f"  THREAT MODELER — {self.framework.upper()} Framework")
        print(f"  Target: {self.target_path}")
        print(f"  Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*70}\n")

        if not self.target_path.exists():
            print(f"❌ Target path does not exist: {self.target_path}")
            sys.exit(1)

        # Phase 1: Asset Discovery
        print("📡 Phase 1: Asset Discovery...")
        self._discover_assets()
        print(f"   Found {len(self.assets)} assets across {self.files_scanned} files\n")

        # Phase 2: Data Flow Analysis
        print("🔄 Phase 2: Data Flow Analysis...")
        self._analyze_data_flows()
        print(f"   Mapped {len(self.data_flows)} data flows\n")

        # Phase 3: Threat Identification (STRIDE)
        print("🎯 Phase 3: Threat Identification (STRIDE)...")
        self._identify_stride_threats()
        print(f"   Identified {len(self.threats)} potential threats\n")

        # Phase 4: Security Pattern Scanning
        print("🔍 Phase 4: Security Pattern Scanning...")
        initial_count = len(self.threats)
        self._scan_security_patterns()
        print(f"   Found {len(self.threats) - initial_count} additional security concerns\n")

        # Phase 5: Risk Assessment
        print("📊 Phase 5: Risk Assessment (DREAD Scoring)...")
        self._assess_risks()

        return self._build_results()

    def _discover_assets(self):
        """Scan project to discover assets and entry points."""
        all_patterns = {}
        all_patterns.update(ENDPOINT_PATTERNS)
        all_patterns.update(AUTH_PATTERNS)
        all_patterns.update(DATABASE_PATTERNS)
        all_patterns.update(FILE_IO_PATTERNS)
        all_patterns.update(SECRET_PATTERNS)
        all_patterns.update(EXTERNAL_SERVICE_PATTERNS)

        type_map = {
            'API Endpoint': AssetType.API_ENDPOINT,
            'Authentication Gate': AssetType.AUTH_GATE,
            'Database': AssetType.DATABASE,
            'Cache': AssetType.CACHE,
            'File I/O': AssetType.FILE_IO,
            'Secret Store': AssetType.SECRET_STORE,
            'External Service': AssetType.EXTERNAL_SERVICE,
            'Message Queue': AssetType.MESSAGE_QUEUE,
        }

        for fpath in self._walk_files():
            self.files_scanned += 1
            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            for line_num, line in enumerate(content.splitlines(), 1):
                for pattern, (asset_cat, desc) in all_patterns.items():
                    if re.search(pattern, line, re.IGNORECASE):
                        at = type_map.get(asset_cat, AssetType.EXTERNAL_SERVICE)
                        asset = Asset(
                            name=f"{at.value}: {fpath.name}:{line_num}",
                            asset_type=at,
                            file_path=str(fpath.relative_to(self.target_path)),
                            line_number=line_num,
                            description=desc,
                            trust_boundary="external" if at in (
                                AssetType.API_ENDPOINT, AssetType.USER_INPUT
                            ) else "internal"
                        )
                        self.assets.append(asset)
                        break  # One match per line is enough

    def _analyze_data_flows(self):
        """Infer data flows between discovered assets."""
        endpoints = [a for a in self.assets if a.asset_type == AssetType.API_ENDPOINT]
        databases = [a for a in self.assets if a.asset_type == AssetType.DATABASE]
        externals = [a for a in self.assets if a.asset_type == AssetType.EXTERNAL_SERVICE]
        auth_gates = [a for a in self.assets if a.asset_type == AssetType.AUTH_GATE]
        file_ios = [a for a in self.assets if a.asset_type == AssetType.FILE_IO]

        # Client → API endpoints
        for ep in endpoints:
            self.data_flows.append(DataFlow(
                source="Client (Browser/Mobile)",
                destination=ep.name,
                data_type="HTTP Request",
                protocol="HTTPS",
                encrypted=True,
                trust_boundary_crossing=True
            ))

        # Endpoints → Databases
        for db in databases:
            self.data_flows.append(DataFlow(
                source="Application Logic",
                destination=db.name,
                data_type="Query/Mutation",
                protocol="TCP",
                encrypted=False,
                trust_boundary_crossing=False
            ))

        # Endpoints → External services
        for ext in externals:
            self.data_flows.append(DataFlow(
                source="Application Logic",
                destination=ext.name,
                data_type="API Call",
                protocol="HTTPS",
                encrypted=True,
                trust_boundary_crossing=True
            ))

        # Auth flows
        for ag in auth_gates:
            self.data_flows.append(DataFlow(
                source="Client Credentials",
                destination=ag.name,
                data_type="Auth Credentials",
                protocol="HTTPS",
                encrypted=True,
                trust_boundary_crossing=True
            ))

        # File I/O flows
        for fio in file_ios:
            self.data_flows.append(DataFlow(
                source="Application Logic",
                destination=fio.name,
                data_type="File Data",
                protocol="filesystem",
                encrypted=False,
                trust_boundary_crossing=False
            ))

    def _identify_stride_threats(self):
        """Apply STRIDE categories to discovered assets."""
        stride_mappings = {
            AssetType.API_ENDPOINT: [
                (ThreatCategory.SPOOFING, "Unauthenticated access to endpoint",
                 "Attacker bypasses authentication to access API",
                 DREADScore(8, 7, 6, 8, 5),
                 "Implement strong authentication (JWT, OAuth2) on all endpoints"),
                (ThreatCategory.TAMPERING, "Request parameter manipulation",
                 "Attacker modifies request parameters to alter behavior",
                 DREADScore(7, 8, 7, 7, 6),
                 "Validate and sanitize all input, use schema validation"),
                (ThreatCategory.DENIAL_OF_SERVICE, "Endpoint flooding",
                 "Attacker sends excessive requests to overwhelm the service",
                 DREADScore(6, 9, 8, 9, 8),
                 "Implement rate limiting, request throttling, and CDN protection"),
            ],
            AssetType.DATABASE: [
                (ThreatCategory.TAMPERING, "Data integrity compromise",
                 "Attacker modifies database records through injection or direct access",
                 DREADScore(9, 6, 5, 9, 4),
                 "Use parameterized queries, implement audit logging, encrypt at rest"),
                (ThreatCategory.INFORMATION_DISCLOSURE, "Data exfiltration",
                 "Attacker reads sensitive data from database",
                 DREADScore(9, 7, 6, 9, 5),
                 "Encrypt sensitive fields, implement column-level access control"),
                (ThreatCategory.REPUDIATION, "Unlogged data changes",
                 "Data modifications without audit trail",
                 DREADScore(6, 8, 7, 7, 3),
                 "Enable audit logging, use immutable event sourcing for critical data"),
            ],
            AssetType.AUTH_GATE: [
                (ThreatCategory.SPOOFING, "Credential stuffing / brute force",
                 "Attacker uses automated tools to guess credentials",
                 DREADScore(8, 9, 7, 8, 7),
                 "Implement account lockout, CAPTCHA, MFA, rate limiting"),
                (ThreatCategory.ELEVATION_OF_PRIVILEGE, "Privilege escalation through auth bypass",
                 "Attacker gains higher privileges than intended",
                 DREADScore(10, 5, 5, 9, 4),
                 "Implement RBAC, validate permissions server-side, use principle of least privilege"),
            ],
            AssetType.FILE_IO: [
                (ThreatCategory.TAMPERING, "Malicious file upload",
                 "Attacker uploads executable or oversized files",
                 DREADScore(8, 7, 7, 7, 6),
                 "Validate file types, scan for malware, limit file size, store outside webroot"),
                (ThreatCategory.INFORMATION_DISCLOSURE, "Path traversal for file access",
                 "Attacker uses ../ to read arbitrary files",
                 DREADScore(8, 8, 7, 6, 6),
                 "Sanitize file paths, use allowlists, chroot file access"),
            ],
            AssetType.SECRET_STORE: [
                (ThreatCategory.INFORMATION_DISCLOSURE, "Secret leakage",
                 "Secrets exposed through logs, errors, or version control",
                 DREADScore(9, 7, 8, 9, 6),
                 "Use secret managers (Vault, AWS SM), rotate secrets, scan for leaks in CI"),
            ],
            AssetType.EXTERNAL_SERVICE: [
                (ThreatCategory.SPOOFING, "Man-in-the-middle on external API calls",
                 "Attacker intercepts communication with third-party services",
                 DREADScore(7, 5, 5, 7, 4),
                 "Use TLS, verify certificates, implement certificate pinning"),
                (ThreatCategory.DENIAL_OF_SERVICE, "Dependency on external service availability",
                 "External service outage cascades to application failure",
                 DREADScore(5, 7, 3, 8, 7),
                 "Implement circuit breakers, fallback mechanisms, caching"),
            ],
            AssetType.MESSAGE_QUEUE: [
                (ThreatCategory.TAMPERING, "Message injection/poisoning",
                 "Attacker injects malicious messages into the queue",
                 DREADScore(7, 6, 5, 7, 4),
                 "Authenticate producers, validate message schemas, use signed messages"),
                (ThreatCategory.REPUDIATION, "Untracked message processing",
                 "No audit trail for processed messages",
                 DREADScore(4, 8, 5, 5, 3),
                 "Log message processing with correlation IDs"),
            ],
        }

        asset_type_counts = defaultdict(int)
        for asset in self.assets:
            asset_type_counts[asset.asset_type] += 1

        for asset_type, count in asset_type_counts.items():
            if asset_type in stride_mappings:
                for category, title, desc, dread, mitigation in stride_mappings[asset_type]:
                    self.threat_counter += 1
                    representative = next(
                        (a for a in self.assets if a.asset_type == asset_type), None
                    )
                    self.threats.append(Threat(
                        id=f"T-{self.threat_counter:03d}",
                        title=title,
                        category=category,
                        description=f"{desc} ({count} {asset_type.value} instance(s) found)",
                        affected_asset=asset_type.value,
                        attack_vector=f"Targets {count} {asset_type.value} component(s)",
                        dread=dread,
                        mitigation=mitigation,
                        file_path=representative.file_path if representative else "",
                        line_number=representative.line_number if representative else 0,
                    ))

    def _scan_security_patterns(self):
        """Scan for specific security anti-patterns in code."""
        for fpath in self._walk_files():
            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            rel_path = str(fpath.relative_to(self.target_path))

            for pattern_name, (pattern, dread, desc, mitigation) in SECURITY_CONCERN_PATTERNS.items():
                for line_num, line in enumerate(content.splitlines(), 1):
                    if re.search(pattern, line, re.IGNORECASE):
                        self.threat_counter += 1
                        self.threats.append(Threat(
                            id=f"T-{self.threat_counter:03d}",
                            title=f"{desc}",
                            category=self._categorize_pattern(pattern_name),
                            description=f"Found in {rel_path}:{line_num} — {line.strip()[:80]}",
                            affected_asset=rel_path,
                            attack_vector=pattern_name.replace('_', ' ').title(),
                            dread=dread,
                            mitigation=mitigation,
                            file_path=rel_path,
                            line_number=line_num,
                        ))

    def _categorize_pattern(self, pattern_name: str) -> ThreatCategory:
        """Map pattern names to STRIDE categories."""
        mapping = {
            'hardcoded_secret': ThreatCategory.INFORMATION_DISCLOSURE,
            'sql_injection': ThreatCategory.TAMPERING,
            'command_injection': ThreatCategory.ELEVATION_OF_PRIVILEGE,
            'path_traversal': ThreatCategory.INFORMATION_DISCLOSURE,
            'insecure_deserialization': ThreatCategory.TAMPERING,
            'ssrf_prone': ThreatCategory.SPOOFING,
            'cors_wildcard': ThreatCategory.SPOOFING,
            'weak_crypto': ThreatCategory.INFORMATION_DISCLOSURE,
            'debug_mode': ThreatCategory.INFORMATION_DISCLOSURE,
            'missing_auth_check': ThreatCategory.SPOOFING,
        }
        return mapping.get(pattern_name, ThreatCategory.INFORMATION_DISCLOSURE)

    def _assess_risks(self):
        """Print risk assessment summary."""
        by_severity = defaultdict(list)
        for t in self.threats:
            by_severity[t.severity].append(t)

        for sev in [Severity.CRITICAL, Severity.HIGH, Severity.MEDIUM, Severity.LOW, Severity.INFO]:
            count = len(by_severity.get(sev, []))
            if count > 0:
                icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}.get(sev.value, "⚪")
                print(f"   {icon} {sev.value}: {count} threat(s)")

    def _build_results(self) -> Dict:
        """Build structured results dictionary."""
        return {
            'metadata': {
                'target': str(self.target_path),
                'framework': self.framework,
                'timestamp': datetime.now().isoformat(),
                'files_scanned': self.files_scanned,
            },
            'summary': {
                'total_assets': len(self.assets),
                'total_threats': len(self.threats),
                'total_data_flows': len(self.data_flows),
                'by_severity': {
                    sev.value: len([t for t in self.threats if t.severity == sev])
                    for sev in Severity
                },
                'by_category': {
                    cat.value: len([t for t in self.threats if t.category == cat])
                    for cat in ThreatCategory
                },
            },
            'assets': [
                {
                    'name': a.name,
                    'type': a.asset_type.value,
                    'file': a.file_path,
                    'line': a.line_number,
                    'trust_boundary': a.trust_boundary,
                }
                for a in self.assets
            ],
            'threats': [
                {
                    'id': t.id,
                    'title': t.title,
                    'category': t.category.value,
                    'severity': t.severity.value,
                    'dread_score': round(t.dread.overall, 1),
                    'description': t.description,
                    'attack_vector': t.attack_vector,
                    'mitigation': t.mitigation,
                    'file': t.file_path,
                    'line': t.line_number,
                }
                for t in self.threats
            ],
            'data_flows': [
                {
                    'source': df.source,
                    'destination': df.destination,
                    'data_type': df.data_type,
                    'protocol': df.protocol,
                    'encrypted': df.encrypted,
                    'crosses_trust_boundary': df.trust_boundary_crossing,
                }
                for df in self.data_flows
            ],
        }

    def generate_markdown_report(self, results: Dict) -> str:
        """Generate a markdown threat model report."""
        lines = []
        meta = results['metadata']
        summary = results['summary']

        lines.append(f"# Threat Model Report")
        lines.append(f"")
        lines.append(f"**Target**: `{meta['target']}`")
        lines.append(f"**Framework**: {meta['framework'].upper()}")
        lines.append(f"**Generated**: {meta['timestamp']}")
        lines.append(f"**Files Scanned**: {meta['files_scanned']}")
        lines.append(f"")

        # Summary
        lines.append(f"## Summary")
        lines.append(f"")
        lines.append(f"| Metric | Count |")
        lines.append(f"|--------|-------|")
        lines.append(f"| Assets Identified | {summary['total_assets']} |")
        lines.append(f"| Threats Identified | {summary['total_threats']} |")
        lines.append(f"| Data Flows Mapped | {summary['total_data_flows']} |")
        lines.append(f"")

        # Severity breakdown
        lines.append(f"### Risk Distribution")
        lines.append(f"")
        lines.append(f"| Severity | Count |")
        lines.append(f"|----------|-------|")
        for sev, count in summary['by_severity'].items():
            if count > 0:
                lines.append(f"| {sev} | {count} |")
        lines.append(f"")

        # STRIDE category breakdown
        lines.append(f"### STRIDE Coverage")
        lines.append(f"")
        lines.append(f"| Category | Threats |")
        lines.append(f"|----------|---------|")
        for cat, count in summary['by_category'].items():
            if count > 0:
                lines.append(f"| {cat} | {count} |")
        lines.append(f"")

        # Threat Details
        lines.append(f"## Threat Details")
        lines.append(f"")

        sorted_threats = sorted(results['threats'], key=lambda t: -t['dread_score'])
        for t in sorted_threats:
            sev_icon = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🔵", "INFO": "⚪"}.get(t['severity'], "⚪")
            lines.append(f"### {t['id']}: {t['title']}")
            lines.append(f"")
            lines.append(f"- **Severity**: {sev_icon} {t['severity']} (DREAD: {t['dread_score']}/10)")
            lines.append(f"- **Category**: {t['category']}")
            lines.append(f"- **Description**: {t['description']}")
            lines.append(f"- **Attack Vector**: {t['attack_vector']}")
            if t['file']:
                lines.append(f"- **Location**: `{t['file']}:{t['line']}`")
            lines.append(f"- **Mitigation**: {t['mitigation']}")
            lines.append(f"")

        # Data Flow Diagram (text)
        lines.append(f"## Data Flow Summary")
        lines.append(f"")
        lines.append(f"```")
        for df in results['data_flows'][:30]:  # Limit display
            enc = "🔒" if df['encrypted'] else "🔓"
            boundary = " ⚠️ CROSSES TRUST BOUNDARY" if df['crosses_trust_boundary'] else ""
            lines.append(f"  {df['source']}")
            lines.append(f"    ──[{df['data_type']} via {df['protocol']}]──► {df['destination']} {enc}{boundary}")
            lines.append(f"")
        lines.append(f"```")
        lines.append(f"")

        # Recommendations
        lines.append(f"## Recommendations")
        lines.append(f"")
        critical_threats = [t for t in sorted_threats if t['severity'] == 'CRITICAL']
        high_threats = [t for t in sorted_threats if t['severity'] == 'HIGH']

        if critical_threats:
            lines.append(f"### 🔴 Critical (Fix Immediately)")
            for t in critical_threats:
                lines.append(f"- **{t['id']}**: {t['mitigation']}")
            lines.append(f"")

        if high_threats:
            lines.append(f"### 🟠 High (Fix Before Next Release)")
            for t in high_threats:
                lines.append(f"- **{t['id']}**: {t['mitigation']}")
            lines.append(f"")

        return "\n".join(lines)

    def _walk_files(self):
        """Walk target directory yielding scannable files."""
        if self.target_path.is_file():
            if self.target_path.suffix in SCANNABLE_EXTENSIONS:
                yield self.target_path
            return

        for root, dirs, files in os.walk(self.target_path):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for fname in files:
                fpath = Path(root) / fname
                if fpath.suffix in SCANNABLE_EXTENSIONS or fname in ('.env', '.env.example', 'Dockerfile', 'docker-compose.yml'):
                    yield fpath


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="STRIDE-based Threat Modeling Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python threat_modeler.py /path/to/project
  python threat_modeler.py ./my-app --framework stride --output threat_model.md
  python threat_modeler.py ./my-app --json --output threat_model.json
  python threat_modeler.py ./my-app -v --framework pasta
        """
    )
    parser.add_argument('target', help='Target directory or file to analyze')
    parser.add_argument('--framework', '-f', choices=['stride', 'pasta'],
                        default='stride', help='Threat modeling framework (default: stride)')
    parser.add_argument('--output', '-o', help='Output file path (markdown or JSON)')
    parser.add_argument('--json', action='store_true', help='Output results as JSON')
    parser.add_argument('--verbose', '-v', action='store_true', help='Enable verbose output')

    args = parser.parse_args()

    modeler = ThreatModeler(args.target, framework=args.framework, verbose=args.verbose)
    results = modeler.run()

    if args.json:
        output = json.dumps(results, indent=2)
        if args.output:
            Path(args.output).write_text(output)
            print(f"\n✅ JSON report saved to: {args.output}")
        else:
            print(output)
    else:
        report = modeler.generate_markdown_report(results)
        if args.output:
            Path(args.output).write_text(report)
            print(f"\n✅ Markdown report saved to: {args.output}")
        else:
            print(report)

    # Exit summary
    critical = results['summary']['by_severity'].get('CRITICAL', 0)
    high = results['summary']['by_severity'].get('HIGH', 0)
    print(f"\n{'='*70}")
    print(f"  THREAT MODEL COMPLETE")
    print(f"  {results['summary']['total_threats']} threats identified "
          f"({critical} critical, {high} high)")
    print(f"{'='*70}\n")

    sys.exit(1 if critical > 0 else 0)


if __name__ == '__main__':
    main()
