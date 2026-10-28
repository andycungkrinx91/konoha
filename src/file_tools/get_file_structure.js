/**
 * Extract compact structural signatures (classes/functions) from a source file or directory.
 * Pure Node.js in-process implementation with pagination.
 */

const fs = require('fs');
const path = require('path');
const common = require('./common');

function _matchPythonSymbol(line, lineNo) {
  const classMatch = line.match(/^\s*class\s+([a-zA-Z0-9_]+)(?:\((.*?)\))?:/);
  if (classMatch) {
    const bases = classMatch[2] ? `(${classMatch[2]})` : '';
    return { name: `class ${classMatch[1]}${bases}`, start_line: lineNo };
  }
  const fnMatch = line.match(/^\s*(async\s+)?def\s+([a-zA-Z0-9_]+)\s*\((.*?)\):/);
  if (fnMatch) {
    const prefix = fnMatch[1] ? 'async def' : 'def';
    return { name: `${prefix} ${fnMatch[2]}(${fnMatch[3]})`, start_line: lineNo };
  }
  return null;
}

function _matchJsTsSymbol(line, lineNo) {
  const match = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*(\*?\s*\w*)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?function|(?:interface|type|enum)\s+(\w+))/);
  if (match) {
    let snippet = line.trim();
    if (snippet.length > 120) snippet = snippet.substring(0, 120) + '…';
    return { name: snippet, start_line: lineNo };
  }
  const methodMatch = line.match(/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/);
  if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
    let snippet = line.trim();
    if (snippet.length > 120) snippet = snippet.substring(0, 120) + '…';
    return { name: snippet, start_line: lineNo };
  }
  return null;
}

function _matchGoSymbol(line, lineNo) {
  const fnMatch = line.match(/^\s*func\s+(?:\((?:[^)]+)\)\s+)?([a-zA-Z0-9_]+)\s*\(/);
  if (fnMatch) {
    let snippet = line.trim();
    if (snippet.length > 120) snippet = snippet.substring(0, 120) + '…';
    return { name: snippet, start_line: lineNo };
  }
  const typeMatch = line.match(/^\s*type\s+([a-zA-Z0-9_]+)\s+(?:struct|interface)/);
  if (typeMatch) {
    return { name: line.trim(), start_line: lineNo };
  }
  return null;
}

function _matchGenericSymbol(line, lineNo) {
  const match = line.match(/^\s*(?:pub\s+)?(?:async\s+)?(?:fn|func|def|class|struct|enum|interface|type)\s+(\w+)/);
  if (match) {
    let snippet = line.trim();
    if (snippet.length > 120) snippet = snippet.substring(0, 120) + '…';
    return { name: snippet, start_line: lineNo };
  }
  return null;
}

function _getSymbolMatcher(ext) {
  if (ext === '.py') return _matchPythonSymbol;
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(ext)) return _matchJsTsSymbol;
  if (ext === '.go') return _matchGoSymbol;
  return _matchGenericSymbol;
}

function structureFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  const fileLines = content.split(/\r?\n/);
  const totalLines = fileLines.length;
  const symbols = [];
  const matcher = _getSymbolMatcher(ext);

  fileLines.forEach((line, idx) => {
    const sym = matcher(line, idx + 1);
    if (sym) symbols.push(sym);
  });

  for (let i = 0; i < symbols.length; i++) {
    const nextStart = i + 1 < symbols.length ? symbols[i + 1].start_line - 1 : totalLines;
    symbols[i].end_line = Math.max(symbols[i].start_line, nextStart);
  }

  return { symbols, totalLines };
}

function _formatDirEntry(targetPath, entry) {
  const full = path.join(targetPath, entry);
  try {
    if (!fs.existsSync(full)) return null;
    const st = fs.statSync(full);
    if (st.isDirectory()) return { isDir: true, text: `📁 ${entry}/` };
    if (st.isFile()) {
      const sizeStr = st.size < 1024 ? `${st.size}B` : `${Math.floor(st.size / 1024)}KB`;
      return { isDir: false, text: `📄 ${entry}  (${sizeStr})` };
    }
  } catch { /* ignore */ }
  return null;
}

function _structureDirectory(targetPath) {
  const entries = fs.readdirSync(targetPath).sort();
  const dirs = [];
  const files = [];
  const skipSet = new Set([
    'node_modules', '__pycache__', '.git', 'dist', 'build',
    'venv', '.venv', '.next', '.nuxt', '.svelte-kit'
  ]);

  for (const entry of entries) {
    if (entry.startsWith('.') || skipSet.has(entry)) continue;
    const formatted = _formatDirEntry(targetPath, entry);
    if (!formatted) continue;
    if (formatted.isDir) dirs.push(formatted.text);
    else files.push(formatted.text);
  }

  const outputLines = dirs.concat(files);
  const text = outputLines.join('\n');
  return {
    path: targetPath,
    is_directory: true,
    count: outputLines.length,
    total_lines: outputLines.length,
    returned_range: [1, outputLines.length],
    complete: true,
    next_range: null,
    remaining_lines: 0,
    structure: text,
    text
  };
}

function getFileStructure(args = {}) {
  const rawPath = args.path || args.file_path || args.filepath || args.FilePath || args.Path || args.dir_path || args.dir || args.DirectoryPath || '.';
  const targetPath = common.resolvePath(rawPath, args.workspace, args.dev_root);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path not found: ${targetPath}`);
  }

  if (fs.statSync(targetPath).isDirectory()) {
    return _structureDirectory(targetPath);
  }

  const { symbols, totalLines } = structureFile(targetPath);
  const totalSymbols = symbols.length;
  const pageSize = parseInt(args.limit || args.page_size || args.max_entries || 200, 10);
  const page = parseInt(args.page || 1, 10);
  const totalPages = Math.max(1, Math.ceil(totalSymbols / pageSize));

  const startIdx = (page - 1) * pageSize;
  const endIdx = Math.min(totalSymbols, startIdx + pageSize);
  const pageSymbols = symbols.slice(startIdx, endIdx);

  const formattedLines = pageSymbols.map(s => {
    return `${s.name}  # L${s.start_line}-L${s.end_line}`;
  });

  const complete = endIdx >= totalSymbols;
  let truncationNotice = null;
  if (!complete) {
    truncationNotice = `[Truncation Notice: Showing symbols ${startIdx + 1}-${endIdx} of ${totalSymbols} (page ${page}/${totalPages}). Use outline first, then request page: ${page + 1} or read ranges aligned to symbols.]`;
    formattedLines.push(truncationNotice);
  }

  const firstLine = pageSymbols.length > 0 ? pageSymbols[0].start_line : 1;
  const lastLine = pageSymbols.length > 0 ? pageSymbols[pageSymbols.length - 1].end_line : totalLines;
  const remainingLines = Math.max(0, totalLines - lastLine);

  const text = formattedLines.join('\n');
  return {
    path: targetPath,
    is_directory: false,
    symbols: pageSymbols,
    line_count: pageSymbols.length,
    total_lines: totalLines,
    total_symbols: totalSymbols,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    returned_range: [firstLine, lastLine],
    complete,
    next_page: complete ? null : page + 1,
    next_range: complete ? null : [lastLine + 1, Math.min(totalLines, lastLine + 250)],
    remaining_lines: remainingLines,
    truncation_notice: truncationNotice,
    structure: text,
    text
  };
}

module.exports = {
  getFileStructure,
  run: getFileStructure
};
