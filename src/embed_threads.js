'use strict';

/**
 * src/embed_threads.js — ONNX intra-op thread count for the bundled models.
 *
 * ONNX Runtime defaults to one intra-op thread per logical CPU, which pins every
 * core and freezes the desktop during `konoha init`. Throughput peaks at the
 * physical core count: over 600 real chunks on a 16-thread/8-core Ryzen 9
 * 5900HX, 4 threads embedded at 204 chunks/s, 8 at 243, 12 at 227 and 16 at 202,
 * and the reranker improves on the same setting (156 ms to 138 ms for 20
 * documents). Halving the logical count would get that right on SMT parts but
 * wrong on the non-SMT 4-vCPU VMs CI runs on, where 2 threads cost about 28%,
 * so read the real ratio where the OS exposes it.
 *
 * Pure and model-free so the rule is testable without an ONNX session.
 */

const fs = require('node:fs');
const os = require('node:os');

const THREAD_CEILING = 8;

function logicalCpuCount() {
  return os.availableParallelism ? os.availableParallelism() : (os.cpus() || []).length;
}

/**
 * Reads the SMT ratio from procfs. Returns `{ siblings, cores }` per socket, or
 * null where the file is absent or does not report both fields.
 * @returns {{siblings: number, cores: number}|null}
 */
function readSmtTopology() {
  if (process.platform !== 'linux') return null;
  try {
    const info = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const siblings = Number((info.match(/^siblings\s*:\s*(\d+)/m) || [])[1]) || 0;
    const cores = Number((info.match(/^cpu cores\s*:\s*(\d+)/m) || [])[1]) || 0;
    return siblings > 0 && cores > 0 ? { siblings, cores } : null;
  } catch (_) {
    return null;
  }
}

/**
 * One thread per physical core, capped so a huge host cannot be oversubscribed.
 * macOS and Windows have no cheap topology query, so they get the ceiling
 * instead — that is the measured optimum on 16 logical CPUs.
 * ponytail: `wmic`/`sysctl` would let those platforms use the same ratio; add
 * that when a non-Linux host actually shows a throughput complaint.
 * @returns {number}
 */
function embedThreadCount() {
  return threadCountFor(logicalCpuCount(), readSmtTopology());
}

/**
 * The rule, separated from the platform probes so the non-SMT case is testable
 * without a fake procfs. A host that reports one thread per core gets every
 * logical CPU, which is what a 4-vCPU cloud instance needs.
 * @param {number} logical
 * @param {{siblings: number, cores: number}|null} topology
 * @returns {number}
 */
function threadCountFor(logical, topology) {
  const cpus = Math.max(1, Number(logical) || 1);
  if (topology && topology.siblings > 0 && topology.cores > 0) {
    return Math.max(1, Math.round((cpus * topology.cores) / topology.siblings));
  }
  return Math.max(1, Math.min(THREAD_CEILING, cpus));
}

module.exports = {
  embedThreadCount,
  threadCountFor,
  logicalCpuCount,
  readSmtTopology,
  THREAD_CEILING,
};
