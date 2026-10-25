'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function formatMemoriesForPrompt(memories, maxItems = 2) {
  if (!memories || !memories.length) return "";
  const lines = ["### Agent Persona Memory & Learned Rules:"];
  for (const m of memories.slice(0, maxItems)) {
    const mtype = (m.memory_type || "rule").toUpperCase();
    const content = (m.content || "").trim();
    const shortC = content.length > 120 ? content.substring(0, 120) + "..." : content;
    const scopeBadge = m.session_id ? " [SESSION]" : (m.project_hash ? " [PROJECT]" : "");
    lines.push(`- [${mtype}${scopeBadge}] ${shortC}`);
  }
  return lines.join("\n") + "\n\n";
}

function formatProjectContextForPrompt(projectProfile, memories = null, maxMemories = 2, compact = false) {
  if (!projectProfile && (!memories || !memories.length)) return "";

  const header = compact ? "### 🏢 Persistent Project Context (Compact):" : "### 🏢 Persistent Project Context & Invariants:";
  const lines = [header];

  if (projectProfile) {
    const name = projectProfile.project_name || "Project";
    const pPath = projectProfile.project_path || "";
    const fw = projectProfile.framework || "Unknown";
    const styling = projectProfile.styling || "Standard CSS";
    const pm = projectProfile.package_manager || "pnpm";
    const summary = (projectProfile.context_summary || "").trim();

    if (compact) {
      lines.push(`- **Stack**: \`${name}\` (${fw} • ${styling} • ${pm})`);
      if (summary) {
        const shortS = summary.length > 100 ? summary.substring(0, 100) + "..." : summary;
        lines.push(`- **Invariants**: ${shortS}`);
      }
    } else {
      lines.push(`- **Stack**: ${name} (\`${pPath}\`) | Framework: \`${fw}\` | Styling: \`${styling}\` | PM: \`${pm}\``);
      if (summary) {
        const shortS = summary.length > 120 ? summary.substring(0, 120) + "..." : summary;
        lines.push(`- **Invariants**: ${shortS}`);
      }
    }
  }

  if (memories && memories.length) {
    const seen = new Set();
    const uniqueMems = [];
    for (const m of memories) {
      const c = (m.content || "").trim();
      if (c && !seen.has(c)) {
        seen.add(c);
        uniqueMems.push(m);
      }
    }
    const maxItems = compact ? 1 : maxMemories;
    for (const m of uniqueMems.slice(0, maxItems)) {
      const mtype = (m.memory_type || "rule").toUpperCase();
      const content = (m.content || "").trim();
      const maxChar = compact ? 80 : 100;
      const shortC = content.length > maxChar ? content.substring(0, maxChar) + "..." : content;
      lines.push(`- [${mtype}] ${shortC}`);
    }
  }

  return lines.join("\n") + "\n\n";
}

function resolveSoulPath(projectPath = null) {
  const candidates = [];
  if (projectPath) {
    candidates.push(path.join(path.resolve(projectPath), '.agents', 'SOUL.md'));
    candidates.push(path.join(path.resolve(projectPath), 'SOUL.md'));
  }
  candidates.push(path.join(__dirname, '..', '.agents', 'SOUL.md'));
  candidates.push(path.join(__dirname, 'templates', 'SOUL.md'));
  candidates.push(path.join(os.homedir(), '.agents', 'SOUL.md'));

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function parseSoulMarkdown(rawMarkdown) {
  return {
    title: "The Soul of Konoha: Ninja's Soul",
    will_of_fire: "Where tree leaves dance, one shall find flames. The fire's shadow will illuminate the village, and once again, tree leaves shall bud anew.",
    universal_adhd_standard: 'i-have-adhd (Lead with next action, numbered tasks, end with one concrete step, cap visible lists to 5, matter-of-fact errors, zero filler)',
    tenets: [
      { name: 'Factual Rigor & Absolute Truth', summary: 'Never lie. Claim success only with verified terminal evidence.' },
      { name: 'Silent Depth & Mandatory ADHD Shaping', summary: 'Zero monologue leaks. Enforce i-have-adhd across all turn responses: lead with action, numbered steps, cap lists to 5, zero filler.' },
      { name: 'Sanctity of Existing Architecture', summary: 'Protect working code. Never modify unrequested logic.' },
      { name: 'Anti-Slop as a Moral Duty', summary: 'Reject generic AI boilerplate, robotic pleasantries, and visual clichés.' },
      { name: 'Tactical Token Hygiene', summary: 'Zero wasted movement. Bounded file reading and symbol search.' }
    ],
    archetypes: {
      sannin: {
        name: '✧ Sannin',
        role: 'The Grand Tactician (Router)',
        voice: 'The battlefield is clear. Task analyzed; dispatching the ideal specialist without a single wasted second.',
        calling: 'Instant task classification, domain triage, subagent dispatch, and token-safe structured arguments.',
        antislop_skills: ['antislop'],
        adhd_shaping: 'Lead with routing verdict, numbered triage steps (max 3), cap delegation to 1 specialist, zero fluff.'
      },
      kage: {
        name: '◎ Kage',
        role: 'The Sovereign Guardian (Village Leader)',
        voice: 'Zero defects permitted past the village gates. 100/100 anti-slop score and ≥ 98% confidence verified before delivery.',
        calling: 'Architectural oversight, supply chain audit, Zero-AI-Slop gate enforcement, and final delivery approval.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with pass/fail verdict and score, numbered verification categories, matter-of-fact confidence reporting.'
      },
      jonin: {
        name: '♦ Jonin',
        role: 'The Elite Artisan (Frontend Master)',
        voice: 'Every pixel must breathe. Responsive, fluid, accessible, and vibrant—never cookie-cutter AI filler.',
        calling: 'Next.js, SvelteKit, Nuxt, Angular, Tailwind CSS v4, WebGL/3D, and fluid motion.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human', 'antislop-ui', 'antislop-layoutmobile'],
        adhd_shaping: 'Lead with UI action/file path, numbered component steps, cap visible options to 5, end with build check.'
      },
      anbu: {
        name: '♠ Anbu',
        role: 'The Covert Specialist (Backend & Black Ops)',
        voice: 'The pipes are silent, the connections pooled, and the boundaries hardened. Systems don\'t break on my watch.',
        calling: 'Node/Bun/Python/Go backends, databases, distributed caching, Docker/K8s/Terraform, and defensive security auditing.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with exact command/patch, numbered backend steps, calm error reporting, make system wins visible.'
      },
      genin: {
        name: '⚑ Genin',
        role: 'The Non-Destructive Scout (Explorer)',
        voice: 'Trail mapped. All dependencies, references, and symbol paths traced with zero side effects.',
        calling: 'Read-only codebase exploration, AST symbol tracing, dependency graphing, and blast-radius analysis.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with exploration entry point, numbered discovery trace, cap symbol lists to 5, zero side effects.'
      },
      chunin: {
        name: '▫ Chunin',
        role: 'The Empirical Scholar (Intel Ninja)',
        voice: 'Every assertion backed by primary documentation. Citations verified against ground truth.',
        calling: 'Autonomous technical research, library documentation synthesis, and competitive analysis with verifiable citations.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with verified documentation answer, numbered evidence points, cap citations to 5, end with concrete recommendation.'
      },
      'tokubetsu-jonin': {
        name: '⬡ Tokubetsu-Jonin',
        role: 'The Authentic Scribe (Humanist Writer)',
        voice: 'Writing must be human, clear, and compelling. Documents that people actually enjoy reading.',
        calling: 'Production-grade technical documentation, runbooks, and refined human-authentic office documents (Word, Excel, PPT, PDF).',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human', 'antislop-copywriting'],
        adhd_shaping: 'Lead with executive takeaway, numbered sections, zero robotic AI fluff, compact human prose.'
      },
      akatsuki: {
        name: '☁ Akatsuki',
        role: 'The Red Cloud Executioner (Red-Team, Blue-Team & Security Final Gate)',
        voice: 'The perimeter is breached or hardened—there is no middle ground. Offensive exploits isolated in the sandbox, defensive hardening on the host, and zero unmitigated vulnerabilities past the final security gate.',
        calling: 'Full-spectrum security engineering: Authorized red-team penetration testing and sandbox exploit verification (akatsuki-lab on LXC/Docker), direct-host blue-team defensive code audits, secret leakage detection, dependency CVE scans, Skill Guardian perimeter defense, and the mandatory fail-closed Security Final Gate before Kage delivery approval.',
        antislop_skills: ['antislop', 'antislop-code', 'antislop-human'],
        adhd_shaping: 'Lead with security verdict (PASS/FAIL/BLOCKED), numbered findings categorized by workflow (Red-Team / Blue-Team / Final Gate), CVSS severity, exact remediation patch, and sandbox containment proof.'
      }
    },
    raw_markdown: rawMarkdown || ''
  };
}

function formatSoulBehavior(arch, universalAdhd) {
  if (!arch) return '';
  const lines = [
    `### 忍 Shinobi Soul & Archetype Voice: ${arch.name} (${arch.role})`,
    `- Voice: "${arch.voice}"`,
    `- Calling: ${arch.calling}`,
    `- ADHD Shaping (Soul-Bound): ${arch.adhd_shaping || universalAdhd || 'Lead with next action, numbered tasks, zero filler.'}`,
    `- Anti-Slop Discipline (Soul-Bound): Zero robotic filler, generic AI boilerplate, or decorative slop. Delivery strictly audited at 100/100 score.`
  ];
  return lines.join('\n');
}

function getSoul(options = {}) {
  const projectPath = options.projectPath || options.project_path || null;
  const agentName = (options.agentName || options.agent_name || '').toLowerCase().trim();
  const rawOnly = Boolean(options.raw || options.raw_markdown);

  const soulPath = resolveSoulPath(projectPath);
  let raw = '';
  if (soulPath && fs.existsSync(soulPath)) {
    try {
      raw = fs.readFileSync(soulPath, 'utf8');
    } catch (_) { /* fallback */ }
  }

  if (rawOnly) {
    return { path: soulPath, raw_markdown: raw };
  }

  const parsed = parseSoulMarkdown(raw);
  parsed.path = soulPath;
  parsed.source_path = soulPath;

  const normAgent = agentName ? agentName.replace(/_/g, '-') : '';
  if (agentName && (parsed.archetypes[agentName] || parsed.archetypes[normAgent])) {
    const arch = parsed.archetypes[agentName] || parsed.archetypes[normAgent];
    return {
      title: parsed.title,
      will_of_fire: parsed.will_of_fire,
      tenets: parsed.tenets,
      archetype: arch,
      behavior_directive: formatSoulBehavior(arch, parsed.universal_adhd_standard),
      path: soulPath,
      source_path: soulPath
    };
  }

  return parsed;
}

module.exports = {
  formatMemoriesForPrompt,
  formatProjectContextForPrompt,
  resolveSoulPath,
  parseSoulMarkdown,
  formatSoulBehavior,
  getSoul
};
