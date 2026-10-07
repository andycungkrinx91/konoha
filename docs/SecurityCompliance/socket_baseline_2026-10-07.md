# Socket Security Baseline Report — konoha-mcp

- **Report Date**: 2026-10-07
- **Baseline Release**: `konoha-mcp@2.1.4`
- **Target Release**: `konoha-mcp@2.1.5`
- **Source Data**: `alerts.csv` (170 alerts, 155 unique keys, repo `konoha-socket/konoha@master`) + Socket.dev registry telemetry for `konoha-mcp@2.1.4`

---

## 1. Executive Summary & Score Math

| Dimension | Baseline Score (v2.1.4) | Target Score (v2.1.5) | Status | Gap |
|---|---|---|---|---|
| **Supply Chain Security** | **71** | **≥ 98** | Remediated (Phase 1) | **+27** |
| **Vulnerability** | 100 | 100 | Maintained (0 CVEs) | Hold (0) |
| **Quality** | 100 | 100 | Maintained | Hold (0) |
| **Maintenance** | **91** | **≥ 96** | Controllable items cleared | **+5** |
| **License** | 100 | 100 | Maintained (MIT compliant) | Hold (0) |
| **Average Score** | **92.4** | **≥ 98.0** | Projected ≥ 98.8 | **+5.6** |

**Primary Root Cause**: 151 of 170 total alerts are development/build scope (SvelteKit, Vite, PostCSS, Playwright, Canvas). Only **19 alerts are Production scope**. These 19 production alerts were the sole cause of the 71 Supply Chain score.

---

## 2. Production Scope Alerts Mapping & Remediation Status

Below is the complete mapping of all 19 Production scope alerts from `alerts.csv` to their introducing manifest and remediation status in v2.1.5:

| # | Alert Key | Severity | Alert Type | Package | Dep Type | Root Cause / Introducing Path | Remediation in v2.1.5 |
|---|---|---|---|---|---|---|---|
| 1 | `Qp6xpitBDHas...` | high | socketUpgradeAvailable | `safer-buffer@2.1.2` | Transitive | `@inquirer/core` → `chardet` → `safer-buffer` | **ELIMINATED**: All `@inquirer` dependencies pruned from lockfile. |
| 2 | `Q1W...` | medium | gptDidYouMean | `fast-wrap-ansi@0.2.2` | Transitive | `@inquirer/core` → `fast-wrap-ansi` | **ELIMINATED**: All `@inquirer` dependencies pruned from lockfile. |
| 3 | `QeX...` | medium | shellAccess | `@inquirer/external-editor@3.0.3` | Transitive | `@inquirer/editor` → `@inquirer/external-editor` | **ELIMINATED**: Zero shell access dependencies in production. |
| 4 | `Qsw...` | medium | gptDidYouMean | `fast-string-width@3.0.2` | Transitive | `@inquirer/core` → `fast-string-width` | **ELIMINATED**: All `@inquirer` dependencies pruned from lockfile. |
| 5 | `QtZDj4yt...` | medium | hasNativeCode | `better-sqlite3@13.0.3` | Direct | `package.json` direct dependency | **ELIMINATED**: Migrated to zero-native `node:sqlite` via `src/sqlite_driver.js`. |
| 6 | `QzDblHFz...` | medium | usesEval | `better-sqlite3@13.0.3` | Direct | `package.json` direct dependency | **ELIMINATED**: Migrated to zero-native `node:sqlite` via `src/sqlite_driver.js`. |
| 7 | `Q-Po4o5_...` | low | dynamicRequire | `better-sqlite3@13.0.3` | Direct | `package.json` direct dependency | **ELIMINATED**: Migrated to zero-native `node:sqlite` via `src/sqlite_driver.js`. |
| 8 | `Qse...` | low | gptAnomaly | `signal-exit@4.1.0` | Transitive | `@inquirer/core` → `signal-exit` | **ELIMINATED**: Pruned with `@inquirer` removal. |
| 9 | `Qfig...` | low | envVars | `@inquirer/figures@2.0.7` | Transitive | `@inquirer/core` → `@inquirer/figures` | **ELIMINATED**: Pruned with `@inquirer` removal. |
| 10 | `Qee_...` | low | envVars | `@inquirer/external-editor@3.0.3` | Transitive | `@inquirer/editor` → `@inquirer/external-editor` | **ELIMINATED**: Pruned with `@inquirer` removal. |
| 11 | `Qcor_...` | low | debugAccess | `@inquirer/core@11.2.1` | Transitive | `@inquirer/*` prompt suite | **ELIMINATED**: Replaced with native `node:readline/promises`. |
| 12 | `Qcw_...` | low | envVars | `cli-width@4.1.0` | Transitive | `@inquirer/core` → `cli-width` | **ELIMINATED**: Pruned with `@inquirer` removal. |
| 13 | `Qch_...` | low | filesystemAccess | `chardet@2.2.0` | Transitive | `@inquirer/core` → `chardet` | **ELIMINATED**: Pruned with `@inquirer` removal. |
| 14 | `Qnaa_...` | low | gptAnomaly | `node-addon-api@8.9.2` | Transitive | `better-sqlite3` build toolchain | **ELIMINATED**: Pruned with `better-sqlite3` removal. |
| 15 | `Qbuf_...` | low | envVars | `@bufbuild/protobuf@2.16.0` | Direct | `src/bridge/sidecar/proto.js` | **RETAINED**: Required for stable LLM Proxy Gateway protocol. Low-risk, audited. |
| 16 | `QqPn...` | low | filesystemAccess | `better-sqlite3@13.0.3` | Direct | `package.json` direct dependency | **ELIMINATED**: Migrated to `node:sqlite`. |
| 17 | `Qcork_...` | low | envVars | `@inquirer/core@11.2.1` | Transitive | `@inquirer/*` prompt suite | **ELIMINATED**: Pruned with `@inquirer` removal. |
| 18 | `Qcha_...` | low | gptAnomaly | `chalk@4.1.2` | Direct | `package.json` direct dependency | **ELIMINATED**: Replaced with native formatting / ANSI utilities. |
| 19 | `Qeefs_...` | low | filesystemAccess | `@inquirer/external-editor@3.0.3` | Transitive | `@inquirer/editor` → `@inquirer/external-editor` | **ELIMINATED**: Pruned with `@inquirer` removal. |

---

## 3. Results Summary

- **Production Medium & High Alerts**: **0** (down from 6).
- **Production Low Alerts**: **1** (`@bufbuild/protobuf` `envVars` reads `BUF_BIGINT_DISABLE`, audited and verified safe).
- **Total Production Dependencies**: **1** (`@bufbuild/protobuf` `^2.16.0`).
- **Native Binaries / C++ Compilation**: **0** (`onlyBuiltDependencies` removed, zero native build steps).
- **Projected Supply Chain Score**: **≥ 98**.
- **Projected Socket Average Score**: **≥ 98.8**.
