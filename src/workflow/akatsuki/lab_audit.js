/**
 * Red-skill audit writer.
 *
 * Appends authorization decisions to `red_skill_audit` in the Akatsuki Lab DB.
 * Auditing is subordinate to the decision: it never throws, never changes a
 * result, and never creates the lab store.
 */

'use strict';

/**
 * Append a red-skill decision to the lab audit trail.
 *
 * A caller-supplied connection is used as-is. Otherwise the lab store is opened
 * in existing-file-only mode, which cannot create it: with no provisioned lab
 * there is simply no row.
 *
 * @param {{skillName?: string, agentName?: string|null, decision: 'allowed'|'denied',
 *          code?: string|null, reason?: string|null, surface?: string, runId?: number|null}} event
 * @param {{labConn?: object}} [options]
 * @returns {boolean} true when a row was written
 */
function auditRedSkill(event, options) {
  let labDb = null;
  let conn = null;
  let opened = false;
  try {
    labDb = require('./lab_db');
    conn = options && options.labConn;
    if (!conn) {
      conn = labDb.openLabAuditConnection();
      opened = conn !== null;
    }
    if (!conn) return false;
    return labDb.recordRedSkillAudit(event, conn);
  } catch (_) {
    return false;
  } finally {
    if (opened) {
      try { labDb.closeLabDb(conn); } catch (_) { /* best-effort close */ }
    }
  }
}

module.exports = { auditRedSkill };
