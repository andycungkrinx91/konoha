#!/usr/bin/env node
'use strict';

/**
 * scripts/audit_src_boundaries.js — Issue #25 dependency audit.
 *
 * Builds a source-derived dependency graph over src/**\/*.js (excluding
 * src/templates/, which is vendored packaging rather than runtime code), then
 * reports the facts an architecture proposal has to be grounded in:
 *
 *   - in-degree hubs (modules many others reach into),
 *   - cycles (Tarjan SCC over the resolved edges),
 *   - cross-domain edges and the direction they run,
 *   - dynamic/computed requires that a static graph cannot resolve,
 *   - root-level src/*.js files by in-degree, i.e. the actual coupling cost of
 *     leaving them at the root.
 *
 * Read-only: writes nothing unless --json is passed, which prints the graph.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const STATIC_REQUIRE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const DYNAMIC_REQUIRE_RE = /require\(\s*(?!['"])/g;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'templates' || entry.name === 'node_modules') continue;
      walk(full, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function resolveSpecifier(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

function domainOf(absPath) {
  const rel = path.relative(SRC, absPath).split(path.sep);
  if (rel.length === 1) return '(root)';
  return rel[0];
}

function buildGraph() {
  const files = walk(SRC);
  const edges = [];
  const dynamic = [];
  const unresolved = [];
  const inDegree = new Map();
  const outDegree = new Map();

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (_) {
      continue;
    }
    STATIC_REQUIRE_RE.lastIndex = 0;
    let match;
    while ((match = STATIC_REQUIRE_RE.exec(source)) !== null) {
      const target = resolveSpecifier(file, match[1]);
      if (!target || !target.startsWith(SRC)) {
        if (!target) unresolved.push({ from: file, specifier: match[1] });
        continue;
      }
      edges.push({ from: file, to: target });
      inDegree.set(target, (inDegree.get(target) || 0) + 1);
      outDegree.set(file, (outDegree.get(file) || 0) + 1);
    }
    const dynamicCount = (source.match(DYNAMIC_REQUIRE_RE) || []).length;
    if (dynamicCount > 0) dynamic.push({ file, count: dynamicCount });
  }

  return { files, edges, dynamic, unresolved, inDegree, outDegree };
}

// Tarjan's strongly connected components: every SCC with more than one node is a cycle.
function findCycles(files, edges) {
  const adjacency = new Map(files.map(file => [file, []]));
  for (const edge of edges) {
    if (adjacency.has(edge.from)) adjacency.get(edge.from).push(edge.to);
  }
  let index = 0;
  const indices = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];

  function strongConnect(node) {
    indices.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) || []) {
      if (!indices.has(next)) {
        strongConnect(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), indices.get(next)));
      }
    }

    if (low.get(node) === indices.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) components.push(component);
    }
  }

  for (const file of files) {
    if (!indices.has(file)) strongConnect(file);
  }
  return components;
}

function rel(file) {
  return path.relative(ROOT, file);
}

function main() {
  const graph = buildGraph();
  const cycles = findCycles(graph.files, graph.edges);

  const domainEdges = new Map();
  for (const edge of graph.edges) {
    const from = domainOf(edge.from);
    const to = domainOf(edge.to);
    if (from === to) continue;
    const key = `${from} -> ${to}`;
    domainEdges.set(key, (domainEdges.get(key) || 0) + 1);
  }

  const rootFiles = graph.files.filter(file => domainOf(file) === '(root)');
  const rootByInDegree = rootFiles
    .map(file => ({ file: rel(file), inDegree: graph.inDegree.get(file) || 0 }))
    .sort((a, b) => b.inDegree - a.inDegree);

  const topHubs = [...graph.inDegree.entries()]
    .map(([file, count]) => ({ file: rel(file), inDegree: count }))
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 25);

  const report = {
    generatedAt: new Date().toISOString(),
    inventory: {
      runtimeJsFiles: graph.files.length,
      rootLevelJs: rootFiles.length,
      resolvedEdges: graph.edges.length,
      unresolvedRelativeRequires: graph.unresolved.length,
      filesWithDynamicRequire: graph.dynamic.length
    },
    domains: [...new Set(graph.files.map(domainOf))].sort().map(domain => ({
      domain,
      files: graph.files.filter(file => domainOf(file) === domain).length
    })),
    domainEdges: [...domainEdges.entries()].map(([key, count]) => ({ edge: key, count })).sort((a, b) => b.count - a.count),
    cycles: cycles.map(component => component.map(rel).sort()),
    topHubs,
    rootByInDegree,
    dynamicRequires: graph.dynamic.map(item => ({ file: rel(item.file), count: item.count })).sort((a, b) => b.count - a.count),
    unresolved: graph.unresolved.map(item => ({ from: rel(item.from), specifier: item.specifier }))
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`src boundary audit — ${report.inventory.runtimeJsFiles} runtime JS files\n`);
  console.log('Inventory:', JSON.stringify(report.inventory, null, 1));
  console.log('\nDomains:', report.domains.map(d => `${d.domain}=${d.files}`).join(' '));
  console.log('\nCross-domain edges (top 15):');
  for (const edge of report.domainEdges.slice(0, 15)) console.log(`  ${edge.count.toString().padStart(4)}  ${edge.edge}`);
  console.log(`\nCycles: ${report.cycles.length}`);
  for (const cycle of report.cycles.slice(0, 10)) console.log(`  ${cycle.join(' <-> ')}`);
  console.log('\nTop in-degree hubs:');
  for (const hub of report.topHubs.slice(0, 15)) console.log(`  ${hub.inDegree.toString().padStart(4)}  ${hub.file}`);
  console.log(`\nFiles with dynamic require: ${report.dynamicRequires.length}`);
  for (const item of report.dynamicRequires.slice(0, 10)) console.log(`  ${item.count.toString().padStart(3)}  ${item.file}`);
}

main();
