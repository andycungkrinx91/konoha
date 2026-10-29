"use strict";

/**
 * bin/commands/mode.js — Canonical YOLO/HITL execution-mode switch.
 *
 * Display names: HITL (human gates authoritative) vs YOLO (gates still pause
 * authoritatively, fail closed; mode only records operator intent).
 * Storage stays hitl_mode enabled/disabled per project in sdlc.db.
 */

const path = require("path");
const { DB_PATH } = require("../lib/paths");
const { C, log, error, success, info } = require("../lib/format");
const sdlcManager = require("../../src/workflow/kage-reviewer/sdlc_manager");
const { toDisplayStatus } = require("../../src/mcp/gate_status");

function cmdModeHelp() {
  log(`
${C.cyan}konoha mode${C.reset} — Switch HITL gate mode vs YOLO intent per project workspace

${C.bold}USAGE${C.reset}
  konoha mode [hitl|safe|yolo|autonomous] [--project <path>] [--json]

${C.bold}MODES${C.reset}
  ${C.cyan}hitl${C.reset} (or safe)       🛡️ Human gates authoritative: Gate 1 plan approval + Gate 2 sign-off pause everywhere.
  ${C.cyan}yolo${C.reset} (or autonomous) ⚡ Operator intent recorded, but Gate 1/2 still pause authoritatively and fail closed.

${C.bold}EXAMPLES${C.reset}
  konoha mode
  konoha mode yolo
  konoha mode hitl --project .
  konoha mode yolo --json
`);
}

function resolveTargetPath(args) {
  const idx = args.findIndex((a) => a === "--project" || a === "-p");
  if (idx !== -1 && args[idx + 1]) return path.resolve(args[idx + 1]);
  const positional = args.find((a) => !a.startsWith("-") && !["hitl", "safe", "yolo", "autonomous"].includes(String(a).toLowerCase()));
  return path.resolve(positional || process.cwd());
}

function normalizeModeArg(raw) {
  if (!raw) return null;
  const v = String(raw).toLowerCase();
  if (v === "hitl" || v === "safe" || v === "enabled") return { hitl_mode: "enabled", display: "HITL" };
  if (v === "yolo" || v === "autonomous" || v === "disabled") return { hitl_mode: "disabled", display: "YOLO" };
  return { invalid: raw };
}

function describeMode(hitlMode) {
  return hitlMode === "disabled" ? "YOLO" : "HITL";
}

async function cmdMode(cmdArgs = []) {
  const args = Array.isArray(cmdArgs) ? [...cmdArgs] : [];
  if (args.includes("--help") || args.includes("-h")) {
    cmdModeHelp();
    return;
  }
  const jsonOut = args.includes("--json");
  const modeArg = args.find((a) => !a.startsWith("-") && ["hitl", "safe", "yolo", "autonomous", "enabled", "disabled"].includes(String(a).toLowerCase()));
  const targetPath = resolveTargetPath(args);

  const norm = normalizeModeArg(modeArg);
  if (norm && norm.invalid) {
    error(`Invalid mode "${norm.invalid}". Use "konoha mode hitl" or "konoha mode yolo".`);
    process.exitCode = 1;
    return;
  }

  try {
    let cfg;
    if (norm && norm.hitl_mode) {
      cfg = sdlcManager.setProjectSdlcConfig(targetPath, { hitl_mode: norm.hitl_mode }, DB_PATH);
    } else {
      cfg = sdlcManager.getProjectSdlcConfig(targetPath, DB_PATH);
    }
    const modeLabel = describeMode(cfg.hitl_mode);
    const payload = {
      project_path: targetPath,
      mode: modeLabel.toLowerCase() === "yolo" ? "yolo" : "hitl",
      hitl_mode: cfg.hitl_mode,
      display: modeLabel,
      gates: ["Pending Gate 1", "Pending Gate 2", "Processing", "Remediate", "Approved", "Completed"].map((s) => toDisplayStatus(s)),
      invariant: "Gate 1 and Gate 2 pause authoritatively and fail closed in every mode."
    };
    if (jsonOut) {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return payload;
    }
    if (norm && norm.hitl_mode) {
      success(`Execution mode set to "${modeLabel}" (${cfg.hitl_mode}) for ${targetPath}.`);
    } else {
      log(`  ${C.bold}Execution Mode:${C.reset}  ${C.cyan}${modeLabel}${C.reset} ${C.dim}(hitl_mode=${cfg.hitl_mode})${C.reset}`);
    }
    info("Gate 1 and Gate 2 stay authoritative in every mode: Approve/Reject required, fail closed.");
    return payload;
  } catch (e) {
    error(`Failed to switch mode: ${e.message}`);
    process.exitCode = 1;
    return null;
  }
}

module.exports = { cmdMode, cmdModeHelp, normalizeModeArg, describeMode };
