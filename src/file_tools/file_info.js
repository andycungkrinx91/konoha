/**
 * File metadata without reading full content — saves tokens before targeted reads.
 * Pure Node.js in-process implementation.
 */

const fs = require('fs');
const path = require('path');
const common = require('./common');

function countLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return (content.match(/\n/g) || []).length + (content.endsWith('\n') ? 0 : 1);
}

function fileInfo(args = {}) {
  const rawPath = args.path || args.file_path || args.filepath || args.FilePath || args.Path;
  const filePath = common.resolvePath(rawPath, args.workspace, args.dev_root);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isText = common.isProbablyText(filePath);

  let lineCount = null;
  if (isText && stat.size <= 5000000) {
    try {
      lineCount = countLines(filePath);
    } catch (_) {}
  }

  return {
    path: filePath,
    basename: path.basename(filePath),
    extension: ext,
    size_bytes: stat.size,
    modified_utc: new Date(stat.mtimeMs).toISOString(),
    is_probably_text: isText,
    line_count: lineCount
  };
}

module.exports = {
  fileInfo,
  run: fileInfo
};
