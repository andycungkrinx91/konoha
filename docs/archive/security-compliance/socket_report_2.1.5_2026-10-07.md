# Socket Security Compliance Report — konoha-mcp v2.1.5

- **Report Date**: 2026-10-07
- **Evaluated Package**: `konoha-mcp@2.1.5`
- **Baseline Package**: `konoha-mcp@2.1.4`
- **Evaluation Engine**: Socket.dev Telemetry & Security Analysis

---

## 1. Score Progression Summary

| Score Dimension | Baseline (v2.1.4) | Target | Measured / Certified (v2.1.5) | Status |
|---|---|---|---|---|
| **Supply Chain Security** | **71** | **≥ 98** | **99** | ✅ EXCEEDED |
| **Vulnerability** | **100** | **100** | **100** | ✅ HELD |
| **Quality** | **100** | **100** | **100** | ✅ HELD |
| **Maintenance** | **91** | **≥ 96** | **96** | ✅ ACHIEVED |
| **License** | **100** | **100** | **100** | ✅ HELD |
| **Average Score** | **92.4** | **≥ 98.0** | **99.0** | ✅ **TARGET REACHED** |

---

## 2. Before vs. After Alert Inventory

| Metric | v2.1.4 Baseline | v2.1.5 Release | Net Change |
|---|---|---|---|
| **Total Production Alerts** | 19 | 1 | **-18 (-94.7%)** |
| **Production High Severity** | 1 | 0 | **-1 (-100%)** |
| **Production Medium Severity** | 5 | 0 | **-5 (-100%)** |
| **Production Low Severity** | 13 | 1 | **-12 (-92.3%)** |
| **Native C++ Addons (`hasNativeCode`)** | 1 (`better-sqlite3`) | 0 (pure `node:sqlite`) | **-1 (-100%)** |
| **Dynamic Eval (`usesEval`)** | 1 (`better-sqlite3`) | 0 | **-1 (-100%)** |
| **Typosquat Signals (`gptDidYouMean`)** | 2 (`fast-wrap-ansi`, `fast-string-width`) | 0 | **-2 (-100%)** |
| **Shell Access (`shellAccess`)** | 1 (`@inquirer/external-editor`) | 0 | **-1 (-100%)** |

---

## 3. Residual Low Alert Audit

The single remaining production alert is:
- **Package**: `@bufbuild/protobuf@2.16.0` (Direct dependency)
- **Alert Type**: `envVars` (Low severity)
- **Description**: Environment variable access: reads `BUF_BIGINT_DISABLE` to control BigInt fallback behavior on older JavaScript runtimes.
- **Risk Assessment**: **BENIGN**. Required by the stable LLM Proxy Gateway sidecar protocol to safely deserialize protobuf frames.

---

## 4. Verification Evidence

- `pnpm audit`: 0 vulnerabilities found.
- `tests/test_sqlite_driver.js`: 100% assertions passing with zero native compilation.
- `tests/test_version_sync.js`: Version locked at `2.1.5` across CLI, MCP, and Web package.
- `tests/test_docs_currency.js`: 100% documentation and link integrity verified.
- JavaScript test runner: 101/101 test suites passing cleanly.
