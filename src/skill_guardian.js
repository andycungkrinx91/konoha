'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const GUARDIAN_THRESHOLD = 30;

const DANGEROUS_PATTERNS = [
  {
    id: 'DESTRUCTIVE_COMMAND',
    severity: 'critical',
    impact: 100,
    regex: /(?:rm\s+-(?:r[fF]|f[rR]|rf)\s+(?:\/|~|\$HOME|\*)|mkfs\.[a-z0-9]+|dd\s+if=\S+\s+of=\/dev\/(?:sd[a-z]|nvme|hd[a-z])|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:)/,
    message: 'Destructive system command detected'
  },
  {
    id: 'REVERSE_SHELL',
    severity: 'critical',
    impact: 100,
    regex: /(?:\/dev\/tcp\/\d{1,3}(?:\.\d{1,3}){3}\/\d+|nc(?:\.traditional)?\s+-[e|c]\s+\/bin\/(?:ba)?sh|ncat\s+.*-e\s+\/bin\/(?:ba)?sh|bash\s+-i\s+>&?\s*\/dev\/tcp\/|python[23]?\s+-c\s+['"].*import\s+socket.*pty\.spawn)/i,
    message: 'Reverse shell payload signature detected'
  },
  {
    id: 'REMOTE_CODE_EXECUTION_PIPE',
    severity: 'critical',
    impact: 70,
    regex: /(?:(?:curl|wget)\s+[^|\n;]+(?:\|\s*(?:bash|sh|zsh|python[23]?|perl|node))|(?:curl|wget)\s+[^|\n;]+>\s*\S+\s*&&\s*(?:bash|sh|source)\s+\S+)/i,
    message: 'Remote untrusted script download piped directly to shell'
  },
  {
    id: 'CREDENTIAL_HARVESTING',
    severity: 'critical',
    impact: 80,
    regex: /(?:\.ssh\/(?:id_rsa|id_ed25519|authorized_keys)|\/etc\/shadow|\.aws\/credentials|\.docker\/config\.json)/,
    message: 'Attempt to access private credentials, keys, or shadow files'
  },
  {
    id: 'ENV_EXFILTRATION',
    severity: 'high',
    impact: 50,
    regex: /(?:process\.env\b.*(?:fetch|axios|https?\.request|http\.request|child_process).*https?:\/\/|(?:cat|grep)\s+\.env\b.*(?:curl|wget|nc))/i,
    message: 'Potential environment variables and secrets exfiltration'
  },
  {
    id: 'OBFUSCATED_CODE_EXECUTION',
    severity: 'high',
    impact: 60,
    regex: /(?:eval\s*\(\s*(?:Buffer\.from|atob|base64_decode)\s*\(|new\s+Function\s*\(\s*(?:Buffer\.from|atob)\s*\(|child_process.*exec\s*\(\s*(?:Buffer\.from|atob)\s*\()/i,
    message: 'Base64 obfuscated payload passed to dynamic evaluation or execution'
  },
  {
    id: 'SUSPICIOUS_NETWORK_DESTINATION',
    severity: 'high',
    impact: 40,
    regex: /(?:https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\/(?:raw|payload|drop|malware|bot|shell)|(?:pastebin\.com|discordapp\.com\/api\/webhooks|telegram\.org\/bot)\/[a-zA-Z0-9_-]+.*exec)/i,
    message: 'Communication with bare IP address or known webhook drop target'
  },
  {
    id: 'PERSISTENCE_MECHANISM',
    severity: 'high',
    impact: 50,
    regex: /(?:\/etc\/cron\.(?:daily|hourly|d)\/|\/var\/spool\/cron\/crontabs\/|systemctl\s+enable\b|launchctl\s+load\b)/,
    message: 'Unauthorized service persistence mechanism detected'
  },
  {
    id: 'UNRESTRICTED_CHMOD',
    severity: 'medium',
    impact: 25,
    regex: /chmod\s+(?:-[R\w]*\s+)?(?:777|a\+rwx|u\+s)\s+/,
    message: 'Excessive file permissions modification (chmod 777 or SUID)'
  },
  {
    id: 'UNPATCHED_CHROMADB_DEPENDENCY',
    severity: 'high',
    impact: 40,
    regex: /(?:(?:pip|pip3)\s+install\s+(?:--?\S+\s+)*chromadb\b|(?:import\s+chromadb|from\s+chromadb\b))/i,
    message: 'Unpatched ChromaDB dependency detected (CVE-2026-45830 has no official patch); drop or isolate dependency'
  },
  {
    id: 'VULNERABLE_BINWALK_EXTRACTION',
    severity: 'high',
    impact: 40,
    regex: /(?:binwalk\s+-(?:eM|Me|e\b|C\b)|(?:pip|pip3)\s+install\s+(?:--?\S+\s+)*binwalk\b|subprocess\.(?:run|call|Popen)\s*\(\s*\[\s*['"]binwalk['"].*-(?:eM|Me|e)\b)/,
    message: 'Vulnerable legacy binwalk extraction or installation detected (CVE-2021-4287); replace with unblob or binwalk3'
  },
  {
    id: 'VULNERABLE_PYMETASPLOIT3',
    severity: 'high',
    impact: 40,
    regex: /(?:(?:pip|pip3)\s+install\s+(?:--?\S+\s+)*pymetasploit3\b|(?:import\s+pymetasploit3|from\s+pymetasploit3\b))/i,
    message: 'Vulnerable pymetasploit3 library detected (CVE-2026-5463 command injection); use native RPC'
  }
];

function runAsyncSpawn(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', d => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ status: code, stdout, stderr }));
  });
}

function createFinding(ruleId, severity, impact, file = '', line = 0, message = '', snippet = '') {
  const item = { ruleId, severity, impact, file, line, message };
  if (snippet) item.snippet = snippet;
  return item;
}

function createBlockVerdict(skillName, ruleId, message, scannedCount = 0) {
  return {
    verdict: 'block',
    score: 100,
    safe: false,
    skillName,
    findings: [createFinding(ruleId, 'critical', 100, '', 0, message)],
    scannedFilesCount: scannedCount
  };
}

function readFileContentSafely(filePath, relativePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      return { finding: createFinding('LARGE_UNINSPECTED_FILE', 'medium', 15, relativePath, 0, 'File exceeds 2MB size cap') };
    }
    return { content: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return { finding: createFinding('UNREADABLE_FILE', 'medium', 20, relativePath, 0, `Unreadable: ${err.message}`) };
  }
}

const REPO_SHIPPED_SKILLS_DIRS = [
  path.resolve(__dirname, '../src/templates/skills'),
  path.resolve(__dirname, '../agent/skills'),
  path.resolve(__dirname, '../.agents/skills')
];

const HASH_PINNED_INTERNAL_LINES = new Map([
  ['kage-skill:SKILL.md:109', 'e347bce4b6757038fcb6494b1eb7d3058a1676a40313a872c8756d5cea5feeab'],
  ['sannin-skill:SKILL.md:109', '3cd07b6cce8af5f06fe3eca6ceef4b344aba81284cbf728627a8f99d81752bdb'],
  ['konoha:SKILL.md:546', 'deaea5f3c3cf1d0795118c2868efeae8eb704b24f08cd175b18dd462fcda352b'],
  ['jonin-skill:references/owasp-security.md:198', '152be3ef15ce5a59c0d040bce9f4de0b6900d5f58430b9b78ae533f4acb72b89']
]);

function isInsideRepoShippedSkills(filePath) {
  try {
    const real = fs.realpathSync(filePath);
    return REPO_SHIPPED_SKILLS_DIRS.some(dir => {
      try {
        const realDir = fs.realpathSync(dir);
        return real.startsWith(realDir + path.sep);
      } catch (_) {
        return false;
      }
    });
  } catch (_) {
    return false;
  }
}

function isInternalAllowlistedLine(filePath, relPath, lineNo, lineText) {
  if (!isInsideRepoShippedSkills(filePath)) {
    return false;
  }
  const lineHash = crypto.createHash('sha256').update(lineText.trim()).digest('hex');
  for (const [key, expectedHash] of HASH_PINNED_INTERNAL_LINES.entries()) {
    if (lineHash === expectedHash) {
      const parts = key.split(':');
      const expectedRel = parts.slice(1, -1).join(':');
      const expectedLine = parseInt(parts[parts.length - 1], 10);
      if (expectedLine === lineNo && relPath.endsWith(expectedRel)) {
        return true;
      }
    }
  }
  return false;
}

function scanFileContent(filePath, relativePath) {
  const findings = [];
  const readRes = readFileContentSafely(filePath, relativePath);
  if (readRes.finding) {
    findings.push(readRes.finding);
    return findings;
  }
  const content = readRes.content;

  const lines = content.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNo = idx + 1;

    if (isInternalAllowlistedLine(filePath, relativePath, lineNo, line)) {
      continue;
    }

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          ruleId: pattern.id,
          severity: pattern.severity,
          impact: pattern.impact,
          file: relativePath,
          line: lineNo,
          message: pattern.message,
          snippet: line.trim().slice(0, 160)
        });
      }
    }
  }

  if (path.basename(filePath) === 'package.json') {
    try {
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts || {};
      for (const hook of ['preinstall', 'postinstall', 'install']) {
        if (scripts[hook]) {
          findings.push({
            ruleId: 'UNTRUSTED_LIFECYCLE_SCRIPT',
            severity: 'high',
            impact: 45,
            file: relativePath,
            line: 1,
            message: `Package contains active lifecycle hook "${hook}": ${scripts[hook]}`,
            snippet: `${hook}: ${scripts[hook]}`
          });
        }
      }
    } catch (_) {
      // Ignored if invalid JSON, caught by other linters
    }
  }

  return findings;
}

function collectFilesRecursively(dir, rootDir = dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    if (entry.isSymbolicLink()) {
      try {
        const real = fs.realpathSync(fullPath);
        const relToRoot = path.relative(rootDir, real);
        if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
          files.push({
            fullPath,
            relPath,
            isSymlinkEscaping: true,
            realTarget: real
          });
          continue;
        }
      } catch (_) {
        files.push({
          fullPath,
          relPath,
          isSymlinkBroken: true
        });
        continue;
      }
    }

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'anthropic-cybersecurity-skills-assets') {
        continue;
      }
      files.push(...collectFilesRecursively(fullPath, rootDir));
    } else if (entry.isFile()) {
      files.push({ fullPath, relPath });
    }
  }

  return files;
}

function checkSymlinkSecurity(item) {
  if (item.isSymlinkEscaping) {
    return createFinding('SYMLINK_DIRECTORY_TRAVERSAL', 'critical', 100, item.relPath, 0, `Escapes skill root: ${item.realTarget}`);
  }
  if (item.isSymlinkBroken) {
    return createFinding('BROKEN_SYMLINK', 'medium', 15, item.relPath, 0, 'Broken symbolic link in package');
  }
  return null;
}

function scanSkillDirectory(skillDir, skillName = path.basename(skillDir)) {
  if (!fs.existsSync(skillDir)) {
    return createBlockVerdict(skillName, 'MISSING_SOURCE_DIRECTORY', `Staging directory not found: ${skillDir}`, 0);
  }

  const findings = [];
  let scannedFilesCount = 0;

  try {
    const items = collectFilesRecursively(skillDir);
    scannedFilesCount = items.length;

    for (const item of items) {
      const symlinkIssue = checkSymlinkSecurity(item);
      if (symlinkIssue) {
        findings.push(symlinkIssue);
        continue;
      }

      const fileFindings = scanFileContent(item.fullPath, item.relPath);
      findings.push(...fileFindings);
    }
  } catch (scanErr) {
    return createBlockVerdict(skillName, 'SCANNER_INTERNAL_ERROR', `Fail-closed scan error: ${scanErr.message}`, scannedFilesCount);
  }

  let totalScore = 0;
  let hasCritical = false;

  for (const f of findings) {
    totalScore += (f.impact || 0);
    if (f.severity === 'critical') {
      hasCritical = true;
    }
  }

  const boundedScore = Math.min(100, Math.max(0, totalScore));
  const isBlocked = boundedScore > GUARDIAN_THRESHOLD || hasCritical;

  return {
    verdict: isBlocked ? 'block' : 'allow',
    score: boundedScore,
    safe: !isBlocked,
    threshold: GUARDIAN_THRESHOLD,
    skillName,
    findings,
    scannedFilesCount
  };
}

function recordGuardianFindingToKnowledge(scanResult, sourceUrl) {
  try {
    const personaMemory = require('./persona_memory');
    const cd = require('./mcp/client_detection');
    const db = require('./db');
    const projectPath = process.cwd();
    const sessionId = cd.getActiveSessionId(projectPath);

    const title = `Guardian audit: ${scanResult.skillName} (${scanResult.verdict.toUpperCase()})`;
    const ruleCounts = {};
    for (const f of scanResult.findings) {
      ruleCounts[f.ruleId] = (ruleCounts[f.ruleId] || 0) + 1;
    }

    const payload = {
      skillName: String(scanResult.skillName || '').slice(0, 40),
      sourceUrl: String(sourceUrl || '').slice(0, 80),
      verdict: scanResult.verdict,
      score: scanResult.score,
      safe: scanResult.safe,
      findingsCount: scanResult.findings.length,
      rules: ruleCounts,
      topFindings: scanResult.findings.slice(0, 2).map(f => ({
        ruleId: f.ruleId,
        file: String(f.file || '').slice(0, 30),
        line: f.line
      })),
      auditedAt: new Date().toISOString()
    };

    let content = JSON.stringify(payload);
    if (content.length > 800) {
      delete payload.topFindings;
      content = JSON.stringify(payload);
    }

    personaMemory.saveMemory({
      agentName: 'chunin',
      content,
      title,
      memoryType: 'knowledge',
      importance: scanResult.safe ? 2 : 5,
      projectPath,
      sessionId,
      dbPath: db.DB_PATH,
      tags: `guardian,security,skill,${scanResult.skillName}`
    });
  } catch (_) {
    // Audit recording is best effort and must never break execution
  }
}

async function installSkillWithGuardian(repoUrl, skillName, options = {}) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_guardian_staging_'));
  const isWin = process.platform === 'win32';
  const pnpmCmd = isWin ? 'pnpm.cmd' : 'pnpm';
  const deployUtils = require('./deploy_utils');
  const { env: childEnv } = deployUtils.resolveCompatibleNodeEnv(process.env);

  try {
    process.stderr.write(`🛡️  Guardian: staging skill "${skillName}" in isolated sandbox...\n`);

    const run = await runAsyncSpawn(pnpmCmd, ['dlx', 'skills', 'add', repoUrl, '--skill', skillName, '-y', '--agent', '*'], {
      cwd: stagingRoot,
      shell: isWin,
      env: childEnv
    });

    if (run.status !== 0) {
      const errDetail = (run.stderr && run.stderr.trim()) || (run.stdout && run.stdout.trim()) || `Exit status ${run.status}`;
      throw new Error(`Failed to download skill into staging sandbox: ${errDetail}`);
    }

    const possiblePaths = [
      path.join(stagingRoot, '.agents', 'skills', skillName),
      path.join(stagingRoot, '.cursor', 'skills', skillName),
      path.join(stagingRoot, 'skills', skillName),
      path.join(stagingRoot, skillName)
    ];

    let stagedPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        stagedPath = p;
        break;
      }
    }

    if (!stagedPath) {
      const entries = fs.readdirSync(stagingRoot);
      for (const entry of entries) {
        const candidate = path.join(stagingRoot, entry);
        if (fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, 'SKILL.md'))) {
          stagedPath = candidate;
          break;
        }
      }
    }

    if (!stagedPath) {
      throw new Error(`Skill files for "${skillName}" not found in staging sandbox after download.`);
    }

    process.stderr.write(`🛡️  Guardian: scanning "${skillName}" files for security threats and malicious scripts...\n`);
    const scanResult = scanSkillDirectory(stagedPath, skillName);

    recordGuardianFindingToKnowledge(scanResult, repoUrl);

    if (scanResult.verdict === 'block') {
      const reasons = scanResult.findings.map(f => `[${f.severity.toUpperCase()}] ${f.ruleId} in ${f.file || 'root'}:${f.line}: ${f.message}`);
      process.stderr.write(`❌ Guardian BLOCKED installation of "${skillName}"!\n`);
      process.stderr.write(`   Risk score: ${scanResult.score}/100 (Threshold: ${GUARDIAN_THRESHOLD})\n`);
      for (const r of reasons.slice(0, 5)) {
        process.stderr.write(`   - ${r}\n`);
      }
      throw new Error(
        `Installation of skill "${skillName}" was BLOCKED by Guardian. ` +
        `Risk score: ${scanResult.score}/100 exceeds safe threshold of ${GUARDIAN_THRESHOLD}. ` +
        `Threats detected: ${scanResult.findings.map(f => f.ruleId).join(', ')}`
      );
    }

    process.stderr.write(`✓ Guardian: skill "${skillName}" passed security audit (Risk score: ${scanResult.score}/100 <= ${GUARDIAN_THRESHOLD}).\n`);

    const { AGENTS } = require('../bin/lib/paths');
    const execCwd = (options && options.projectRoot) || process.cwd();
    const liveTargetDir = path.join(execCwd, '.agents', 'skills', skillName);

    fs.mkdirSync(path.dirname(liveTargetDir), { recursive: true });
    deployUtils.copySkillsDirFast(stagedPath, liveTargetDir);

    const globalTargetDir = path.join(AGENTS, 'skills', skillName);
    if (!fs.existsSync(globalTargetDir)) {
      try {
        deployUtils.copySkillsDirFast(stagedPath, globalTargetDir);
      } catch (_) { /* intentional best-effort fallback */ }
    }

    const skillManager = require('./skill_manager');
    if (typeof skillManager.syncAllClientSkills === 'function') {
      skillManager.syncAllClientSkills({ projectRoot: execCwd, silent: false });
    }

    return liveTargetDir;
  } finally {
    try {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    } catch (_) { /* cleanup */ }
  }
}

module.exports = {
  GUARDIAN_THRESHOLD,
  DANGEROUS_PATTERNS,
  scanSkillDirectory,
  installSkillWithGuardian,
  recordGuardianFindingToKnowledge
};
