# Implementation & QA Plan: Theme-Consistent Button Styles & 2s Glass-Crack Rasengan Transition

**Date:** 2026-10-16  
**Status:** Completed (100% Verified via Playwright E2E 6/6, aislop 100/100, Backend Lint, Docs Currency, Version Sync)  
**Author:** andycungkrinx91 <andy.silva270114@gmail.com>

---

## 1. Objectives & Scope

### Feedback 1: Deep Review & Unification of Button Styles with Active Theme
- Audit all button elements across `apps/web/src/` (`app.css`, `ThemeSwitcher.svelte`, `Tasks.svelte`, `Skills.svelte`, `Search.svelte`, `RemoteAccess.svelte`, `Persona.svelte`, `Detector.svelte`, `Context.svelte`, `Clients.svelte`, `Bridges.svelte`, `Agents.svelte`, `SweetAlertModal.svelte`, `+layout.svelte`).
- Eliminate all hardcoded static button colors that clash with the 10 custom 4-color gradient themes.
- Enforce standard, theme-dynamic button classes (`.btn-3d`, `.btn-3d-primary`, `.btn-3d-secondary`).

### Feedback 2: 2-Second Glass-Crack Animation for Rasengan Theme Transition (Zero Counter)
- **Remove** the 10-second wall impact / wall hit earthquake effect and text.
- **Implement** a pure, high-impact **Glass Crack Animation** with a huge Rasengan center-stage over **2 seconds**:
  - Center stage displays a massive swirling Rasengan chakra vortex (`animate-huge-rasengan`).
  - Transparent glass crack overlay with sharp crystalline fracture vectors and branching fissures (`animate-glass-crack`).
  - **Zero counter / HUD countdown**: Completely removed the HUD countdown timers/numbers for a sleek, distraction-free visual transition.
  - Optical shatter flash (`animate-shatter-flash`) cleanly reveals the new theme.
  - Total duration locked at exactly 2000ms (2 seconds).

### Task 2 & 5: Konoha Maintenance Skills Parity & Documentation
- Update `.agents/skills/konoha/SKILL.md` and `src/templates/skills/konoha/SKILL.md` to document the new Theme-Consistent Button System and the 2s Glass-Crack Rasengan Transition Invariant (Zero Counter).
- Synchronize across all 5 skill mirror trees (`.cursor/`, `.gemini/`, `.commandcode/`, `.claude/`, `src/templates/skills/`).

### Task 4: Full QA E2E Testing (Playwright & Agent-Browser)
- Run automated Playwright tests exercising theme switching, button consistency, navigation, and detector flow.
- E2E test assertions in `tests/e2e/theme_and_navigation.spec.js` asserting:
  - Button styling consistency with theme CSS variables.
  - 2s transition duration and clean dismissal.
  - Complete absence of countdown text / counter elements.

---

## 2. Phased Execution Todo

- [x] **Phase 1: Button Style Architecture & Unification (`app.css` & Components)**
  - [x] Enhance `.btn-3d`, `.btn-3d-primary`, and `.btn-3d-secondary` in `apps/web/src/app.css` with 100% theme variable consistency.
  - [x] Refactor buttons in `Bridges.svelte`, `Skills.svelte`, `Context.svelte`, `Tasks.svelte`, `Agents.svelte`, `Persona.svelte`, `Detector.svelte`, `RemoteAccess.svelte`, `SweetAlertModal.svelte`.
- [x] **Phase 2: 2s Glass-Crack Rasengan Theme Switcher Overlay (`ThemeSwitcher.svelte` & `app.css`)**
  - [x] Strip out `rasengan-wall-hit-active` and 10s earthquake wall tilt.
  - [x] Build 2-second huge Rasengan chakra vortex overlay with glass crack SVG fissures.
  - [x] Remove counter / HUD numbers entirely.
- [x] **Phase 3: Playwright E2E Test Suite Expansion & Manual QA**
  - [x] Update `tests/e2e/theme_and_navigation.spec.js` for 2s transition and zero counter.
  - [x] Run Playwright E2E browser tests and verify all passing (6/6 passed).
- [x] **Phase 4: Konoha Maintenance Skills & Documentation Sync**
  - [x] Add Invariant (Theme-Consistent Button System & 2s Glass-Crack Transition) to `.agents/skills/konoha/SKILL.md` and template.
  - [x] Sync across mirror trees with `scripts/sync_skills.js` (4,208 files verified).
  - [x] Update `docs/ARCHITECTURE.md`, `docs/SETUP-WEB-UI.md`, and `CHANGELOG.md`.
- [x] **Phase 5: Delivery Gate, Verification & Clean Local Commit**
  - [x] Run `scripts/lint.js`, `test_docs_currency.js`, `test_version_sync.js`, and Playwright E2E.
  - [x] Verify Zero-AI-Slop (100/100) and AI Detector (0/100 Human).
  - [x] Clean local commit under `andycungkrinx91 <andy.silva270114@gmail.com>`.
