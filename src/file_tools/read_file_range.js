/**
 * Stream-read a line range with line numbers and pagination.
 * Pure Node.js in-process implementation with zero memory bloat on large files (>1000 lines).
 */

const fs = require('fs');
const common = require('./common');

const DEFAULT_CHUNK_SIZE = 200;
const MAX_SPAN = 250;
const MAX_LINE_CHARS = 1000;
const DEFAULT_BYTE_BUDGET = 262144; // 256KB covers full spans with rich context

function readFileRange(args = {}) {
  const rawPath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const filePath = common.resolvePath(rawPath, args.workspace, args.dev_root);

  let startVal = args.start_line !== undefined ? args.start_line : (
    args.StartLine !== undefined ? args.StartLine : (
      args.start !== undefined ? args.start : (
        args.line_start !== undefined ? args.line_start : (
          args.from !== undefined ? args.from : (
            args.offset !== undefined ? args.offset : (
              args.line !== undefined ? args.line : undefined
            )
          )
        )
      )
    )
  );

  let endVal = args.end_line !== undefined ? args.end_line : (
    args.EndLine !== undefined ? args.EndLine : (
      args.end !== undefined ? args.end : (
        args.line_end !== undefined ? args.line_end : (
          args.to !== undefined ? args.to : (
            args.limit !== undefined && startVal !== undefined ? (Number(startVal) + Number(args.limit) - 1) : (
              args.lines !== undefined && startVal !== undefined ? (Number(startVal) + Number(args.lines) - 1) : undefined
            )
          )
        )
      )
    )
  );

  if (Array.isArray(args.range) && args.range.length >= 2) {
    if (startVal === undefined) startVal = args.range[0];
    if (endVal === undefined) endVal = args.range[1];
  }

  const startLine = parseInt(startVal !== undefined ? startVal : 1, 10);
  const endLineInput = parseInt(endVal !== undefined ? endVal : startLine, 10);
  const byteBudget = parseInt(args.byte_budget || args.max_bytes || DEFAULT_BYTE_BUDGET, 10);

  if (isNaN(startLine) || isNaN(endLineInput) || startLine < 1 || endLineInput < 1) {
    throw new Error('start_line and end_line must be >= 1');
  }
  if (endLineInput < startLine) {
    throw new Error('end_line must be >= start_line');
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Graceful auto-clamping when requested span exceeds MAX_SPAN (250 lines):
  // When auto_paginate is enabled (default via MCP router), clamp to DEFAULT_CHUNK_SIZE (200 lines)
  // When strict/direct call without auto_paginate, enforce MAX_SPAN refusal
  const requestedSpan = endLineInput - startLine + 1;
  const autoPaginate = Boolean(args.auto_paginate || args.paginate || args.auto_clamp || args.chunk_loop);

  if (requestedSpan > MAX_SPAN && !autoPaginate) {
    throw new Error(
      `Refused: requested span is ${requestedSpan} lines (max ${MAX_SPAN}). ` +
      `Narrow the range, read in chunks, or pass auto_paginate: true.`
    );
  }

  const isAutoClamped = requestedSpan > MAX_SPAN;
  const targetEndLine = isAutoClamped ? (startLine + DEFAULT_CHUNK_SIZE - 1) : endLineInput;

  const buf = fs.readFileSync(filePath);
  const bufLen = buf.length;

  let currentLine = 1;
  let lineStart = 0;
  const linesOut = [];
  let bytesCount = 0;
  let actualEndLine = startLine - 1;

  for (let i = 0; i < bufLen; i++) {
    if (buf[i] === 0x0A) { // \n
      if (currentLine >= startLine && currentLine <= targetEndLine) {
        let lineEnd = i;
        if (lineEnd > lineStart && buf[lineEnd - 1] === 0x0D) { // \r
          lineEnd--;
        }
        let lineStr = buf.toString('utf8', lineStart, lineEnd);
        if (lineStr.length > MAX_LINE_CHARS) {
          lineStr = lineStr.substring(0, MAX_LINE_CHARS) + `... [line truncated from ${lineStr.length} chars]`;
        }
        const formatted = `${String(currentLine).padStart(6, ' ')}|${lineStr}`;
        const lineBytes = Buffer.byteLength(formatted, 'utf8') + 1;
        if (linesOut.length > 0 && bytesCount + lineBytes > byteBudget) {
          break;
        }
        bytesCount += lineBytes;
        linesOut.push(formatted);
        actualEndLine = currentLine;
      }
      currentLine++;
      lineStart = i + 1;
    }
  }

  // Handle trailing content if file does not end in \n
  if (lineStart < bufLen) {
    if (currentLine >= startLine && currentLine <= targetEndLine) {
      let lineEnd = bufLen;
      if (lineEnd > lineStart && buf[lineEnd - 1] === 0x0D) {
        lineEnd--;
      }
      let lineStr = buf.toString('utf8', lineStart, lineEnd);
      if (lineStr.length > MAX_LINE_CHARS) {
        lineStr = lineStr.substring(0, MAX_LINE_CHARS) + `... [line truncated from ${lineStr.length} chars]`;
      }
      const formatted = `${String(currentLine).padStart(6, ' ')}|${lineStr}`;
      const lineBytes = Buffer.byteLength(formatted, 'utf8') + 1;
      if (linesOut.length === 0 || bytesCount + lineBytes <= byteBudget) {
        bytesCount += lineBytes;
        linesOut.push(formatted);
        actualEndLine = currentLine;
      }
    }
  }

  const totalLines = (bufLen === 0) ? 0 : (buf[bufLen - 1] === 0x0A ? currentLine - 1 : currentLine);

  if (linesOut.length === 0 && startLine <= totalLines) {
    actualEndLine = startLine;
  }

  const complete = actualEndLine >= totalLines;
  const remainingLines = Math.max(0, totalLines - actualEndLine);
  const stepSize = isAutoClamped ? DEFAULT_CHUNK_SIZE : Math.max(1, actualEndLine - startLine + 1);
  const nextSpan = Math.min(isAutoClamped ? DEFAULT_CHUNK_SIZE : MAX_SPAN, stepSize);
  const nextStart = actualEndLine + 1;
  const nextEnd = Math.min(totalLines, nextStart + nextSpan - 1);
  const nextRange = !complete && nextStart <= totalLines ? [nextStart, nextEnd] : null;

  const chunkSize = isAutoClamped ? DEFAULT_CHUNK_SIZE : stepSize;
  const totalPages = totalLines > 0 ? Math.ceil(totalLines / chunkSize) : 1;
  const currentPage = Math.ceil(startLine / chunkSize);

  return {
    path: filePath,
    start_line: startLine,
    end_line: actualEndLine,
    line_count: linesOut.length,
    total_lines: totalLines,
    returned_range: [startLine, actualEndLine],
    complete,
    has_more: !complete,
    next_range: nextRange,
    remaining_lines: remainingLines,
    pagination: {
      current_page: currentPage,
      total_pages: totalPages,
      chunk_size: chunkSize,
      is_clamped: isAutoClamped,
      next_command: nextRange ? `konoha.read_file_range(start_line: ${nextRange[0]}, end_line: ${nextRange[1]})` : null
    },
    text: linesOut.join('\n')
  };
}

module.exports = {
  readFileRange,
  run: readFileRange
};
