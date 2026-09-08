/**
 * Stream-read a line range with line numbers. Max span: 500 lines.
 * Pure Node.js in-process implementation.
 */

const fs = require('fs');
const common = require('./common');

const MAX_SPAN = 500;

function readFileRange(args = {}) {
  const rawPath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const filePath = common.resolvePath(rawPath, args.workspace, args.dev_root);

  const startLine = parseInt(args.start_line !== undefined ? args.start_line : args.StartLine, 10);
  const endLine = parseInt(args.end_line !== undefined ? args.end_line : (args.EndLine !== undefined ? args.EndLine : startLine), 10);

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

  const linesOut = [];
  for (let lineNo = startLine; lineNo <= endLine && lineNo <= allLines.length; lineNo++) {
    const line = allLines[lineNo - 1];
    linesOut.push(`${String(lineNo).padStart(6, ' ')}|${line}`);
  }

  return {
    path: filePath,
    start_line: startLine,
    end_line: endLine,
    line_count: linesOut.length,
    text: linesOut.join('\n')
  };
}

module.exports = {
  readFileRange,
  run: readFileRange
};
