# 🍃 Konoha QA Testing & Verification SOPs (v2.2.18)

Operational runbook and testing matrix for verifying Konoha core engines, LangGraph state transitions, Draw.io diagrams, visual WebP assets, and Web UI.

---

## 🧪 Comprehensive QA Verification Matrix

| Verification Target | Command | Expected Pass Criteria |
|---|---|---|
| **Version Consistency** | `rtk node tests/test_version_consistency.js` | 19/19 managed repository targets strictly verified at v2.2.18. |
| **Documentation Currency** | `rtk node tests/test_docs_currency.js` | Zero drift between exported code symbols and markdown documents. |
| **Draw.io Diagram Collisions** | `rtk node tests/test_diagram_sync.js` | 18 drawio pages in `konoha-architecture.drawio` and 19 in `konoha-enterprise-architecture.drawio` verified with strictly **0 geometric collisions** (0 penetrations, 0 crossings, 0 overlaps). |
| **Animated WebP Assets** | `rtk node tests/test_all_assets_webp.js` | All 33 WebPs valid, 0 legacy `.gif` files, 27 markdown files with 0 broken embeds. |
| **LangGraph Engine (v2.2.18)** | `rtk node tests/test_langgraph_v2217.js` | 6/6 tests passed: per-turn budget normalization, error edge circuit breaker, document phase, auto-signoff, pentest routing, production `sannin` dispatch. |
| **Core Workflow Regressions** | `rtk node tests/test_workflow_gates.js`<br/>`rtk node tests/test_circuit_breaker.js`<br/>`rtk node tests/test_manifest_invariants.js` | All workflow gate, breaker, and tool manifest invariant assertions pass cleanly. |
| **Backend Static Linter** | `rtk node scripts/lint.js` | 471 JavaScript files verified with **0 errors and 0 warnings**. |
| **Zero-AI-Slop Code Hygiene** | `rtk npx aislop scan --changes` | Score **100 / 100 Healthy**, 0 errors, 0 warnings, 0 fixable. |
| **Web UI SvelteKit Check** | `rtk node bin/cli.js ui build && rtk pnpm --dir apps/web run check` | Web build succeeded, 0 SvelteKit type/syntax errors. |
| **Web UI Playwright E2E** | `rtk pnpm --dir apps/web run test:e2e` | 54 browser integration tests pass cleanly with default password `konohagakure`. |
| **Master Test Suite** | `rtk node tests/run_all.js` | All 241 unit and integration suites pass to completion. |

---

## 📐 Draw.io Zero-Collision Rule & Sync SOP

When editing `docs/diagrams/konoha-architecture.drawio` or `docs/diagrams/konoha-enterprise-architecture.drawio`:
1. **Never alter existing `mxGeometry` coordinates** unless doing a dedicated layout refactor.
2. When updating architecture labels or version numbers (e.g. adding LangGraph, StateGraph, per-turn budget governor, circuit breaker), edit the `value="..."` attribute of existing cells in-place.
3. Every cell MUST have a globally unique `id="..."`.
4. Validate immediately with:
   ```bash
   rtk node tests/test_diagram_sync.js
   ```

---

## 🎞️ Animated WebP Asset Generation SOP

When workflow diagrams change, regenerate all 7 Tokubetsu-Jonin multi-card workflow diagrams and 13 Draw.io projections:
```bash
rtk node scripts/generate_tokubetsu_flow_webp.js
rtk node scripts/generate_drawio_flow_webp.js
```
- **Requirements**: Google Chrome (`/usr/bin/google-chrome`) installed, FFmpeg with `libwebp_anim` encoder.
- **Verification**: Validate dimensions and natural frame integrity via Playwright:
  ```bash
  rtk node tests/test_all_assets_webp.js
  ```

---

## 📏 Source File Line Cap Invariant

To maintain maintainability and eliminate bloated files, **all JavaScript files must stay strictly under 700 lines**:
- Check file lengths: `rtk wc -l src/**/*.js bin/**/*.js`
- If a module approaches 700 lines, extract cohesive functional helpers into modular sibling files (e.g. `node_guard.js`, `error.js`).
