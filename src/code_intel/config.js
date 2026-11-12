'use strict';

/**
 * Caps and exclusions for the native code-intelligence index.
 *
 * Every bound here exists to keep one `code_index` call from turning into an
 * unbounded scan of a user's filesystem. They are deliberately conservative:
 * the index is an accelerator, not an archive, and a truncated index that
 * says so beats an index that never finishes.
 */

// Never descend into these directory names at any depth. `bin` is deliberately
// absent: it is build output for .NET/Java (whose payloads are excluded by
// extension anyway) but real source in Node and shell projects, this one included.
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'vendor', 'dist', 'build', 'out',
  'target', 'coverage', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache',
  '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache',
  'Pods', '.gradle', '.idea', '.vs', 'obj', '.terraform'
]);

// Binary and generated artifacts that would only pollute the index.
const EXCLUDED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.svg',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.mp3', '.wav', '.flac', '.ogg',
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar', '.zst',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.obj', '.lib', '.wasm',
  '.class', '.jar', '.pyc', '.pyo', '.node',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.db', '.sqlite', '.sqlite3', '.db-wal', '.db-shm', '.log', '.map',
  '.lock', '.min.js', '.min.css', '.snap'
]);

// Files above this size are skipped: they are almost always generated,
// vendored, or data dumps, and one of them can dwarf the whole index.
const MAX_FILE_BYTES = 1024 * 1024; // 1 MiB
const MAX_FILES_PER_ROOT = 20000;
const MAX_SYMBOLS_PER_FILE = 2000;
const MAX_REFS_PER_FILE = 5000;

// Chunking: symbol bodies are chunked whole when small, split when large.
const CHUNK_MAX_LINES = 40;
const CHUNK_MAX_CHARS = 2000;
const CHUNK_OVERLAP_LINES = 8;

// Query bounds.
const SEARCH_MAX_HITS = 20;
const SEARCH_SNIPPET_MAX_CHARS = 2000;
const IMPACT_MAX_DEPTH = 3;
const IMPACT_MAX_NODES = 200;

// Credential-bearing names. The language allowlist in `parser.js` already
// rejects most of these by extension, but a secret must never enter the index
// because of an incidental gap in that map — say a future `.env` language.
const SECRET_NAMES = /^(\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)(\..*)?)$/i;
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.asc']);

function isExcludedDir(name) {
  return EXCLUDED_DIRS.has(name);
}

function isExcludedFile(name) {
  const lower = name.toLowerCase();
  if (SECRET_NAMES.test(name)) return true;
  for (const ext of EXCLUDED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && SECRET_EXTENSIONS.has(lower.slice(dot));
}

module.exports = {
  EXCLUDED_DIRS,
  EXCLUDED_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_FILES_PER_ROOT,
  MAX_SYMBOLS_PER_FILE,
  MAX_REFS_PER_FILE,
  CHUNK_MAX_LINES,
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_LINES,
  SEARCH_MAX_HITS,
  SEARCH_SNIPPET_MAX_CHARS,
  IMPACT_MAX_DEPTH,
  IMPACT_MAX_NODES,
  isExcludedDir,
  isExcludedFile
};
