/**
 * Akatsuki security-gate evaluation.
 *
 * Split out of workflows.js to keep that module under the 700-line lint ceiling.
 */

function resolveRedTeamFailReason(rev) {
  if (rev.tools_blocked && rev.tools_blocked.length > 0) {
    return `Security gate blocked: Red-team review lacks required sandbox isolation evidence (requested blocked tools: ${rev.tools_blocked.map(t => t.tool).join(', ')}).`;
  }
  if (rev.stop_conditions && rev.stop_conditions.length > 0) {
    return `Security gate blocked: Red-team review lacks required sandbox isolation evidence (stopped due to safety condition: ${rev.stop_conditions.join('; ')}).`;
  }
  if (rev.cleanup_confirmed !== true) {
    return 'Security gate blocked: Red-team review lacks required sandbox isolation evidence (cleanup could not be confirmed).';
  }
  return 'Security gate blocked: Red-team review lacks required sandbox isolation evidence (akatsuki-lab on LXC/Docker with network isolation).';
}

/**
 * Evaluate a recorded akatsuki_review payload into a gate decision.
 *
 * @param {Object} rev
 * @param {string} defaultLabName
 * @returns {Object}
 */
function evaluateAkatsukiReview(rev, defaultLabName) {
  const critical = rev.critical_count || (rev.findings || []).filter(f => f.severity === 'critical').length;
  const high = rev.high_count || (rev.findings || []).filter(f => f.severity === 'high').length;

  const isRedTeam = rev.workflow_type === 'red_team';
  const labValid = !isRedTeam || (
    rev.lab_name === defaultLabName &&
    rev.network_isolated === true &&
    rev.host_execution_denied === true &&
    rev.cleanup_confirmed === true &&
    (!rev.tools_blocked || rev.tools_blocked.length === 0) &&
    (!rev.stop_conditions || rev.stop_conditions.length === 0) &&
    rev.status === 'completed'
  );

  const passed = rev.gate_decision === 'passed' && critical === 0 && high === 0 && labValid;

  let failReason = 'Akatsuki security review verified clean with required sandbox isolation evidence.';
  if (isRedTeam && !labValid) {
    failReason = resolveRedTeamFailReason(rev);
  } else if (!passed) {
    failReason = `Security gate blocked: ${critical} critical, ${high} high findings.`;
  }

  return {
    gate: 'akatsuki_security',
    decision: passed ? 'passed' : 'blocked',
    passed,
    critical_count: critical,
    high_count: high,
    findings: rev.findings || [],
    reason: failReason
  };
}

module.exports = {
  resolveRedTeamFailReason,
  evaluateAkatsukiReview
};
