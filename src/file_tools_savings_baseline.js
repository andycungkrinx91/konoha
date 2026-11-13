/**
 * Byte-baseline measurement for tool-call savings accounting, kept separate
 * from the MCP server entrypoint so the transport file stays focused.
 */
const fs = require("fs");
const router = require("./file_tools_router");

/**
 * Measure the bytes a naive full-corpus read would have produced for a search
 * tool. Directories are walked to a bounded depth so the figure reflects real
 * content; when nothing can be measured the result is 0 and callers record no
 * savings claim instead of inventing a default.
 */
const BASELINE_MAX_ENTRIES = 5000;
const BASELINE_MAX_DEPTH = 8;

function _measureTreeBytes(rootPath) {
  let total = 0;
  let visited = 0;
  const stack = [{ dir: rootPath, depth: 0 }];
  while (stack.length > 0 && visited < BASELINE_MAX_ENTRIES) {
    const { dir, depth } = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (visited >= BASELINE_MAX_ENTRIES) break;
      const full = require('path').join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
        if (depth < BASELINE_MAX_DEPTH) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      try {
        total += fs.statSync(full).size;
      } catch (_) { /* unreadable entry: skip */ }
    }
  }
  return total;
}

function getBaselineBytesForTool(toolName, args) {
  try {
    const target = args.path || args.file_path || args.filepath || args.dir || args.directory || args.target;
    if (!target) return 0;
    const resolved = router.resolveInputPath(target);
    if (!fs.existsSync(resolved)) return 0;
    const st = fs.statSync(resolved);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    return _measureTreeBytes(resolved);
  } catch (_) {
    return 0;
  }
}

module.exports = { getBaselineBytesForTool };