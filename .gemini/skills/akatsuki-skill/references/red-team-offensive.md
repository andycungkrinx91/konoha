# Red-Team Offensive Security Workflow

The Red-Team workflow executes authorized ethical security assessments to verify defenses against real-world adversarial techniques.

## Authorization & Safety Contract (Fail-Closed)

- **Explicit Written Authorization Required**:
  - The request context must explicitly state authorization (e.g. `authorized: true`, `permission: 'granted'`, or explicit authorization directive).
  - If authorization is missing or ambiguous, Akatsuki immediately halts and returns `status: "blocked"`.
- **Authorized Target Boundary**:
  - Restricted strictly to `localhost`, `127.0.0.1`, isolated dev containers, or explicitly designated local test environments.
  - External or production systems are strictly forbidden.
- **Zero Real Secret Exfiltration**:
  - Never view, store, or exfiltrate real credentials or personal data.
- **Zero Destructive Actions**:
  - Never delete user data (`DROP TABLE`, `rm -rf`), never wipe disks, never kill external services.
- **Clean Post-Assessment State**:
  - Delete all mock test accounts, temporary test scripts, and test payloads immediately after proving exploitability.
