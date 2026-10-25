/**
 * scripts/audit_python_skills_deps.js
 * Scans all skills in src/templates/skills and agent/skills for Python dependencies
 * via imports and `pip install` commands, resolves latest versions via PyPI API,
 * and batch-queries OSV for vulnerabilities.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const SKILL_DIRS = [
  path.join(__dirname, '..', 'src', 'templates', 'skills'),
  path.join(__dirname, '..', 'agent', 'skills')
];

// Python standard library modules to exclude
const PYTHON_STDLIB = new Set([
  'abc', 'aifc', 'argparse', 'array', 'ast', 'asynchat', 'asyncio', 'asyncore',
  'atexit', 'audioop', 'base64', 'bdb', 'binascii', 'binhex', 'bisect',
  'builtins', 'bz2', 'calendar', 'cgi', 'cgitb', 'chunk', 'cmath', 'cmd',
  'code', 'codecs', 'codeop', 'collections', 'colorsys', 'compileall',
  'concurrent', 'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg',
  'cProfile', 'crypt', 'csv', 'ctypes', 'curses', 'dataclasses', 'datetime',
  'dbm', 'decimal', 'difflib', 'dis', 'distutils', 'doctest', 'dummy_threading',
  'email', 'encodings', 'ensurepip', 'enum', 'errno', 'faulthandler', 'fcntl',
  'filecmp', 'fileinput', 'fnmatch', 'formatter', 'fpectl', 'fractions',
  'ftplib', 'functools', 'gc', 'getopt', 'getpass', 'gettext', 'glob', 'grp',
  'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'imaplib', 'imghdr',
  'imp', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json',
  'keyword', 'lib2to3', 'linecache', 'locale', 'logging', 'lzma', 'mailbox',
  'mailcap', 'marshal', 'math', 'mimetypes', 'mmap', 'modulefinder', 'msilib',
  'msvcrt', 'multiprocessing', 'netrc', 'nis', 'nntplib', 'numbers', 'operator',
  'optparse', 'os', 'ossaudiodev', 'parser', 'pathlib', 'pdb', 'pickle',
  'pickletools', 'pipes', 'pkgutil', 'platform', 'plistlib', 'poplib', 'posix',
  'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'py_compile',
  'pyclbr', 'pydoc', 'queue', 'quopri', 'random', 're', 'readline', 'reprlib',
  'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors',
  'shelve', 'shlex', 'shutil', 'signal', 'site', 'smtpd', 'smtplib', 'sndhdr',
  'socket', 'socketserver', 'spwd', 'sqlite3', 'sre', 'sre_compile',
  'sre_constants', 'sre_parse', 'ssl', 'stat', 'statistics', 'string',
  'stringprep', 'struct', 'subprocess', 'sunau', 'symbol', 'symtable', 'sys',
  'sysconfig', 'syslog', 'tabnanny', 'tarfile', 'telnetlib', 'tempfile',
  'termios', 'test', 'textwrap', 'threading', 'time', 'timeit', 'tkinter',
  'token', 'tokenize', 'trace', 'traceback', 'tracemalloc', 'tty', 'turtle',
  'turtledemo', 'types', 'typing', 'unicodedata', 'unittest', 'urllib', 'uu',
  'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser', 'winreg',
  'winsound', 'wsgiref', 'xdrlib', 'xml', 'xmlrpc', 'zipapp', 'zipfile',
  'zipimport', 'zlib', '_thread'
]);

// Common import-to-package mappings
const IMPORT_TO_PKG = {
  'yaml': 'pyyaml',
  'docx': 'python-docx',
  'pptx': 'python-pptx',
  'bs4': 'beautifulsoup4',
  'PIL': 'pillow',
  'sklearn': 'scikit-learn',
  'cv2': 'opencv-python',
  'OpenSSL': 'pyOpenSSL',
  'dateutil': 'python-dateutil',
  'dotenv': 'python-dotenv',
  'jose': 'python-jose',
  'magic': 'python-magic',
  'jwt': 'pyjwt',
  'boto3': 'boto3',
  'requests': 'requests',
  'scapy': 'scapy',
  'pefile': 'pefile',
  'yara': 'yara-python',
  'pandas': 'pandas',
  'numpy': 'numpy',
  'jinja2': 'jinja2',
  'paramiko': 'paramiko',
  'ldap3': 'ldap3',
  'pypdf': 'pypdf',
  'androguard': 'androguard',
  'frida': 'frida',
  'shodan': 'shodan',
  'censys': 'censys',
  'impacket': 'impacket',
  'pymisp': 'pymisp',
  'stix2': 'stix2',
  'dnspython': 'dnspython',
  'cryptography': 'cryptography',
  'fastapi': 'fastapi',
  'flask': 'flask',
  'sqlalchemy': 'sqlalchemy',
  'torch': 'torch',
  'transformers': 'transformers',
  'httpx': 'httpx',
  'aiohttp': 'aiohttp'
};

function getAllFiles(dir, exts, results = []) {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        getAllFiles(fullPath, exts, results);
      }
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (exts.includes(ext) || entry.name === 'SKILL.md') {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function extractFromPyFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = new Set();
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    // import foo, bar
    const importMatch = trimmed.match(/^import\s+([a-zA-Z0-9_,\s]+)/);
    if (importMatch) {
      const pkgs = importMatch[1].split(',').map(p => p.trim().split('.')[0].split(/\s+as\s+/)[0]);
      for (const p of pkgs) {
        if (p && !PYTHON_STDLIB.has(p)) imports.add(p);
      }
    }
    // from foo import bar
    const fromMatch = trimmed.match(/^from\s+([a-zA-Z0-9_]+)/);
    if (fromMatch) {
      const p = fromMatch[1];
      if (p && !PYTHON_STDLIB.has(p)) imports.add(p);
    }
  }
  return Array.from(imports);
}

function extractFromTextFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const pkgs = new Set();
  const pipRegex = /pip(?:3)?\s+install\s+([^\n\r`"';]+)/gi;
  let match;
  while ((match = pipRegex.exec(content)) !== null) {
    const line = match[1];
    // Split by spaces, handle flags
    const tokens = line.split(/\s+/);
    for (const t of tokens) {
      const clean = t.trim().replace(/^['"`]+|['"`]+$/g, '');
      if (!clean || clean.startsWith('-') || clean.startsWith('http') || clean.startsWith('.')) continue;
      // Strip version specifier e.g. pkg>=1.0, pkg==2.0
      const pkgName = clean.split(/[=<>~!]/)[0].trim().toLowerCase();
      if (pkgName && /^[a-z0-9_\-.]+$/.test(pkgName)) {
        pkgs.add(pkgName);
      }
    }
  }
  return Array.from(pkgs);
}

const PYPI_CLI_TOOLS = new Set([
  'binwalk', 'unblob', 'binwalk3', 'sqlmap', 'checkov', 'bandit', 'semgrep',
  'trufflehog', 'prowler', 'scoutsuite', 'dnstwist', 'roadrecon', 'certipy',
  'volatility3', 'floss', 'peepdf', 'pdfid', 'coercer', 'bloodhound', 'drozer',
  'gophish', 'jwt_tool', 'nosqlmap', 'pacu', 'sslyze', 'sstimap', 'theharvester',
  'xsrfprobe', 'cloudsplaining', 'impacket'
]);

function extractCliInvocations(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const found = new Set();
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.py' || ext === '.js') {
    // subprocess.run(["tool", ...]) or cmd = ["tool", ...]
    const subpRegex = /(?:subprocess\.(?:run|call|Popen)|cmd\s*=\s*)\s*\(\s*\[\s*['"]([a-zA-Z0-9_-]+)['"]|cmd\s*=\s*\[\s*['"]([a-zA-Z0-9_-]+)['"]/g;
    let m;
    while ((m = subpRegex.exec(content)) !== null) {
      const tool = (m[1] || m[2]).toLowerCase();
      if (PYPI_CLI_TOOLS.has(tool)) found.add(tool);
    }
  } else if (ext === '.md') {
    // Look inside ```bash or ```sh blocks
    const codeBlockRegex = /```(?:bash|sh)\r?\n([\s\S]*?)```/g;
    let blockMatch;
    while ((blockMatch = codeBlockRegex.exec(content)) !== null) {
      const blockLines = blockMatch[1].split('\n');
      for (const line of blockLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const firstWord = trimmed.split(/\s+/)[0].replace(/^sudo\s+/, '').toLowerCase();
        if (PYPI_CLI_TOOLS.has(firstWord)) {
          found.add(firstWord);
        }
      }
    }
  }
  return Array.from(found);
}

function httpGetJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Konoha-Dependency-Auditor/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (_) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function httpPostJson(url, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Konoha-Dependency-Auditor/1.0'
      }
    }, (res) => {
      let respData = '';
      res.on('data', chunk => respData += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(respData));
          } catch (_) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('Discovering files across skill directories...');
  const files = [];
  for (const dir of SKILL_DIRS) {
    getAllFiles(dir, ['.py', '.md', '.sh', '.txt'], files);
  }
  console.log(`Discovered ${files.length} total files.`);

  // Map package -> Set of reachable paths
  const packagePaths = new Map();

  function record(pkg, filePath) {
    if (!pkg) return;
    const normalized = (IMPORT_TO_PKG[pkg] || pkg).toLowerCase();
    // Exclude invalid/noise tokens
    if (['in', 'for', 'user', 'the', 'and', 'with', 'tools', 'scripts', 'agent', 'process'].includes(normalized)) return;
    if (PYTHON_STDLIB.has(normalized)) return;
    if (!packagePaths.has(normalized)) {
      packagePaths.set(normalized, new Set());
    }
    const rel = path.relative(path.join(__dirname, '..'), filePath);
    packagePaths.get(normalized).add(rel);
  }

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.py') {
      const imps = extractFromPyFile(f);
      for (const imp of imps) record(imp, f);
    }
    const pipPkgs = extractFromTextFile(f);
    for (const p of pipPkgs) record(p, f);
    const cliTools = extractCliInvocations(f);
    for (const tool of cliTools) record(tool, f);
  }

  const allPkgs = Array.from(packagePaths.keys()).sort();
  console.log(`Extracted ${allPkgs.length} unique external Python packages.`);

  // Resolve latest versions from PyPI
  console.log('Querying PyPI for latest versions...');
  const pkgDetails = [];
  const CONCURRENCY = 10;

  for (let i = 0; i < allPkgs.length; i += CONCURRENCY) {
    const chunk = allPkgs.slice(i, i + CONCURRENCY);
    const promises = chunk.map(async (pkg) => {
      const data = await httpGetJson(`https://pypi.org/pypi/${pkg}/json`);
      const version = data && data.info ? data.info.version : 'unknown';
      return {
        name: pkg,
        latestVersion: version,
        paths: Array.from(packagePaths.get(pkg))
      };
    });
    const chunkResults = await Promise.all(promises);
    pkgDetails.push(...chunkResults);
    process.stdout.write(`\rResolved ${pkgDetails.length}/${allPkgs.length} packages from PyPI`);
  }
  console.log('\nPyPI queries complete.');

  // Batch query OSV API (up to 1000 per request)
  console.log('Querying OSV vulnerability database for PyPI ecosystem...');
  const osvQueries = pkgDetails.map(p => {
    const q = { package: { name: p.name, ecosystem: 'PyPI' } };
    if (p.latestVersion && p.latestVersion !== 'unknown') {
      q.version = p.latestVersion;
    }
    return q;
  });

  const osvResponse = await httpPostJson('https://api.osv.dev/v1/querybatch', { queries: osvQueries });
  const osvResults = osvResponse && osvResponse.results ? osvResponse.results : [];

  const findings = [];
  for (let i = 0; i < pkgDetails.length; i++) {
    const pkg = pkgDetails[i];
    const osv = osvResults[i];
    const vulns = (osv && osv.vulns) ? osv.vulns : [];
    pkg.vulns = vulns.map(v => ({
      id: v.id,
      summary: v.summary || 'No summary',
      aliases: v.aliases || [],
      details: (v.details || '').slice(0, 150)
    }));
    findings.push(pkg);
  }

  const outputSummaryPath = path.join(__dirname, '..', 'docs', 'SKILLS_PYTHON_DEPENDENCIES_AUDIT.json');
  fs.writeFileSync(outputSummaryPath, JSON.stringify(findings, null, 2));
  console.log(`Saved detailed audit output to ${outputSummaryPath}`);

  // Summary counts
  const packagesWithVulnsOnLatest = findings.filter(f => f.vulns.length > 0);
  console.log(`\n=== AUDIT SUMMARY ===`);
  console.log(`Total packages analyzed: ${findings.length}`);
  console.log(`Packages with known advisories on latest PyPI version: ${packagesWithVulnsOnLatest.length}`);

  if (packagesWithVulnsOnLatest.length > 0) {
    console.log('\nPackages with advisories on latest version:');
    for (const p of packagesWithVulnsOnLatest) {
      console.log(`- ${p.name}@${p.latestVersion} (${p.vulns.length} advisories): ${p.vulns.map(v => v.id).join(', ')}`);
      console.log(`  Reachable in ${p.paths.length} file(s), e.g.: ${p.paths[0]}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
