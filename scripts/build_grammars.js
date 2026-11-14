'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const GRAMMARS_DIR = path.join(REPO_ROOT, 'assets', 'grammars');
const LOCKFILE_PATH = path.join(GRAMMARS_DIR, 'grammars.lock.json');
const LICENSES_PATH = path.join(GRAMMARS_DIR, 'THIRD_PARTY_LICENSES.txt');
const RUNTIME_WASM_SRC = require.resolve('web-tree-sitter/web-tree-sitter.wasm');
const RUNTIME_PKG_DIR = path.dirname(RUNTIME_WASM_SRC);
const RUNTIME_LICENSE_SRC = path.join(RUNTIME_PKG_DIR, 'LICENSE');

const TREE_SITTER_CLI_VERSION = '0.27.2';

/**
 * Pinned authoritative MIT grammar upstream definitions (11 languages).
 */
const GRAMMAR_SOURCES = Object.freeze([
  {
    language: 'javascript',
    repo: 'tree-sitter/tree-sitter-javascript',
    tag: 'v0.25.0',
    file: 'tree-sitter-javascript.wasm',
    releaseAsset: 'tree-sitter-javascript.wasm',
    sample: 'export function greet(name) { return name; }'
  },
  {
    language: 'typescript',
    repo: 'tree-sitter/tree-sitter-typescript',
    tag: 'v0.23.2',
    file: 'tree-sitter-typescript.wasm',
    releaseAsset: 'tree-sitter-typescript.wasm',
    sample: 'export interface Config { readonly port: number; }'
  },
  {
    language: 'tsx',
    repo: 'tree-sitter/tree-sitter-typescript',
    tag: 'v0.23.2',
    file: 'tree-sitter-tsx.wasm',
    releaseAsset: 'tree-sitter-tsx.wasm',
    sample: 'export function App() { return <main />; }'
  },
  {
    language: 'python',
    repo: 'tree-sitter/tree-sitter-python',
    tag: 'v0.25.0',
    file: 'tree-sitter-python.wasm',
    releaseAsset: 'tree-sitter-python.wasm',
    sample: 'def greet(name: str) -> str:\n    return name\n'
  },
  {
    language: 'go',
    repo: 'tree-sitter/tree-sitter-go',
    tag: 'v0.25.0',
    file: 'tree-sitter-go.wasm',
    releaseAsset: 'tree-sitter-go.wasm',
    sample: 'package main\nfunc main() {}\n'
  },
  {
    language: 'rust',
    repo: 'tree-sitter/tree-sitter-rust',
    tag: 'v0.24.2',
    file: 'tree-sitter-rust.wasm',
    releaseAsset: 'tree-sitter-rust.wasm',
    sample: 'pub fn add(a: i32, b: i32) -> i32 { a + b }'
  },
  {
    language: 'java',
    repo: 'tree-sitter/tree-sitter-java',
    tag: 'v0.23.5',
    file: 'tree-sitter-java.wasm',
    releaseAsset: 'tree-sitter-java.wasm',
    sample: 'public class App { public int run() { return 1; } }'
  },
  {
    language: 'c',
    repo: 'tree-sitter/tree-sitter-c',
    tag: 'v0.24.2',
    file: 'tree-sitter-c.wasm',
    releaseAsset: 'tree-sitter-c.wasm',
    sample: 'int add(int a, int b) { return a + b; }'
  },
  {
    language: 'cpp',
    repo: 'tree-sitter/tree-sitter-cpp',
    tag: 'v0.23.4',
    file: 'tree-sitter-cpp.wasm',
    releaseAsset: 'tree-sitter-cpp.wasm',
    sample: 'class Engine { public: int start(); };'
  },
  {
    language: 'bash',
    repo: 'tree-sitter/tree-sitter-bash',
    tag: 'v0.25.1',
    file: 'tree-sitter-bash.wasm',
    releaseAsset: 'tree-sitter-bash.wasm',
    sample: 'run_task() {\n  echo "ok"\n}\n'
  },
  {
    language: 'sql',
    repo: 'DerekStride/tree-sitter-sql',
    tag: 'v0.3.11',
    file: 'tree-sitter-sql.wasm',
    buildFromSource: true,
    sample: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);'
  }
]);

const SAMPLE_BY_LANGUAGE = Object.freeze(
  Object.fromEntries(GRAMMAR_SOURCES.map((entry) => [entry.language, entry.sample]))
);

let _wtsInitialized = false;

function sha256Hex(bufferOrString) {
  return crypto.createHash('sha256').update(bufferOrString).digest('hex');
}

async function initWebTreeSitter(runtimeWasmPath) {
  const wts = require('web-tree-sitter');
  if (!_wtsInitialized) {
    await wts.Parser.init({
      locateFile: () => runtimeWasmPath
    });
    _wtsInitialized = true;
  }
  return {
    Parser: wts.Parser,
    Language: wts.Language,
    languageVersion: wts.LANGUAGE_VERSION,
    minCompatibleVersion: wts.MIN_COMPATIBLE_VERSION
  };
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'konoha-grammar-lock',
      Accept: 'application/vnd.github+json'
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.json();
}

async function fetchBuffer(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'konoha-grammar-lock' }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} downloading ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Resolve an annotated or lightweight GitHub tag into its 40-hex commit SHA.
 * @param {string} repo
 * @param {string} tag
 * @returns {Promise<string>}
 */
async function resolvePinnedCommitSha(repo, tag) {
  const ref = await fetchJson(`https://api.github.com/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
  const obj = ref && ref.object;
  if (!obj || typeof obj.sha !== 'string') {
    throw new Error(`Missing tag ref object for ${repo}@${tag}`);
  }
  let commitSha = obj.sha;
  if (obj.type === 'tag') {
    const annotated = await fetchJson(`https://api.github.com/repos/${repo}/git/tags/${obj.sha}`);
    if (!annotated || !annotated.object || typeof annotated.object.sha !== 'string') {
      throw new Error(`Failed to peel annotated tag ${repo}@${tag}`);
    }
    commitSha = annotated.object.sha;
  }
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error(`Invalid commit SHA "${commitSha}" for ${repo}@${tag}`);
  }
  return commitSha;
}

/**
 * Fetch and verify MIT license file at a pinned commit SHA.
 * @param {string} repo
 * @param {string} commitSha
 * @returns {Promise<{ text: string, sha256: string }>}
 */
async function fetchVerifiedMitLicense(repo, commitSha) {
  const url = `https://raw.githubusercontent.com/${repo}/${commitSha}/LICENSE`;
  const buf = await fetchBuffer(url);
  const text = buf.toString('utf8').replace(/\r\n/g, '\n').trim();
  if (!text.includes('MIT License') && !text.includes('Permission is hereby granted, free of charge')) {
    throw new Error(`Upstream LICENSE for ${repo}@${commitSha} did not match MIT terms`);
  }
  return { text, sha256: sha256Hex(buf) };
}

/**
 * Resolve the upstream tree-sitter-cli metadata declared in package.json at commitSha.
 * @param {string} repo
 * @param {string} commitSha
 * @returns {Promise<string>}
 */
async function resolveDeclaredCliVersion(repo, commitSha) {
  try {
    const url = `https://raw.githubusercontent.com/${repo}/${commitSha}/package.json`;
    const buf = await fetchBuffer(url);
    const pkg = JSON.parse(buf.toString('utf8'));
    const version = (pkg.devDependencies && pkg.devDependencies['tree-sitter-cli'])
      || (pkg.dependencies && pkg.dependencies['tree-sitter-cli']);
    return typeof version === 'string' && version.trim() ? `upstream:${version.trim()}` : 'upstream-release-wasm';
  } catch {
    return 'upstream-release-wasm';
  }
}

/**
 * Compile tree-sitter-sql from pinned commit tarball into WASM via tree-sitter-cli.
 * @param {string} repo
 * @param {string} commitSha
 * @returns {Promise<{ wasmBuf: Buffer, cliVersion: string }>}
 */
async function compileSqlFromCommitTarball(repo, commitSha) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'konoha_sql_grammar_'));
  try {
    const tarballUrl = `https://codeload.github.com/${repo}/tar.gz/${commitSha}`;
    const tarballBuf = await fetchBuffer(tarballUrl);
    const tarPath = path.join(tmpDir, 'source.tar.gz');
    const unpackDir = path.join(tmpDir, 'src');
    fs.mkdirSync(unpackDir, { recursive: true });
    fs.writeFileSync(tarPath, tarballBuf);
    execFileSync('tar', ['-xzf', tarPath, '--strip-components=1', '-C', unpackDir], { stdio: 'pipe' });

    const outWasm = path.join(unpackDir, 'tree-sitter-sql.wasm');
    const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    execFileSync(
      pnpmCmd,
      ['dlx', `tree-sitter-cli@${TREE_SITTER_CLI_VERSION}`, 'build', '--wasm', '-o', outWasm],
      { cwd: unpackDir, stdio: 'pipe' }
    );
    return {
      wasmBuf: fs.readFileSync(outWasm),
      cliVersion: TREE_SITTER_CLI_VERSION
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function smokeParseBuffer(wts, wasmBuf, sampleCode, label) {
  return wts.Language.load(new Uint8Array(wasmBuf)).then((lang) => {
    const abiVersion = lang.abiVersion;
    if (abiVersion < wts.minCompatibleVersion || abiVersion > wts.languageVersion) {
      throw new Error(
        `ABI mismatch for ${label}: got ${abiVersion}, expected ${wts.minCompatibleVersion}..${wts.languageVersion}`
      );
    }
    const parser = new wts.Parser();
    let tree = null;
    try {
      parser.setLanguage(lang);
      tree = parser.parse(sampleCode);
      if (!tree || !tree.rootNode || tree.rootNode.hasError) {
        throw new Error(`Smoke parse failed with syntax error for ${label}`);
      }
      return { abiVersion, rootType: tree.rootNode.type };
    } finally {
      if (tree) tree.delete();
      parser.delete();
    }
  });
}

function formatThirdPartyLicenses(runtimeLicenseText, repoLicenses) {
  const parts = [
    '# Konoha Native Code Intelligence — Third-Party Tree-sitter Licenses',
    '',
    'All bundled parsing runtimes and language grammars in `assets/grammars/` are',
    'licensed under the permissive MIT License. Copyleft (GPL/LGPL/AGPL) grammars',
    'are strictly excluded.',
    '',
    '================================================================================',
    'Component: web-tree-sitter (runtime WASM)',
    `Package Version: ${JSON.parse(fs.readFileSync(path.join(RUNTIME_PKG_DIR, 'package.json'), 'utf8')).version}`,
    'Repository: https://github.com/tree-sitter/tree-sitter',
    'License: MIT',
    '--------------------------------------------------------------------------------',
    runtimeLicenseText.trim(),
    ''
  ];

  for (const item of repoLicenses) {
    parts.push(
      '================================================================================',
      `Repository: https://github.com/${item.repo}`,
      `Tag: ${item.tag}`,
      `Commit: ${item.commit_sha}`,
      `Languages: ${item.languages.join(', ')}`,
      `License SHA-256: ${item.license_sha256}`,
      'License: MIT',
      '--------------------------------------------------------------------------------',
      item.license_text,
      ''
    );
  }

  return parts.join('\n');
}

async function _resolveSpecWasm(spec, repoMeta, prebuiltSqlPath) {
  if (!spec.buildFromSource) {
    const releaseUrl = `https://github.com/${spec.repo}/releases/download/${spec.tag}/${spec.releaseAsset}`;
    const wasmBuf = await fetchBuffer(releaseUrl);
    const cliVersion = await resolveDeclaredCliVersion(spec.repo, repoMeta.commit_sha);
    return { wasmBuf, cliVersion };
  }
  if (prebuiltSqlPath && fs.existsSync(prebuiltSqlPath)) {
    return { wasmBuf: fs.readFileSync(prebuiltSqlPath), cliVersion: TREE_SITTER_CLI_VERSION };
  }
  return compileSqlFromCommitTarball(spec.repo, repoMeta.commit_sha);
}

/**
 * Download/compile all 11 pinned MIT grammars and runtime WASM, verify ABI & parses,
 * and write grammars.lock.json + THIRD_PARTY_LICENSES.txt.
 * @param {{ grammarsDir?: string, prebuiltSqlPath?: string }} [options]
 * @returns {Promise<{ ok: boolean, lockfilePath: string, grammars: object[] }>}
 */
async function buildGrammars(options = {}) {
  const grammarsDir = options.grammarsDir ? path.resolve(options.grammarsDir) : GRAMMARS_DIR;
  fs.mkdirSync(grammarsDir, { recursive: true });

  const runtimeDest = path.join(grammarsDir, 'tree-sitter.wasm');
  const runtimeBuf = fs.readFileSync(RUNTIME_WASM_SRC);
  fs.writeFileSync(runtimeDest, runtimeBuf);
  const runtimeLicenseText = fs.readFileSync(RUNTIME_LICENSE_SRC, 'utf8').replace(/\r\n/g, '\n');

  const wts = await initWebTreeSitter(runtimeDest);
  const repoCache = new Map();
  const repoLicenses = [];
  const lockedGrammars = [];

  for (const spec of GRAMMAR_SOURCES) {
    const cacheKey = `${spec.repo}@${spec.tag}`;
    let repoMeta = repoCache.get(cacheKey);
    if (!repoMeta) {
      const commitSha = await resolvePinnedCommitSha(spec.repo, spec.tag);
      const lic = await fetchVerifiedMitLicense(spec.repo, commitSha);
      repoMeta = {
        repo: spec.repo,
        tag: spec.tag,
        commit_sha: commitSha,
        license_sha256: lic.sha256,
        license_text: lic.text,
        languages: []
      };
      repoCache.set(cacheKey, repoMeta);
      repoLicenses.push(repoMeta);
    }
    repoMeta.languages.push(spec.language);

    const { wasmBuf, cliVersion } = await _resolveSpecWasm(spec, repoMeta, options.prebuiltSqlPath);

    const smoke = await smokeParseBuffer(wts, wasmBuf, spec.sample, spec.language);
    const outPath = path.join(grammarsDir, spec.file);
    fs.writeFileSync(outPath, wasmBuf);

    lockedGrammars.push({
      language: spec.language,
      file: spec.file,
      repo: `https://github.com/${spec.repo}`,
      tag: spec.tag,
      commit_sha: repoMeta.commit_sha,
      license: 'MIT',
      license_sha256: repoMeta.license_sha256,
      tree_sitter_cli_version: cliVersion,
      abi_version: smoke.abiVersion,
      bytes: wasmBuf.length,
      wasm_sha256: sha256Hex(wasmBuf)
    });
  }

  const runtimePkg = JSON.parse(fs.readFileSync(path.join(RUNTIME_PKG_DIR, 'package.json'), 'utf8'));
  const lockData = {
    schema_version: 1,
    runtime: {
      package: 'web-tree-sitter',
      version: runtimePkg.version,
      file: 'tree-sitter.wasm',
      license: 'MIT',
      language_version: wts.languageVersion,
      min_compatible_version: wts.minCompatibleVersion,
      bytes: runtimeBuf.length,
      sha256: sha256Hex(runtimeBuf)
    },
    grammars: lockedGrammars
  };

  const lockPath = path.join(grammarsDir, 'grammars.lock.json');
  const licensesPath = path.join(grammarsDir, 'THIRD_PARTY_LICENSES.txt');
  fs.writeFileSync(lockPath, `${JSON.stringify(lockData, null, 2)}\n`, 'utf8');
  fs.writeFileSync(licensesPath, formatThirdPartyLicenses(runtimeLicenseText, repoLicenses), 'utf8');

  return { ok: true, lockfilePath: lockPath, grammars: lockedGrammars };
}

/**
 * Offline verification of runtime WASM, 11 locked grammar WASMs, SHA-256 digests,
 * MIT licenses, ABI compatibility, and parse smoke checks.
 * @param {{ grammarsDir?: string }} [options]
 * @returns {Promise<{ ok: boolean, verifiedCount: number, runtime: object, grammars: object[] }>}
 */
async function verifyGrammars(options = {}) {
  const grammarsDir = options.grammarsDir ? path.resolve(options.grammarsDir) : GRAMMARS_DIR;
  const lockPath = path.join(grammarsDir, 'grammars.lock.json');
  const licensesPath = path.join(grammarsDir, 'THIRD_PARTY_LICENSES.txt');

  if (!fs.existsSync(lockPath)) {
    throw new Error(`Missing grammars lockfile: ${lockPath}`);
  }
  if (!fs.existsSync(licensesPath)) {
    throw new Error(`Missing THIRD_PARTY_LICENSES.txt: ${licensesPath}`);
  }

  const licensesText = fs.readFileSync(licensesPath, 'utf8');
  if (!licensesText.includes('web-tree-sitter') || !licensesText.includes('Permission is hereby granted, free of charge')) {
    throw new Error('THIRD_PARTY_LICENSES.txt is incomplete or missing MIT grant');
  }

  const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!lockData || lockData.schema_version !== 1 || !lockData.runtime || !Array.isArray(lockData.grammars)) {
    throw new Error('Malformed grammars.lock.json schema');
  }

  const runtimePath = path.join(grammarsDir, lockData.runtime.file);
  if (!fs.existsSync(runtimePath)) {
    throw new Error(`Missing runtime WASM: ${runtimePath}`);
  }
  const runtimeBuf = fs.readFileSync(runtimePath);
  if (runtimeBuf.length !== lockData.runtime.bytes || sha256Hex(runtimeBuf) !== lockData.runtime.sha256) {
    throw new Error(`Runtime WASM checksum/size mismatch for ${lockData.runtime.file}`);
  }

  const expectedLangs = new Set(GRAMMAR_SOURCES.map((entry) => entry.language));
  if (lockData.grammars.length !== expectedLangs.size) {
    throw new Error(`Expected ${expectedLangs.size} locked grammars, found ${lockData.grammars.length}`);
  }

  const wts = await initWebTreeSitter(runtimePath);
  const seenLangs = new Set();
  const verifiedGrammars = [];

  for (const entry of lockData.grammars) {
    if (!expectedLangs.has(entry.language) || seenLangs.has(entry.language)) {
      throw new Error(`Unexpected or duplicate locked language: ${entry.language}`);
    }
    seenLangs.add(entry.language);

    if (entry.license !== 'MIT') {
      throw new Error(`Forbidden non-MIT license "${entry.license}" for ${entry.language}`);
    }
    if (!/^[0-9a-f]{40}$/.test(entry.commit_sha || '')) {
      throw new Error(`Missing 40-hex commit_sha for ${entry.language}`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.wasm_sha256 || '') || !/^[0-9a-f]{64}$/.test(entry.license_sha256 || '')) {
      throw new Error(`Invalid SHA-256 digest metadata for ${entry.language}`);
    }
    if (!licensesText.includes(entry.commit_sha) || !licensesText.includes(entry.license_sha256)) {
      throw new Error(`THIRD_PARTY_LICENSES.txt missing attribution for ${entry.language} (${entry.commit_sha})`);
    }

    const wasmPath = path.join(grammarsDir, entry.file);
    if (!fs.existsSync(wasmPath)) {
      throw new Error(`Missing grammar WASM file: ${wasmPath}`);
    }
    const wasmBuf = fs.readFileSync(wasmPath);
    const actualHash = sha256Hex(wasmBuf);
    if (wasmBuf.length !== entry.bytes || actualHash !== entry.wasm_sha256) {
      throw new Error(
        `SHA-256 mismatch for ${entry.file}: expected ${entry.wasm_sha256} (${entry.bytes}B), got ${actualHash} (${wasmBuf.length}B)`
      );
    }

    const sample = SAMPLE_BY_LANGUAGE[entry.language];
    const smoke = await smokeParseBuffer(wts, wasmBuf, sample, entry.language);
    if (smoke.abiVersion !== entry.abi_version) {
      throw new Error(`ABI drift for ${entry.language}: lock=${entry.abi_version}, actual=${smoke.abiVersion}`);
    }

    verifiedGrammars.push({
      language: entry.language,
      file: entry.file,
      abi_version: smoke.abiVersion,
      bytes: wasmBuf.length,
      wasm_sha256: actualHash
    });
  }

  return {
    ok: true,
    verifiedCount: verifiedGrammars.length,
    runtime: {
      version: lockData.runtime.version,
      bytes: runtimeBuf.length,
      sha256: lockData.runtime.sha256
    },
    grammars: verifiedGrammars
  };
}

async function main() {
  const args = process.argv.slice(2);
  const isBuild = args.includes('--build');
  const prebuiltArg = args.find((arg) => arg.startsWith('--prebuilt-sql='));
  const prebuiltSqlPath = prebuiltArg ? prebuiltArg.slice('--prebuilt-sql='.length) : undefined;

  if (isBuild) {
    const built = await buildGrammars({ prebuiltSqlPath });
    const verified = await verifyGrammars();
    console.log(
      `Built and verified ${verified.verifiedCount} grammars (runtime web-tree-sitter@${verified.runtime.version}) -> ${built.lockfilePath}`
    );
    return;
  }

  const verified = await verifyGrammars();
  console.log(
    `Verified ${verified.verifiedCount} locked grammars + runtime web-tree-sitter@${verified.runtime.version} (offline strict SHA-256 OK)`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[build_grammars] ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });
}

module.exports = {
  GRAMMARS_DIR,
  LOCKFILE_PATH,
  LICENSES_PATH,
  GRAMMAR_SOURCES,
  buildGrammars,
  verifyGrammars
};
