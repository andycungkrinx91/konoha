'use strict';

/**
 * src/mcp/gate_status.js — Single source of truth for user-facing HITL gate statuses.
 *
 * Raw engine statuses stay in DB/MCP payloads; every surface (CLI, TUI, Web UI,
 * Telegram 2-way) renders through toDisplayStatus so Pending Gate 1/2, Processing,
 * Remediate, Approved, Completed read identically everywhere.
 */

const DISPLAY = {
  PENDING_GATE_1: 'Pending Gate 1',
  PENDING_GATE_2: 'Pending Gate 2',
  PROCESSING: 'Processing',
  REMEDIATE: 'Remediate',
  APPROVED: 'Approved',
  COMPLETED: 'Completed'
};

const RAW_TO_DISPLAY = new Map([
  ['pending_plan_approval', DISPLAY.PENDING_GATE_1],
  ['plan_approval', DISPLAY.PENDING_GATE_1],
  ['gate_1', DISPLAY.PENDING_GATE_1],
  ['pending_human_signoff', DISPLAY.PENDING_GATE_2],
  ['delivery_signoff', DISPLAY.PENDING_GATE_2],
  ['gate_2', DISPLAY.PENDING_GATE_2],
  ['pending', DISPLAY.PROCESSING],
  ['processing', DISPLAY.PROCESSING],
  ['in_progress', DISPLAY.PROCESSING],
  ['running', DISPLAY.PROCESSING],
  ['execute', DISPLAY.PROCESSING],
  ['remediation', DISPLAY.REMEDIATE],
  ['remediate', DISPLAY.REMEDIATE],
  ['remediating', DISPLAY.REMEDIATE],
  ['blocked', DISPLAY.REMEDIATE],
  ['plan_approved', DISPLAY.APPROVED],
  ['approved', DISPLAY.APPROVED],
  ['gate1_approved', DISPLAY.APPROVED],
  ['completed', DISPLAY.COMPLETED],
  ['done', DISPLAY.COMPLETED],
  ['delivered', DISPLAY.COMPLETED]
]);

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function toDisplayStatus(status) {
  const key = normalizeStatus(status);
  if (RAW_TO_DISPLAY.has(key)) return RAW_TO_DISPLAY.get(key);
  if (!key) return DISPLAY.PROCESSING;
  return String(status).trim().toUpperCase().replace(/[_-]+/g, ' ');
}

module.exports = {
  DISPLAY,
  RAW_TO_DISPLAY,
  normalizeStatus,
  toDisplayStatus
};
