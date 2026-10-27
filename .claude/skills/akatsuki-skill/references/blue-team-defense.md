# Blue-Team Defensive Security Workflow

The Blue-Team Defender workflow is a comprehensive, non-invasive security audit executed by Akatsuki.

## Operational Lifecycle

1. **Scope & Asset Identification**:
   - Discover modified and sensitive code paths (controllers, auth handlers, database queries, parsers).
   - Enumerate external dependencies (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`).

2. **Defensive Inspections**:
   - **Secret Scanning**: Check for exposed credentials, API keys, tokens, `.env` files.
   - **Static Analysis & Sanitization**: Verify parameterized queries, HTML encoding, boundary validation.
   - **Skill Guardian Perimeter**: Evaluate all local skills and scripts against `src/workflow/kage-reviewer/skill_guardian.js`.
   - **Supply Chain / CVE Audit**: Run package dependency audit to ensure 0 High / 0 Critical CVEs.

3. **Classification & Evidence**:
   - Classify findings into Critical, High, Medium, Low with reproducible evidence.
   - Provide concrete remediation patches for identified defects.

4. **Structured Report**:
   - Output structured findings report including residual risk and gate decision.
