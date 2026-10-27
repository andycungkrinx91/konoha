/**
 * tests/e2e_document_suite.js
 *
 * Declarative Orchestrator: generates the complete 8-Page DevOps Basic Fundamental Suite
 * by invoking the 5 official Konoha Document Engineering tools:
 * 1. document_create (PDF & DOCX)
 * 2. spreadsheet_create (XLSX)
 * 3. presentation_create (PPTX)
 * 4. diagram_create (SVG)
 * 5. animation_export (GIF)
 *
 * Dynamic Invariants Enforced:
 * - Dynamic target directory: accepts argv[2], OUTPUT_DIR environment variable, or defaults to ./output.
 * - Zero rendering logic duplication: all formatting, layout, covers, and coordinate budgeting
 *   live natively inside the 5 global tools in src/tools/document_engine.js.
 * - 100% English technical standard with authentic human voice and zero AI artifacts.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  documentCreate,
  spreadsheetCreate,
  presentationCreate,
  diagramCreate,
  animationExport
} = require('../src/workflow/tokubetsu-scribe/document_engine');

// Dynamic target output directory
const OUTPUT_DIR = path.resolve(
  process.argv[2] ||
  process.env.OUTPUT_DIR ||
  path.join(process.cwd(), 'output')
);

const SUITE_THEME = process.env.SUITE_THEME || 'random';
const SUITE_AUTHOR = 'Andy Setiyawan | Principal Infrastructure Architect';
const SUITE_CLASSIFICATION = 'Enterprise Technical Standard (v1.0.0)';
const SUITE_DATE = 'October 2026';

const makeCols = (specs) => specs.map(([header, width, format]) => ({ header, width, format }));
const makeCards = (items) => items.map(([tag, title, metric, body]) => ({ tag, title, metric, body }));
const makeColsLayout = (cols) => cols.map(([title, bullets]) => ({ title, bullets }));
const makeCardsSlide = (category, title, cardList) => ({ layout: 'cards', category, title, cards: makeCards(cardList) });
const makeColsSlide = (category, title, colList) => ({ layout: 'columns', category, title, columns: makeColsLayout(colList) });
const makeSheet = (name, title, subtitle, headers, cols, rows, opts = {}) => ({
  name,
  title,
  subtitle,
  headers,
  columns: makeCols(cols),
  rows,
  auto_filter: true,
  ...opts
});

// 1. Structured Document Content (8 Pages)
const SECTION_TABLES = {
  dora: {
    headers: ['DORA Metric', 'Elite Performers', 'Our Baseline (Q2)', 'Target (Q4)', 'Status'],
    rows: [
      ['Deployment Frequency', 'Multiple per day', '3 per week', 'Daily per service', 'On Track'],
      ['Lead Time for Changes', '< 1 hour', '48 hours', '< 4 hours', 'Accelerating'],
      ['Change Failure Rate', '0% - 15%', '18.4%', '< 5.0%', 'Improving'],
      ['Time to Restore Service', '< 1 hour', '3.5 hours', '< 30 minutes', 'Healthy']
    ]
  },
  delivery: {
    headers: ['Deployment Strategy', 'Infrastructure Cost', 'Rollback Latency', 'Traffic Shifting', 'Best Use Case'],
    rows: [
      ['Blue-Green', '200% during cutover', '< 5 seconds', 'Instant DNS/LB toggle', 'Stateful apps, monolithic upgrades'],
      ['Canary Release', '110% - 120%', '< 30 seconds', 'Gradual percentage shift', 'High-throughput microservices'],
      ['Rolling Update', '100% - 125%', 'Variable (minutes)', 'Pod by pod replacement', 'Stateless worker nodes']
    ]
  },
  sre: {
    headers: ['Service Component', 'Service Level Indicator (SLI)', 'SLO Target', 'Current 30-Day Value', 'Error Budget Remaining'],
    rows: [
      ['Edge API Gateway', 'HTTP 5xx rate < 0.1%', '99.90%', '99.96%', '62% remaining'],
      ['Authentication Service', 'P99 Latency < 150ms', '99.50%', '99.82%', '78% remaining'],
      ['Payment Processing', 'Transaction success rate', '99.99%', '99.994%', '45% remaining'],
      ['Search & Discovery', 'Query response < 80ms', '99.00%', '99.41%', '85% remaining']
    ]
  },
  security: {
    headers: ['Verification Stage', 'Toolchain', 'Enforcement Gate', 'Auditor Sign-off'],
    rows: [
      ['Static Analysis (SAST)', 'Semgrep / SonarQube', '0 Critical, 0 High', 'Automated Check'],
      ['Software Bill of Materials', 'Syft / CycloneDX', 'Full Dependency Graph', 'Security Compliance'],
      ['Container Signing', 'Sigstore / Cosign', 'Public Key Attestation', 'Automated Check'],
      ['Secret Hygiene', 'TruffleHog / GitGuardian', 'Zero Committed Secrets', 'Architecture Lead']
    ]
  }
};

const SECTIONS = [
  {
    title: 'DevOps Philosophy, CAMS Model & DORA Metrics',
    paragraphs: [
      'CAB was dead weight. They ate 71% of our lead time without catching a single production incident. During our 2024 platform audit across 34 EulerOS microservices, lead times collapsed from 48 hours to 126 minutes only after automated branch protection replaced manual manager sign-offs, forcing development squads to own every container release directly. Results proved decisive.',
      'CAMS is practical hygiene. Tools never fix culture. While fast CI runners and automated linter gates eliminate developer fatigue, forcing engineers into Jira ticket queues for approval stamps inevitably causes large, terrifying batch deployments that break checkout fleets on Friday afternoons. We chose automation over paperwork.',
      'DORA numbers run our reviews. We track four signals relentlessly. When our edge payment gateway experienced intermittent 502 bad gateway spikes due to unoptimized sysctl net.ipv4.tcp_tw_reuse kernel settings, having sub-ten-minute automated rollback pipelines prevented a catastrophic enterprise SLA breach across 18 regional availability zones. Metrics never lie. Speed saves systems.'
    ],
    callout: {
      title: 'OPERATIONAL LESSON',
      text: 'Kill bureaucratic approvals. Peer reviews backed by automated smoke tests dropped turnaround time by 62% in our EulerOS cluster.'
    },
    table: SECTION_TABLES.dora
  },
  {
    title: 'Source Control Architecture & Trunk-Based Development',
    paragraphs: [
      'GitFlow failed us. Merging two-week branches triggered 42 nasty conflicts and grounded our staging environment for three straight days. Our enterprise standard now limits branch lifespans to 24 hours, requiring engineers to push verified commits directly into main at least three times per shift to avoid integration pain. Speed demands discipline.',
      'Hide unfinished code behind flags. Dark deployments decouple artifact delivery from user exposure. By wrapping new EulerOS socket handlers in LaunchDarkly runtime flags, developers merge incomplete work into production safely; if an unexpected memory leak triggers at 02:00 UTC, on-call operators toggle the flag off in 150 milliseconds without restarting pods. Zero rollback drama.',
      'Short diffs review faster. Small PRs under 200 lines pass automated linting in thirty seconds. While massive thousand-line pull requests cause reviewer fatigue and hide subtle security vulnerabilities, concise single-purpose commits allow senior engineers to catch edge-case concurrency bugs during initial peer reviews. Small increments win.'
    ],
    callout: {
      title: 'CORE ARCHITECTURAL INVARIANT',
      text: 'Delete branches older than 24 hours. Stale branches are unintegrated technical debt that poisons team velocity.'
    },
    code: {
      language: 'yaml',
      snippet: `name: trunk-merge-guard
on:
  pull_request:
    branches: [ main ]
jobs:
  validate-branch-age:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verify Branch Freshness
        run: |
          AGE_HOURS=$(( ($(date +%s) - $(git log -1 --format=%ct HEAD)) / 3600 ))
          if [ $AGE_HOURS -gt 24 ]; then
            echo "Branch exceeds 24-hour trunk lifespan policy ($AGE_HOURS hrs)"
            exit 1
          fi`
    }
  },
  {
    title: 'Hermetic Continuous Integration & Automated Verification',
    paragraphs: [
      'Never trust floating tags. Pulling :latest or unpinned npm ranges is a massive security hazard. Following the 2024 XZ-utils backdoor compromise, our build clusters strictly reject any Dockerfile that fails to specify an immutable SHA256 image digest alongside content-addressable dependency lockfiles. Trust nothing unhashed. Security starts at source.',
      'Hermetic runners guarantee reproducibility. Ephemeral pods isolate workloads. When build containers spin up with dedicated CPU quotas and isolated PostgreSQL instances that boot in two seconds, test suites execute consistently without state pollution from prior runs. If verification exceeds eight minutes, workers kill the job immediately. Fast tests preserve sanity.',
      'Unit tests form our bedrock. Speed matters. While slow end-to-end browser suites crawl for twenty minutes and fail unpredictably on third-party network timeouts, running three thousand sub-millisecond unit checks inside local container memory gives engineers immediate verification on every single keystroke. Fast feedback preserves flow.'
    ],
    callout: {
      title: 'PIPELINE HYGIENE STANDARD',
      text: 'CI pipelines must finish under eight minutes. Slower verification breaks focus and tempts engineers to skip tests.'
    },
    code: {
      language: 'yaml',
      snippet: `name: hermetic-ci-pipeline
on: [ push, pull_request ]
jobs:
  build-and-verify:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run test:unit --coverage
      - run: pnpm run test:integration`
    }
  },
  {
    title: 'Continuous Delivery Strategies & Progressive Rollouts',
    paragraphs: [
      'Big-bang deployments court catastrophe. Staging environments never mirror live traffic spikes or real database concurrency. We enforce progressive canary routing through Envoy service meshes, routing exactly 2% of user requests to candidate pods while Prometheus scrapes error rates every ten seconds. Safety first.',
      'Roll back automatically. No manual panic. Zero hesitation. If p99 latency exceeds 180 milliseconds or HTTP 5xx responses breach 0.05% during the 30-minute canary evaluation window, ingress proxies immediately divert all traffic back to stable pods without waking engineers. Systems must heal themselves.',
      'Zero downtime is non-negotiable. Blue-green cutovers switch router targets instantly once health probes succeed. By directing traffic between parallel EulerOS node pools using weighted DNS and local Envoy sidecars, platform teams deploy critical kernel patches in broad daylight without dropping active client connections. Uptime remains intact.'
    ],
    callout: {
      title: 'PROGRESSIVE DELIVERY CONTRACT',
      text: 'Canaries must run for at least 30 minutes under real traffic before expanding ingress share past 5%.'
    },
    table: SECTION_TABLES.delivery
  },
  {
    title: 'Infrastructure as Code & Immutable Architecture Disciplines',
    paragraphs: [
      'Never SSH into production. Snowflake servers and manual terminal tweaks make troubleshooting impossible. We treat all nodes as disposable appliances, building immutable base OS images with Packer and replacing whole EulerOS node pools during maintenance windows. No exceptions.',
      'Lock your Terraform state. State collisions corrupt cloud resources. Chaos ensues otherwise. By storing our state backend in encrypted S3 buckets paired with DynamoDB distributed mutex tables, 140 deployment pipelines execute safely in parallel without race conditions or corrupted resource trees. Hourly drift scans flag divergence instantly. Drift cannot hide.',
      'Code defines topology. Version control represents our single source of truth. Whenever network engineers require VPC peering or ingress security group adjustments, declarative manifests define every CIDR block and port assignment through peer-reviewed pull requests rather than risky manual cloud console edits. Clean audits follow.'
    ],
    callout: {
      title: 'IMMUTABILITY MANDATE',
      text: 'Prohibit interactive SSH on production nodes. All system updates occur through declarative GitOps reconciliation.'
    },
    code: {
      language: 'hcl',
      snippet: `terraform {
  required_version = ">= 1.8.0"
  backend "s3" {
    bucket         = "corp-infra-tfstate-production"
    key            = "edge-network/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}`
    }
  },
  {
    title: 'Site Reliability Engineering, Observability & Error Budgets',
    paragraphs: [
      '100% uptime is fiction. Striving for perfection bankrupts platforms and strangles feature delivery. At 99.9% availability, our monthly error budget grants exactly 43 minutes of unplanned downtime; as long as that budget stays green, product squads ship features aggressively. Spend the budget wisely.',
      'Freeze deploys on budget burn. Reliability comes first. When microservices burn their quarterly error budget, all non-critical feature deployments halt immediately, reallocating engineering hours to patch memory leaks and database connection pool starvation. Hard boundaries enforce engineering rigor.',
      'Logs alone are useless. When a microservice returned empty 200 OK payloads at 03:14 UTC, standard logging showed zero errors. Silence masked disaster. Only distributed OpenTelemetry traces with trace-context propagation across Envoy sidecars exposed the silent cache expiration bug within minutes, preventing a multi-million-dollar billing discrepancy across our European transaction cluster. Telemetry uncovers truth.'
    ],
    callout: {
      title: 'ERROR BUDGET GOVERNANCE',
      text: 'Exhausted error budgets trigger an automatic deployment freeze. Teams fix reliability before resuming feature work.'
    },
    table: SECTION_TABLES.sre
  },
  {
    title: 'DevSecOps, Supply Chain Security & Production Governance',
    paragraphs: [
      'Shift security left. Waiting for quarterly penetration tests creates costly fire drills. Automated SAST engines evaluate every pull request in 35 seconds, blocking commits that introduce critical CVSS vulnerabilities before human code reviews even begin. Catch flaws early.',
      'Sign every container image. Attackers target build runners and upstream dependencies. We generate CycloneDX Software Bills of Materials during compilation and sign OCI artifacts using Sigstore and Cosign, anchoring identity verification directly in GitHub Actions OIDC tokens. Provenance is absolute.',
      'Admission controllers guard the cluster. Kyverno validates Cosign cryptographic signatures against transparency logs before scheduling pods. Whenever an untrusted registry pushes unverified container layers into our production namespace, the Kubernetes API server terminates the admission request instantly, dispatching high-priority audit alerts into our centralized SIEM pipeline. Zero unsigned images run. Period.'
    ],
    callout: {
      title: 'SUPPLY CHAIN SECURITY INVARIANT',
      text: 'Kubernetes admission controllers reject any image lacking a verified Cosign signature. No signature, no deployment.'
    },
    table: SECTION_TABLES.security
  }
];

// 2. Structured Spreadsheet Model (3 Organized Sheets)
const SPREADSHEET_SHEETS = [
  makeSheet(
    'DORA_Metrics_Dashboard',
    'DORA PERFORMANCE METRICS DASHBOARD',
    'Quarterly Cluster Reliability & Delivery Velocity Audits',
    ['Microservice Cluster', 'Deployments / Week', 'Lead Time (Hours)', 'Change Failure Rate', 'MTTR (Minutes)', 'Target Availability SLA'],
    [
      ['Microservice Cluster', 26, 'text'],
      ['Deployments / Week', 20, 'integer'],
      ['Lead Time (Hours)', 20, 'duration_hrs'],
      ['Change Failure Rate', 22, 'percent'],
      ['MTTR (Minutes)', 18, 'duration_mins'],
      ['Target Availability SLA', 24, 'percent']
    ],
    [
      ['Edge Ingress Gateway', 24, 1.2, 0.02, 12, { formula: '=XLOOKUP(A8, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$C$5:$C$9, 0.999)' }],
      ['User Identity Service', 14, 2.5, 0.04, 18, { formula: '=XLOOKUP(A9, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$C$5:$C$9, 0.995)' }],
      ['Order Processing Engine', 18, 1.8, 0.03, 15, { formula: '=XLOOKUP(A10, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$C$5:$C$9, 0.999)' }],
      ['Catalog Search Core', 12, 3.2, 0.05, 25, { formula: '=XLOOKUP(A11, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$C$5:$C$9, 0.99)' }],
      ['Telemetry Aggregator', 28, 0.9, 0.01, 8, { formula: '=XLOOKUP(A12, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$C$5:$C$9, 0.99)' }]
    ],
    {
      kpi_cards: [
        { label: 'Total Services', formula: '=COUNTA(A8:A12)', format: 'integer' },
        { label: 'Avg Deployments/Wk', formula: '=AVERAGE(B8:B12)', format: 'integer' },
        { label: 'Avg Failure Rate', formula: '=AVERAGE(D8:D12)', format: 'percent' },
        { label: 'Fleet MTTR SLA', formula: '=AVERAGE(E8:E12)', format: 'duration_mins' }
      ],
      summary: ['Fleet Averages', { formula: '=AVERAGE(B8:B12)' }, { formula: '=AVERAGE(C8:C12)' }, { formula: '=AVERAGE(D8:D12)' }, { formula: '=AVERAGE(E8:E12)' }, { formula: '=AVERAGE(F8:F12)' }]
    }
  ),
  makeSheet(
    'Service_SLO_Registry',
    'ENTERPRISE SERVICE LEVEL OBJECTIVE REGISTRY',
    'Service Classification, Availability Targets, and On-Call Routing',
    ['Service Component', 'Tier Classification', 'Target Availability', 'Monthly Downtime Allowance (Min)', 'Escalation Squad'],
    [
      ['Service Component', 26, 'text'],
      ['Tier Classification', 20, 'text'],
      ['Target Availability', 20, 'percent'],
      ['Monthly Downtime Allowance (Min)', 34, 'integer'],
      ['Escalation Squad', 22, 'text']
    ],
    [
      ['Edge Ingress Gateway', 'Tier 1 Critical', 0.999, 43, 'Core Networking'],
      ['User Identity Service', 'Tier 1 Critical', 0.995, 216, 'Security Operations'],
      ['Order Processing Engine', 'Tier 1 Critical', 0.999, 43, 'Payments & Checkout'],
      ['Catalog Search Core', 'Tier 2 Core', 0.990, 432, 'Search Team'],
      ['Telemetry Aggregator', 'Tier 3 Support', 0.990, 432, 'Reliability Squad']
    ]
  ),
  makeSheet(
    'Financial_Incident_Impact',
    'INCIDENT FINANCIAL EXPOSURE & DOWNTIME COST MODEL',
    'Quantified Financial Impact per Minute of Unplanned Outage',
    ['Microservice Cluster', 'Tier', 'Hourly Outage Cost ($)', 'Avg Incidents / Year', 'Annualized Outage Cost ($)'],
    [
      ['Microservice Cluster', 26, 'text'],
      ['Tier', 20, 'text'],
      ['Hourly Outage Cost ($)', 24, 'currency'],
      ['Avg Incidents / Year', 22, 'integer'],
      ['Annualized Outage Cost ($)', 26, 'currency']
    ],
    [
      ['Edge Ingress Gateway', { formula: '=XLOOKUP(A5, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$B$5:$B$9, "Tier 1")' }, 28000, 2, { formula: '=(C5*(DORA_Metrics_Dashboard!E6/60))*D5' }],
      ['User Identity Service', { formula: '=XLOOKUP(A6, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$B$5:$B$9, "Tier 1")' }, 18500, 3, { formula: '=(C6*(DORA_Metrics_Dashboard!E7/60))*D6' }],
      ['Order Processing Engine', { formula: '=XLOOKUP(A7, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$B$5:$B$9, "Tier 1")' }, 34000, 1, { formula: '=(C7*(DORA_Metrics_Dashboard!E8/60))*D7' }],
      ['Catalog Search Core', { formula: '=XLOOKUP(A8, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$B$5:$B$9, "Tier 2")' }, 9200, 4, { formula: '=(C8*(DORA_Metrics_Dashboard!E9/60))*D8' }],
      ['Telemetry Aggregator', { formula: '=XLOOKUP(A9, Service_SLO_Registry!$A$5:$A$9, Service_SLO_Registry!$B$5:$B$9, "Tier 3")' }, 4500, 6, { formula: '=(C9*(DORA_Metrics_Dashboard!E10/60))*D9' }]
    ],
    {
      summary: ['Total Portfolio Risk', '', '', { formula: '=SUM(D5:D9)' }, { formula: '=SUM(E5:E9)' }]
    }
  )
];

// 3. Structured Presentation Outline (8 Widescreen Slides)
const PRESENTATION_SLIDES = [
  {
    layout: 'title',
    title: 'DevOps Engineering Principles & Reliability Architecture',
    subtitle: 'Enterprise Operational Standards & Automated Delivery Architecture'
  },
  makeCardsSlide('OPERATIONAL METRICS', 'CAMS Model & The Four DORA Metrics', [
    ['VELOCITY', 'Deployment Frequency', '14/day', 'Elite performers deploy multiple times daily, shortening delivery lead times.'],
    ['LATENCY', 'Lead Time for Changes', '42 mins', 'Elapsed duration from code commit to successful execution in production.'],
    ['STABILITY', 'Change Failure Rate', '2.4%', 'Percentage of production releases requiring immediate remediation or rollback.'],
    ['RESILIENCE', 'Mean Time to Restore', '12 mins', 'Duration required to restore primary services during unexpected degradation.']
  ]),
  makeColsSlide('SOURCE CONTROL', 'Trunk-Based Development vs Legacy GitFlow', [
    ['Trunk-Based Development (Recommended)', [
      'Short-lived feature branches (< 24 hours)',
      'Continuous merge into main trunk',
      'Feature flags decouple deployment from activation',
      'Automated merge queues serialize testing',
      'Zero batch integration conflict pain'
    ]],
    ['Legacy GitFlow (Deprecated for Cloud)', [
      'Long-lived feature, release, and develop branches',
      'Infrequent merges yield severe conflict friction',
      'Delayed feedback on cross-team integration',
      'Complex tagging and release synchronization',
      'Blocks continuous delivery cadence'
    ]]
  ]),
  makeCardsSlide('AUTOMATION ENGINE', 'Hermetic Continuous Integration Pipeline', [
    ['STAGE 01', 'Commit & Trigger', 'Webhook', 'Cryptographically signed commit triggers webhook to ephemeral runner queue.'],
    ['STAGE 02', 'Hermetic Build', 'Cache Hit', 'Isolated container environment with content-addressable dependency lock.'],
    ['STAGE 03', 'Test Matrix', 'Parallel', 'Parallel execution of unit, integration, and security compliance checks.'],
    ['STAGE 04', 'Attestation & Sign', 'Sigstore', 'Generate full SBOM and sign immutable image artifact via Cosign.']
  ]),
  makeCardsSlide('DEPLOYMENT ARCHITECTURE', 'Continuous Delivery & Traffic Shifting Patterns', [
    ['ZERO DOWNTIME', 'Blue-Green Cutover', 'Instant', 'Duplicate environment. Instant traffic toggle via load balancer target groups with sub-second rollback.'],
    ['PROGRESSIVE DELIVERY', 'Canary Rollout', '2% -> 100%', 'Incremental traffic exposure gated by automated Prometheus error budget thresholds.'],
    ['DECLARATIVE AUDIT', 'GitOps Reconciliation', 'ArgoCD', 'Automated controller reconciles cluster live state with Git manifests, preventing manual drift.']
  ]),
  makeColsSlide('INFRASTRUCTURE AS CODE', 'Immutable Infrastructure & State Locking Disciplines', [
    ['State Management Best Practices', [
      'Encrypted remote state in AWS S3 or GCS bucket',
      'Distributed locking via DynamoDB to prevent collision',
      'Daily automated drift detection cron jobs',
      'Strict separation of state per environment tier'
    ]],
    ['Immutable Fleet Lifecycle', [
      'Zero in-place SSH server patching or manual edits',
      'Packer pipelines bake hardened, verified AMIs',
      'Blue-green ASG replacement during kernel updates',
      'Reproducible rollback to prior immutable image SHA'
    ]]
  ]),
  makeCardsSlide('SITE RELIABILITY', 'Observability Pillars & Error Budget Management', [
    ['COLLECTION', 'OpenTelemetry', 'Unified', 'Unified agent collecting distributed traces, Prometheus metrics, and structured logs without vendor lock-in.'],
    ['OBJECTIVES', 'SLI / SLO Framework', '99.9%', 'Service Level Indicators measure real user experience against clear SLO targets (e.g. 99.9% under 150ms).'],
    ['GOVERNANCE', 'Error Budget Guard', 'Automated', 'Exhausted error budgets trigger release freezes, automatically pivoting resources to reliability hardening.']
  ]),
  {
    layout: 'checklist',
    category: 'SECURITY & GOVERNANCE',
    title: 'Shift-Left DevSecOps & Production Sign-Off Checklist',
    checklist: {
      left_title: 'Pre-Deployment Verification Gates',
      left_items: [
        '✓  Gate 1: SAST & Secret Scan\n    Zero critical or high severity vulnerabilities detected by Semgrep and TruffleHog.',
        '✓  Gate 2: SBOM Attestation\n    Complete CycloneDX dependency manifest generated during CI execution.',
        '✓  Gate 3: Container Cryptographic Signing\n    Production clusters reject images lacking valid Sigstore / Cosign signatures.'
      ],
      right_title: 'Runtime Verification & Release Authorization',
      right_items: [
        '✓  Gate 4: Error Budget Headroom\n    Target service error budget must exceed 20% remaining headroom prior to promotion.',
        '✓  Gate 5: Automated Canary Evaluation\n    Minimum 30-minute metric stabilization window without latency deviation.'
      ],
      signoff: 'Author: Andy Setiyawan | Principal Infrastructure Architect\nRelease SHA: c3f79a29e1d84b06   |   Date: October 2026\nStatus: Certified Production Ready — 100% Policy Pass'
    }
  }
];

// 4. Structured Architecture Diagram Specification
const DIAGRAM_NODES = [
  { id: 'git', label: 'Git Repository', sublabel: 'Trunk Branch + PRs', x: 80, y: 380, width: 220, height: 90, color: '#4F46E5' },
  { id: 'ci', label: 'Hermetic CI Engine', sublabel: 'Ephemeral Runners', x: 390, y: 380, width: 220, height: 90, color: '#0EA5E9' },
  { id: 'sec', label: 'DevSecOps Gate', sublabel: 'SAST + SBOM + Cosign', x: 700, y: 380, width: 220, height: 90, color: '#F59E0B' },
  { id: 'reg', label: 'Artifact Registry', sublabel: 'Signed OCI Images', x: 1010, y: 380, width: 220, height: 90, color: '#10B981' },
  { id: 'k8s', label: 'Production Fleet', sublabel: 'Canary ArgoCD Sync', x: 1320, y: 380, width: 200, height: 90, color: '#6366F1' }
];

const DIAGRAM_EDGES = [
  { from: 'git', to: 'ci', label: 'Commit Webhook' },
  { from: 'ci', to: 'sec', label: 'Artifact Verification' },
  { from: 'sec', to: 'reg', label: 'Cryptographic Sign' },
  { from: 'reg', to: 'k8s', label: 'Progressive Deploy' }
];

const VERTICAL_DIAGRAM_NODES = [
  { id: 'git', label: 'Git Repository', sublabel: 'Trunk Branch + PRs', color: '#4F46E5' },
  { id: 'ci', label: 'Hermetic CI Engine', sublabel: 'Ephemeral Runners', color: '#0EA5E9' },
  { id: 'sec', label: 'DevSecOps Gate', sublabel: 'SAST + SBOM + Cosign', color: '#F59E0B' },
  { id: 'reg', label: 'Artifact Registry', sublabel: 'Signed OCI Images', color: '#10B981' },
  { id: 'k8s', label: 'Production Fleet', sublabel: 'Canary ArgoCD Sync', color: '#6366F1' }
];

// 5. Generator: Markdown & Plain Text
function generateMarkdownAndText(outputDir) {
  let mdContent = `# DevOps Engineering: Principles, Pipelines & Site Reliability\n\n`;
  mdContent += `**Author**: ${SUITE_AUTHOR}  \n`;
  mdContent += `**Classification**: ${SUITE_CLASSIFICATION}  \n`;
  mdContent += `**Status**: Production Verified — Zero AI Artifacts  \n`;
  mdContent += `**Date**: ${SUITE_DATE}  \n\n---\n\n`;

  let txtContent = `DEVOPS ENGINEERING: PRINCIPLES, PIPELINES & SITE RELIABILITY\n`;
  txtContent += `============================================================\n`;
  txtContent += `Author: ${SUITE_AUTHOR}\n`;
  txtContent += `Classification: ${SUITE_CLASSIFICATION}\n`;
  txtContent += `Date: ${SUITE_DATE}\n\n`;

  SECTIONS.forEach((sec, idx) => {
    mdContent += `## Section ${idx + 1}: ${sec.title}\n\n`;
    txtContent += `SECTION ${idx + 1}: ${sec.title}\n------------------------------------------------------------\n`;

    sec.paragraphs.forEach((p) => {
      mdContent += `${p}\n\n`;
      txtContent += `${p}\n\n`;
    });

    if (sec.callout) {
      mdContent += `> **${sec.callout.title}**: ${sec.callout.text}\n\n`;
      txtContent += `[${sec.callout.title}] ${sec.callout.text}\n\n`;
    }

    if (sec.table) {
      mdContent += `| ${sec.table.headers.join(' | ')} |\n`;
      mdContent += `| ${sec.table.headers.map(() => '---').join(' | ')} |\n`;
      sec.table.rows.forEach((r) => {
        mdContent += `| ${r.join(' | ')} |\n`;
      });
      mdContent += `\n`;
    }

    if (sec.code) {
      mdContent += `\`\`\`${sec.code.language}\n${sec.code.snippet}\n\`\`\`\n\n`;
      txtContent += `CODE SNIPPET (${sec.code.language.toUpperCase()}):\n${sec.code.snippet}\n\n`;
    }
  });

  fs.writeFileSync(path.join(outputDir, 'sample.md'), mdContent, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'sample.txt'), txtContent, 'utf8');
}

// 6. Main Orchestrator Execution Flow
async function main() {
  console.log(`\n🚀 Starting Generation of 8-Page DevOps Deliverables in: ${OUTPUT_DIR}\n`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const generateDoc = async (format, ext, step) => {
    console.log(`${step}: Generating sample.${ext} via documentCreate...`);
    await documentCreate({
      format,
      output_path: path.join(OUTPUT_DIR, `sample.${ext}`),
      title: 'DevOps Engineering: Principles, Pipelines & Site Reliability',
      subtitle: 'Enterprise Operational Standards & Automated Delivery Architecture',
      author: SUITE_AUTHOR,
      classification: SUITE_CLASSIFICATION,
      date: SUITE_DATE,
      theme: SUITE_THEME,
      sections: SECTIONS
    });
    console.log(`✓ Generated sample.${ext}`);
  };

  // 1. PDF via documentCreate
  await generateDoc('pdf', 'pdf', '1/6');

  // 2. DOCX via documentCreate
  await generateDoc('docx', 'docx', '2/6');

  // 3. XLSX via spreadsheetCreate
  console.log('3/6: Generating sample.xlsx via spreadsheetCreate...');
  await spreadsheetCreate({
    output_path: path.join(OUTPUT_DIR, 'sample.xlsx'),
    author: SUITE_AUTHOR,
    theme: SUITE_THEME,
    sheets: SPREADSHEET_SHEETS
  });
  console.log('✓ Generated sample.xlsx');

  // 4. PPTX via presentationCreate
  console.log('4/6: Generating sample.pptx via presentationCreate...');
  await presentationCreate({
    output_path: path.join(OUTPUT_DIR, 'sample.pptx'),
    title: 'DevOps Engineering Principles & Reliability Architecture',
    subtitle: 'Enterprise Operational Standards & Automated Delivery Architecture',
    author: SUITE_AUTHOR,
    theme: SUITE_THEME,
    slides: PRESENTATION_SLIDES
  });
  console.log('✓ Generated sample.pptx');

  // 5a. SVG via diagramCreate (Horizontal Layout)
  console.log('5a/8: Generating sample.svg (horizontal) via diagramCreate...');
  await diagramCreate({
    output_path: path.join(OUTPUT_DIR, 'sample.svg'),
    orientation: 'horizontal',
    title: 'Hermetic CI/CD & DevSecOps Architecture (Horizontal Flow)',
    theme: SUITE_THEME,
    nodes: DIAGRAM_NODES,
    edges: DIAGRAM_EDGES
  });
  console.log('✓ Generated sample.svg');

  // 5b. WebP via animationExport (Horizontal Animation)
  console.log('5b/8: Generating sample.webp (horizontal) via animationExport...');
  await animationExport({
    input_path: path.join(OUTPUT_DIR, 'sample.svg'),
    output_path: path.join(OUTPUT_DIR, 'sample.webp'),
    duration_sec: 3,
    fps: 15
  });
  console.log('✓ Generated sample.webp');

  // 6a. SVG via diagramCreate (Vertical Layout)
  console.log('6a/8: Generating sample_vertical.svg (vertical) via diagramCreate...');
  await diagramCreate({
    output_path: path.join(OUTPUT_DIR, 'sample_vertical.svg'),
    orientation: 'vertical',
    title: 'Hermetic CI/CD & DevSecOps Architecture (Vertical Flow)',
    theme: SUITE_THEME,
    nodes: VERTICAL_DIAGRAM_NODES,
    edges: DIAGRAM_EDGES
  });
  console.log('✓ Generated sample_vertical.svg');

  // 6b. WebP via animationExport (Vertical Animation)
  console.log('6b/8: Generating sample_vertical.webp (vertical) via animationExport...');
  await animationExport({
    input_path: path.join(OUTPUT_DIR, 'sample_vertical.svg'),
    output_path: path.join(OUTPUT_DIR, 'sample_vertical.webp'),
    duration_sec: 3,
    fps: 15
  });
  console.log('✓ Generated sample_vertical.webp');

  // 7 & 8. Markdown & Text
  generateMarkdownAndText(OUTPUT_DIR);
  console.log('✓ Generated sample.md and sample.txt');

  console.log(`\n🎉 All deliverable files (including horizontal & vertical animated WebPs) generated successfully in: ${OUTPUT_DIR}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal generation error:', err);
    process.exit(1);
  });
}

module.exports = { main };
