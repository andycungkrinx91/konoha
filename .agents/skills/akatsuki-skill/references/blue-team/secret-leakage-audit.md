# Secret & Credential Leakage Audit Reference

The Secret Leakage Audit workflow scans files, git commits, configuration templates, and environment definitions to prevent accidental leakage of sensitive API keys, private certificates, and authentication tokens.

## Source
- Primary: `https://www.skills.sh/agentsecops/secopsagentkit/secrets-gitleaks`
- Reference: `src/workflow/akatsuki/blue_workflows.js` (Phase 3)

## When to Use
- Pre-Release Git Inspection: scan working tree and staged files for accidental `.env` inclusions.
- Config Template Sanitization: ensure configuration examples use placeholders rather than production credentials.
- Log & Output Masking: verify automated masking of keys, tokens, and authorization headers in terminal outputs.

## Konoha Secret Handling Invariants
1. Zero Plaintext Secrets: Sensitive secrets must be encrypted at rest via the AES-256-GCM Crypto Vault (`src/crypto_vault.js`).
2. Automatic Masking: Passwords, tokens, and session keys are sanitized to `12345***:***abcd` across all logs and CLI output.
3. Git Safety Guardrail: Git commands attempting to stage or inspect `.env*` files are intercepted and declined.

## Audit Workflow
```bash
# 1. Verify working directory is free of uncommitted secret files
git status --ignored

# 2. Verify git safety guardrail intercepts secret reads
node -e "const {checkCommandGuardrails} = require('./src/guardrails'); console.log(checkCommandGuardrails('cat .env'));"
```

## Fail-Closed Notes
- Unmasked credentials in repository source files constitute an immediate fail-closed gate block.
- Operators must revoke and rotate any leaked key immediately.
