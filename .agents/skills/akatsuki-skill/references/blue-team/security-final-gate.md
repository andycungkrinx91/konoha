# Akatsuki Security Final Gate Reference

The Akatsuki Security Final Gate (`runAkatsukiFinalGate`) is the mandatory pre-delivery security validation executed immediately before the Kage pre-delivery architecture and code review gate.

## Source
- Primary: `https://www.skills.sh/agentsecops/secopsagentkit/vuln-defectdojo`
- Reference: `src/workflow/akatsuki/workflows.js` (`runAkatsukiFinalGate`)
- Workflow: `src/workflow/akatsuki/blue_workflows.js` (Phase 7)

## When to Use
- Pre-Kage Review Gate: mandatory execution on every task before Kage signs off on deliverable completion.
- Multi-Agent Delivery Verification: verify that Anbu, Jonin, or other implementing agents introduced zero security vulnerabilities.
- Teardown & Containment Audit: ensure sandbox containers (`akatsuki-lab`) are torn down and temporary attack artifacts removed.

## Gate Criteria & Evaluation Logic
1. Blue-Team Pre-Requisite:
   - Must execute SAST, secret leakage, and dependency CVE checks.
   - All high and critical security findings must be remediated or explicitly waived.
2. Red-Team Pre-Requisite (when red mode active):
   - All executions must have occurred inside isolated `akatsuki-lab` (non-host bridge).
   - Teardown cleanup must be verified (`cleanup_confirmed: true`).
3. Delivery Block on Failure:
   - If security findings exist or sandbox containment proof is missing, `security_approved` is set to `false`.
   - Synthesis and commit phases are mechanically blocked.

## Audit Workflow
```bash
# 1. Run Akatsuki security centralization and final gate test suite
node tests/test_akatsuki_security_centralization.js

# 2. Verify final gate integration into workflow runner
node tests/test_workflow_gates.js
```

## Fail-Closed Notes
- The final delivery review cannot be approved without a passing Akatsuki Security Final Gate record (`security_approved: true`).
