/**
 * Read the first N lines of a file with line numbers. Max lines: 200.
 * Pure Node.js in-process implementation.
 */

const fs = require('fs');
const common = require('./common');

const DEFAULT_LINES = 80;
const MAX_LINES = 200;

function readFileHead(args = {}) {
  const rawPath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const filePath = common.resolvePath(rawPath, args.workspace, args.dev_root);
  const maxLines = parseInt(args.max_lines || args.maxLines || DEFAULT_LINES, 10);

  if (isNaN(maxLines) || maxLines < 1) {
    throw new Error('max_lines must be >= 1');
  }
  if (maxLines > MAX_LINES) {
    throw new Error(`Refused: max_lines ${maxLines} exceeds cap ${MAX_LINES}`);
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const allLines = content.split(/\r?\n/);
  const totalLines = allLines.length;

  const MAX_LINE_CHARS = 4000;
  const slice = allLines.slice(0, maxLines);
  const linesOut = slice.map((line, idx) => {
    const lineNo = idx + 1;
    const safeLine = line.length > MAX_LINE_CHARS ? line.substring(0, MAX_LINE_CHARS) + `... [line truncated from ${line.length} chars]` : line;
    return `${String(lineNo).padStart(6, ' ')}|${safeLine}`;
  });

  const truncated = totalLines > maxLines;
  return {
    path: filePath,
    max_lines: maxLines,
    line_count: linesOut.length,
    total_lines: truncated ? `>${maxLines}` : totalLines,
    truncated,
    text: linesOut.join('\n')
  };
}

module.exports = {
  readFileHead,
  run: readFileHead
};
