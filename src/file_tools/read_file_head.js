/**
 * Read the first N lines of a file with line numbers. Max lines: 150.
 * Pure Node.js in-process implementation.
 */

const fs = require('fs');
const common = require('./common');

const DEFAULT_LINES = 50;
const MAX_LINES = 150;
const MAX_LINE_CHARS = 1000;
const DEFAULT_BYTE_BUDGET = 32768; // 32KB covers p99 of repository files

function readFileHead(args = {}) {
  const rawPath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const filePath = common.resolvePath(rawPath, args.workspace, args.dev_root);
  const maxLines = parseInt(args.max_lines || args.maxLines || DEFAULT_LINES, 10);
  const byteBudget = parseInt(args.byte_budget || args.max_bytes || DEFAULT_BYTE_BUDGET, 10);

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

  const linesOut = [];
  let bytesCount = 0;
  for (let idx = 0; idx < maxLines && idx < totalLines; idx++) {
    const lineNo = idx + 1;
    const line = allLines[idx];
    const safeLine = line.length > MAX_LINE_CHARS ? line.substring(0, MAX_LINE_CHARS) + `... [line truncated from ${line.length} chars]` : line;
    const formatted = `${String(lineNo).padStart(6, ' ')}|${safeLine}`;
    const lineBytes = Buffer.byteLength(formatted, 'utf8') + 1;
    if (linesOut.length > 0 && bytesCount + lineBytes > byteBudget) {
      break;
    }
    bytesCount += lineBytes;
    linesOut.push(formatted);
  }

  const returnedEnd = linesOut.length;
  const complete = returnedEnd >= totalLines;
  const remainingLines = Math.max(0, totalLines - returnedEnd);
  const nextSpan = returnedEnd > 0 ? returnedEnd : maxLines;
  const nextStart = returnedEnd + 1;
  const nextEnd = Math.min(totalLines, nextStart + nextSpan - 1);
  const nextRange = !complete && nextStart <= totalLines ? [nextStart, nextEnd] : null;

  return {
    path: filePath,
    max_lines: maxLines,
    line_count: linesOut.length,
    total_lines: totalLines,
    returned_range: [1, returnedEnd],
    complete,
    next_range: nextRange,
    remaining_lines: remainingLines,
    truncated: !complete,
    text: linesOut.join('\n')
  };
}

module.exports = {
  readFileHead,
  run: readFileHead
};
