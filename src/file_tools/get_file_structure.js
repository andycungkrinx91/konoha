/**
 * Extract compact structural signatures (classes/functions) from a source file or directory.
 * Pure Node.js in-process implementation.
 */

const fs = require('fs');
const path = require('path');
const common = require('./common');


function structureFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  const lines = [];

  if (ext === '.py') {
    const fileLines = content.split(/\r?\n/);
    fileLines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const classMatch = line.match(/^\s*class\s+([a-zA-Z0-9_]+)(?:\((.*?)\))?:/);
      if (classMatch) {
        const bases = classMatch[2] ? `(${classMatch[2]})` : '';
        lines.push(`class ${classMatch[1]}${bases}:  # L${lineNo}`);
      } else {
        const fnMatch = line.match(/^\s*(async\s+)?def\s+([a-zA-Z0-9_]+)\s*\((.*?)\):/);
        if (fnMatch) {
          const prefix = fnMatch[1] ? 'async def' : 'def';
          lines.push(`${prefix} ${fnMatch[2]}(${fnMatch[3]}):  # L${lineNo}`);
        }
      }
    });
  } else if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(ext)) {
    const fileLines = content.split(/\r?\n/);
    fileLines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const match = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:interface|type)\s+(\w+))/);
      if (match) {
        let snippet = line.trim();
        if (snippet.length > 100) snippet = snippet.substring(0, 100) + '…';
        lines.push(`${snippet}  # L${lineNo}`);
      }
    });
  } else {
    const fileLines = content.split(/\r?\n/);
    fileLines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const match = line.match(/^\s*(?:pub\s+)?(?:async\s+)?(?:fn|func|def|class|struct|enum|interface|type)\s+(\w+)/);
      if (match) {
        let snippet = line.trim();
        if (snippet.length > 100) snippet = snippet.substring(0, 100) + '…';
        lines.push(`${snippet}  # L${lineNo}`);
      }
    });
  }

  return lines.slice(0, 200);
}

function getFileStructure(args = {}) {
  const rawPath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const targetPath = common.resolvePath(rawPath, args.workspace, args.dev_root);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Path not found: ${targetPath}`);
  }

  if (fs.statSync(targetPath).isDirectory()) {
    const entries = fs.readdirSync(targetPath).sort();
    const dirs = [];
    const files = [];

    const skipSet = new Set([
      'node_modules', '__pycache__', '.git', 'dist', 'build',
      'venv', '.venv', '.next', '.nuxt', '.svelte-kit'
    ]);

    for (const entry of entries) {
      if (entry.startsWith('.') || skipSet.has(entry)) continue;
      const full = path.join(targetPath, entry);
      if (fs.statSync(full).isDirectory()) {
        dirs.push(`📁 ${entry}/`);
      } else if (fs.statSync(full).isFile()) {
        const size = fs.statSync(full).size;
        const sizeStr = size < 1024 ? `${size}B` : `${Math.floor(size / 1024)}KB`;
        files.push(`📄 ${entry}  (${sizeStr})`);
      }
    }

    const outputLines = dirs.concat(files);
    const text = outputLines.join('\n');
    return {
      path: targetPath,
      is_directory: true,
      count: outputLines.length,
      structure: text,
      text
    };
  }

  const lines = structureFile(targetPath);
  const text = lines.join('\n');
  return {
    path: targetPath,
    is_directory: false,
    line_count: lines.length,
    structure: text,
    text
  };
}

module.exports = {
  getFileStructure,
  run: getFileStructure
};
