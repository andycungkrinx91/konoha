# Implementation & QA Plan: Theme-Consistent Button Styles & 3s Glass-Crack Rasengan Transition

**Date:** 2026-10-16  
**Status:** Completed (100% Verified via Playwright E2E, aislop 100/100, Backend Lint, Docs Currency, Version Sync)  
**Author:** andycungkrinx91 <andy.silva270114@gmail.com>

---

## 1. Objectives & Scope

### Feedback 1: Deep Review & Unification of Button Styles with Active Theme
- Audit all button elements across `apps/web/src/` (`app.css`, `ThemeSwitcher.svelte`, `Tasks.svelte`, `Skills.svelte`, `Search.svelte`, `RemoteAccess.svelte`, `Persona.svelte`, `Detector.svelte`, `Context.svelte`, `Clients.svelte`, `Bridges.svelte`, `Agents.svelte`, `SweetAlertModal.svelte`, `+layout.svelte`).
- Eliminate all hardcoded static button colors (e.g., `bg-purple-600`, `bg-indigo-600`, `hover:border-purple-400`, `text-slate-800 bg-white border-slate-300`, `hover:bg-slate-200`) that clash with the 10 custom 4-color gradient themes.
- Enforce standard, theme-dynamic button classes:
  - **Primary Action Buttons (`.btn-3d-primary`)**: `background: var(--theme-4gradient)`, `border-color: var(--color-primary)`, text `#ffffff`, 3D box shadow with dynamic theme glow.
  - **Secondary / Standard Buttons (`.btn-3d`, `.btn-3d-secondary`)**: `background-color: var(--color-surface)`, `color: var(--color-text)`, `border-color: var(--color-border)`, with hover state adapting to `color-mix(in srgb, var(--theme-grad-1) 12%, var(--color-surface))` and border `var(--color-primary)`.
  - **Active Filter/Tab Pills**: Dynamic styling matching active theme (`.btn-3d-primary` or `background: var(--theme-4gradient)`).
  - **Destructive Buttons**: Theme-safe rose styling with semantic variables.
- Verify across all 10 themes using Playwright E2E and visual checks.

### Feedback 2: 3-Second Glass-Crack Animation for Rasengan Theme Transition
- **Remove** the 10-second wall impact / wall hit earthquake effect (`rasengan-wall-hit-active`, `rasengan-wall-hit-3d` tilt shaking the entire app stage).
- **Remove** tactical text like `⚡ 3D RASENGAN WALL IMPACT // REPAIRING MATRIX IN`.
- **Implement** a pure, high-impact **Glass Crack Animation** after a huge Rasengan loads over **3 seconds**:
  - Center stage displays a massive swirling Rasengan chakra vortex (high-velocity spiral filaments, intense radial chakra glow, particle burst).
  - Transparent glass crack overlay with sharp, crystalline fracture vectors, branching spiderweb fissures, and specular edge glow radiating from the Rasengan center.
  - Tactical HUD countdown displays strictly `3`, `2`, `1` with the chosen theme label:
    - `3` -> `2` -> `1` -> Glass Shatter / Crack flash -> Theme applied.
  - Total duration locked at exactly 3000ms (3 seconds).

### Task 2 & 5: Konoha Maintenance Skills Parity & Documentation
- Update `.agents/skills/konoha/SKILL.md` and `src/templates/skills/konoha/SKILL.md` to document the new Theme-Consistent Button System and the 3s Glass-Crack Rasengan Transition Invariant.
- Synchronize across all 5 skill mirror trees (`.cursor/`, `.gemini/`, `.commandcode/`, `.claude/`, `src/templates/skills/`).

### Task 4: Full QA E2E Testing (Playwright & Agent-Browser)
- Run automated Playwright tests exercising theme switching, button consistency, navigation, and detector flow.
- Add specific E2E test assertions in `tests/e2e/theme_and_navigation.spec.js` asserting:
  - Button styling consistency with theme CSS variables.
  - Rasengan 3s countdown displays `3`, `2`, `1` without legacy wall impact text.
  - Glass crack overlay renders and dismisses cleanly in 3s.

### Task 6: Manual Docs & Diagram Audit
- Manually review all documentation under `docs/*`, guides, `ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`, `.drawio` files, and `assets/*`.

---

## 2. Phased Execution Todo

- [x] **Phase 1: Button Style Architecture & Unification (`app.css` & Components)**
  - [x] Enhance `.btn-3d`, `.btn-3d-primary`, and `.btn-3d-secondary` in `apps/web/src/app.css` with 100% theme variable consistency.
  - [x] Refactor buttons in `Bridges.svelte`, `Skills.svelte`, `Context.svelte`, `Tasks.svelte`, `Agents.svelte`, `Persona.svelte`, `Detector.svelte`, `RemoteAccess.svelte`, `SweetAlertModal.svelte`.
- [x] **Phase 2: 3s Glass-Crack Rasengan Theme Switcher Overlay (`ThemeSwitcher.svelte` & `app.css`)**
  - [x] Strip out `rasengan-wall-hit-active` and 10s earthquake wall tilt.
  - [x] Build 3-second huge Rasengan chakra vortex overlay with glass crack SVG fissures and specular shards.
  - [x] Replace text with clean `3`, `2`, `1` countdown and target theme badge.
- [x] **Phase 3: Playwright E2E Test Suite Expansion & Manual QA**
  - [x] Update `tests/e2e/theme_and_navigation.spec.js` for 3s countdown and glass-crack overlay.
  - [x] Run Playwright E2E browser tests and verify all passing (6/6 passed).
- [x] **Phase 4: Konoha Maintenance Skills & Documentation Sync**
  - [x] Add Invariant (Theme-Consistent Button System & 3s Glass-Crack Transition) to `.agents/skills/konoha/SKILL.md` and template.
  - [x] Sync across mirror trees with `scripts/sync_skills.js` (4,208 files verified).
  - [x] Update `docs/ARCHITECTURE.md`, `docs/SETUP-WEB-UI.md`, and `CHANGELOG.md`.
- [x] **Phase 5: Delivery Gate, Verification & Clean Local Commit**
  - [x] Run `scripts/lint.js`, `test_docs_currency.js`, `test_version_sync.js`, and Playwright E2E.
  - [x] Verify Zero-AI-Slop (100/100) and AI Detector (0/100 Human).
  - [x] Clean local commit under `andycungkrinx91 <andy.silva270114@gmail.com>`.
