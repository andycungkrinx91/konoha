/**
 * Stream-read a line range with line numbers. Max span: 250 lines / 32KB budget.
 * Pure Node.js in-process implementation.
 */

const fs = require('fs');
const common = require('./common');

const MAX_SPAN = 250;
const MAX_LINE_CHARS = 1000;
const DEFAULT_BYTE_BUDGET = 65536; // 64KB covers full 250-line spans comfortably

function readFileRange(args = {}) {
  const rawPath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const filePath = common.resolvePath(rawPath, args.workspace, args.dev_root);

  const startLine = parseInt(args.start_line !== undefined ? args.start_line : args.StartLine, 10);
  const endLine = parseInt(args.end_line !== undefined ? args.end_line : (args.EndLine !== undefined ? args.EndLine : startLine), 10);
  const byteBudget = parseInt(args.byte_budget || args.max_bytes || DEFAULT_BYTE_BUDGET, 10);

  if (isNaN(startLine) || isNaN(endLine) || startLine < 1 || endLine < 1) {
    throw new Error('start_line and end_line must be >= 1');
  }
  if (endLine < startLine) {
    throw new Error('end_line must be >= start_line');
  }

  const span = endLine - startLine + 1;
  if (span > MAX_SPAN) {
    throw new Error(
      `Refused: requested span is ${span} lines (max ${MAX_SPAN}). ` +
      `Narrow the range or read in chunks.`
    );
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const allLines = content.split(/\r?\n/);
  const totalLines = allLines.length;

  const linesOut = [];
  let bytesCount = 0;
  let actualEndLine = startLine - 1;

  for (let lineNo = startLine; lineNo <= endLine && lineNo <= totalLines; lineNo++) {
    const line = allLines[lineNo - 1];
    const safeLine = line.length > MAX_LINE_CHARS ? line.substring(0, MAX_LINE_CHARS) + `... [line truncated from ${line.length} chars]` : line;
    const formatted = `${String(lineNo).padStart(6, ' ')}|${safeLine}`;
    const lineBytes = Buffer.byteLength(formatted, 'utf8') + 1;
    if (linesOut.length > 0 && bytesCount + lineBytes > byteBudget) {
      break;
    }
    bytesCount += lineBytes;
    linesOut.push(formatted);
    actualEndLine = lineNo;
  }

  if (linesOut.length === 0 && startLine <= totalLines) {
    const line = allLines[startLine - 1];
    const safeLine = line.length > MAX_LINE_CHARS ? line.substring(0, MAX_LINE_CHARS) + `... [line truncated from ${line.length} chars]` : line;
    linesOut.push(`${String(startLine).padStart(6, ' ')}|${safeLine}`);
    actualEndLine = startLine;
  }

  const complete = actualEndLine >= totalLines;
  const remainingLines = Math.max(0, totalLines - actualEndLine);
  const nextSpan = Math.min(MAX_SPAN, Math.max(1, actualEndLine - startLine + 1));
  const nextStart = actualEndLine + 1;
  const nextEnd = Math.min(totalLines, nextStart + nextSpan - 1);
  const nextRange = !complete && nextStart <= totalLines ? [nextStart, nextEnd] : null;

  return {
    path: filePath,
    start_line: startLine,
    end_line: actualEndLine,
    line_count: linesOut.length,
    total_lines: totalLines,
    returned_range: [startLine, actualEndLine],
    complete,
    next_range: nextRange,
    remaining_lines: remainingLines,
    text: linesOut.join('\n')
  };
}

module.exports = {
  readFileRange,
  run: readFileRange
};
