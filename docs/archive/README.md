# Docs Archive

Frozen dated snapshots: external compliance audits, one-off security reviews, and completed review notes. Nothing in this directory is authoritative, and nothing here is maintained. No live document under `docs/` treats an archived file as current; the only inbound link is this page, from the live index at [docs/README.md](../README.md).

Treat every file below as a record of what a specific version looked like on a specific date. When a fact here conflicts with a live document, the live document wins.

## Contents

| Directory | Files | Why archived |
|---|---|---|
| `security-compliance/` | 69 | Dated compliance, Socket, and QA audit output; superseded by the current compliance record |
| `security/` | 2 | Completed one-off audits of the skill set and of the architecture |
| `reviews/` | 1 | Completed review whose recommendations already shipped |

## Reading the compliance series

The 60 `security_compliance_report_*` files track the compliance posture release by release. Read them oldest to newest inside a series; each report states its own scope and pass/fail result, and later reports in the same series supersede earlier ones.

| Series | Reports | Distinct versions | Date range |
|---|---|---|---|
| pre-2.0.0 (`2.0.0-beta*`) | 21 | 7 | 2026-09-01 to 2026-09-20 |
| 2.0.x | 7 | 3 | 2026-08-14 to 2026-10-02 |
| 2.1.x | 19 | 19 | 2026-10-06 to 2026-10-15 |
| 2.2.x | 13 | 13 | 2026-10-18 to 2026-11-04 |

The live current record is [security_compliance_report_2.2.19_2026-11-09.md](../SecurityCompliance/security_compliance_report_2.2.19_2026-11-09.md). It is the newest external audit and the one `README.md` and `docs/SECURITY.md` cite. The 2.2.18 report is archived because 2.2.19 replaced it; the 2.2.20 release shipped dependency and install fixes, not a new external audit, so the v2.2.20 controls are documented in [docs/SECURITY.md](../SECURITY.md) rather than in a report of their own.

## Socket, QA, and standalone audits

- `socket_baseline_2026-10-07.md`, `socket_burndown_2.1.5_2026-10-07.md`, `socket_report_2.1.5_2026-10-07.md`, `socket_report_2.2.18_2026-11-08.md`, `socket_report_2.2.19_2026-11-08.md`: Socket dependency and supply-chain scans, one dated run each; the numbers describe the dependency tree of that day, not today.
- `qa_report_2.1.5_2026-10-07.md`: QA pass for 2.1.5, kept for the failure list that later releases reference.
- `SECURITY_AUDIT_REPORT_2026-11-06.md`, `SECURITY_AUDIT_REPORT_2026-11-08.md`: standalone audits from the 2.2.19 hardening window; the resulting controls are described in [docs/security/](../security/) and `docs/SECURITY.md`.

## Legacy index

`security-compliance/ARCHIVE.md` is the pre-2.2.0 archive index. It stops at 2.2.18, indexes only the pre-2.0.0 and 2.1.x series, and its `./` links still resolve because it sits beside the files it names. It is retained as history and is not maintained; this page is the maintained index for everything under `docs/archive/`.

## Keep or archive

Two rules decide placement:

- Standing invariants and control records stay live in `docs/`. If a reader needs the answer today, it belongs in the live tree and is listed in [docs/README.md](../README.md).
- Dated snapshots of one moment get archived. A compliance report, a Socket scan, a QA pass, or a completed review describes a version that is no longer current; keeping it live would mean two answers to the same question.

A file moves here when a newer record supersedes it or when the work it describes is finished. The live record is updated in the same change, so a live document never has to point at an archived file.

## Files

### `security-compliance/`

Compliance reports, by series:

**pre-2.0.0** (21)

- `security_compliance_report_google_policy_2.0.0-beta_2026-09-01.md`
- `security_compliance_report_google_policy_2.0.0-beta_2026-09-02.md`
- `security_compliance_report_google_policy_2.0.0-beta_2026-09-03.md`
- `security_compliance_report_google_policy_2.0.0-beta.2_2026-09-03.md`
- `security_compliance_report_google_policy_2.0.0-beta.3_2026-09-04.md`
- `security_compliance_report_google_policy_2.0.0-beta.4_2026-09-06.md`
- `security_compliance_report_google_policy_2.0.0-beta.5_2026-09-07.md`
- `security_compliance_report_google_policy_2.0.0-beta.6_2026-09-07.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-08.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-09.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-10.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-11.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-12.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-13.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-13b.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-13c.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-13d.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-14.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-18.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-19.md`
- `security_compliance_report_google_policy_2.0.0-beta.7_2026-09-20.md`

**2.0.x** (7)

- `security_compliance_report_google_policy_2.0.0_2026-08-14.md`
- `security_compliance_report_google_policy_2.0.0_2026-08-26.md`
- `security_compliance_report_google_policy_2.0.0_2026-08-27.md`
- `security_compliance_report_google_policy_2.0.0_2026-08-29.md`
- `security_compliance_report_google_policy_2.0.0_2026-09-20.md`
- `security_compliance_report_google_policy_2.0.1_2026-09-25.md`
- `security_compliance_report_google_policy_2.0.2_2026-10-02.md`

**2.1.x** (19)

- `security_compliance_report_google_policy_2.1.0_2026-10-06.md`
- `security_compliance_report_google_policy_2.1.1_2026-10-06.md`
- `security_compliance_report_google_policy_2.1.10_2026-10-07.md`
- `security_compliance_report_google_policy_2.1.11_2026-10-07.md`
- `security_compliance_report_google_policy_2.1.12_2026-10-07.md`
- `security_compliance_report_google_policy_2.1.13_2026-10-07.md`
- `security_compliance_report_google_policy_2.1.14_2026-10-08.md`
- `security_compliance_report_google_policy_2.1.15_2026-10-08.md`
- `security_compliance_report_google_policy_2.1.16_2026-10-08.md`
- `security_compliance_report_google_policy_2.1.17_2026-10-08.md`
- `security_compliance_report_google_policy_2.1.18_2026-10-15.md`
- `security_compliance_report_google_policy_2.1.2_2026-10-06.md`
- `security_compliance_report_google_policy_2.1.3_2026-10-06.md`
- `security_compliance_report_google_policy_2.1.4_2026-10-06.md`
- `security_compliance_report_google_policy_2.1.5_2026-10-07.md`
- `security_compliance_report_google_policy_2.1.6_2026-10-07.md`
- `security_compliance_report_google_policy_2.1.7_2026-10-07.md`
- `security_compliance_report_google_policy_2.1.8_2026-10-07.md`
- `security_compliance_report_google_policy_2.1.9_2026-10-07.md`

**2.2.x** (13)

- `security_compliance_report_google_policy_2.2.0_2026-10-18.md`
- `security_compliance_report_google_policy_2.2.1_2026-10-19.md`
- `security_compliance_report_google_policy_2.2.10_2026-10-27.md`
- `security_compliance_report_google_policy_2.2.11_2026-10-28.md`
- `security_compliance_report_google_policy_2.2.12_2026-10-29.md`
- `security_compliance_report_google_policy_2.2.13_2026-10-29.md`
- `security_compliance_report_google_policy_2.2.14_2026-10-30.md`
- `security_compliance_report_google_policy_2.2.15_2026-10-30.md`
- `security_compliance_report_google_policy_2.2.16_2026-11-01.md`
- `security_compliance_report_google_policy_2.2.17_2026-11-01.md`
- `security_compliance_report_google_policy_2.2.18_2026-11-04.md`
- `security_compliance_report_google_policy_2.2.2_2026-10-19.md`
- `security_compliance_report_google_policy_2.2.3_2026-10-19.md`

Socket scans:

- `socket_baseline_2026-10-07.md`
- `socket_burndown_2.1.5_2026-10-07.md`
- `socket_report_2.1.5_2026-10-07.md`
- `socket_report_2.2.18_2026-11-08.md`
- `socket_report_2.2.19_2026-11-08.md`

QA and standalone audits:

- `qa_report_2.1.5_2026-10-07.md`
- `SECURITY_AUDIT_REPORT_2026-11-06.md`
- `SECURITY_AUDIT_REPORT_2026-11-08.md`

Legacy index:

- `ARCHIVE.md`

### `security/`

- `ARCHITECTURE-SECURITY-AUDIT.md`: v2.0.2 architecture audit; its threat-vector table is superseded by the v2.2.20 controls in [docs/SECURITY.md](../SECURITY.md).
- `SKILLS_SECURITY_AUDIT_REPORT.md`: skill-set audit from before the red pack left the repository; the scope-change note explains why its inventory no longer matches the shipped tree.

### `reviews/`

- `SUGGESTION.md`: v2.2.3 review of tools, docs, CLI, and assets; the recommendations that were accepted shipped in later releases, so the file is a record rather than a backlog.
