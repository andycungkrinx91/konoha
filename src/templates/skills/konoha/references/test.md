# 🍃 Konoha QA Testing & Verification SOPs (v2.2.18)

Operational runbook and testing matrix for verifying Konoha `v2.2.18` core engines, compact `use_skills`, parallel subagent spawning, Real-Time Idle `@advisor`, HITL post-approval compaction, Jonin dynamic frontend builder, Draw.io diagrams, and animated WebP assets.

---

## 🧪 Comprehensive QA Verification Matrix (`v2.2.18`)

| Verification Target | Command | Expected Pass Criteria |
|---|---|---|
| **Version Consistency** | `rtk node tests/test_version_consistency.js` | 19/19 managed repository targets strictly verified at `v2.2.18`. |
| **Compact `use_skills` & Discipline Skills** | `rtk node tests/test_use_skills_compact.js` | 5-skill bundle `<= 6,400 bytes` (`genin=5093B`, `dedup=2818B`, `anbu=5239B`), all 8 specialists retain `i-have-adhd` & `antislop`. |
| **8 Subagents Spawn, Parallel & `/konoha`** | `rtk node tests/test_langgraph_parallel_and_konoha.js` | All 8 specialists spawn across all 8 clients, `@sannin` router-only, parallel workstreams & `/konoha` LangGraph routing verified. |
| **Real-Time Idle `@advisor` (`<= 1k` tok)** | `rtk node tests/test_advisor_realtime_monitor.js` | `0 tokens` when idle (`IDLE_OK`), `<= 1,000 tokens` cap, `evict_stale_results: true`, `INTERRUPT_CORRECTION` on drift/breach. |
| **HITL Compaction & Native TODOs** | `rtk node tests/test_hitl_compaction_and_todos.js` | Native TODO tools across all 8 clients, `walkthrough_todos.json` written, Gate 1 Option 1 compacts context. |
| **Jonin Dynamic Design & Watermark** | `rtk node tests/test_jonin_dynamic_design_and_watermark.js` | 3D Studio menu hidden (`SHOW_3D_STUDIO_MENU = false`), `Build by konoha` meta/footer verified with 0 AI-detector penalty, live browser monitor & project skill generator verified. |
| **Worktree Isolation & Merge Barrier** | `rtk node tests/test_worktree_isolation.js` | 16/16 worktree isolation, syntax gate, and parallel barrier tests pass. |
| **E2E Install, Upgrade & Token Bounds** | `rtk node tests/test_e2e_install_upgrade_reinstall.js` | Fresh install, upgrade, reinstall, and bounded payloads (`runSannin < 3KB`, `build_from_text < 25KB`) pass with 100% parity. |
| **Documentation Currency** | `rtk node tests/test_docs_currency.js` | Zero drift between exported code symbols and markdown documents. |
| **Draw.io Diagram Collisions** | `rtk node tests/test_diagram_sync.js` | All 18 drawio pages verified with strictly **0 geometric collisions** (0 penetrations, 0 crossings, 0 overlaps). |
| **Animated WebP Assets** | `rtk node tests/test_all_assets_webp.js` | All 33 WebPs valid, 0 legacy `.gif` files, 27 markdown files with 0 broken embeds. |
| **Backend Static Linter** | `rtk node scripts/lint.js` | All JavaScript/Svelte files verified under 700 lines with **0 errors and 0 warnings**. |
| **Zero-AI-Slop Code Hygiene** | `rtk npx aislop scan --changes` | Score **100 / 100 Healthy**, 0 errors, 0 warnings, 0 fixable. |

---

## 📐 Draw.io Zero-Collision Rule & Sync SOP

When editing `docs/diagrams/konoha-architecture.drawio` or `docs/diagrams/konoha-infrastructure-architecture.drawio`:
1. **Never alter existing `mxGeometry` coordinates** unless doing a dedicated layout refactor.
2. Edit the `value="..."` attribute of existing cells in-place to keep 0 geometric collisions.
3. Every cell MUST have a globally unique `id="..."`.
4. Validate immediately with `rtk node tests/test_diagram_sync.js`.
