# Plan: Cross-Framework Design Sync & Modern Visual Overhaul

## Goal
Ensure SvelteKit and Next.js websites generated through Konoha have **visually identical** designs, regardless of framework choice. Also upgrade all templates with modern interactive elements (bento grids, scroll animations, parallax, micro-interactions).

## Decisions Confirmed with User
- **Scope**: Generation-time enforcement (fix the skill references so future generations are identical) + existing templates get upgraded
- **Modern design**: Micro-interactions + glassmorphism + bento grids + scroll animations + parallax + 3D elements
- **Framework strategy**: User picks SvelteKit or Next.js, but when both are created they are guaranteed pixel-matched output

---

## What Was Found

### Current Architecture
The jonin-skill has 6 files:
1. `SKILL.md` — Main skill with SOPs (Standard Operating Procedures)
2. `tailwind-design-system.md` — Shared CSS tokens (10 themes, utilities)
3. `svelte-ui-expert.md` — Svelte 5 Runes UI component templates
4. `nextjs-ui-expert.md` — React/Next.js UI component templates
5. `svelte-code-expert.md` — SvelteKit code conventions
6. `nextjs-code-expert.md` — Next.js code conventions

Each UI expert (`svelte-ui-expert.md`, `nextjs-ui-expert.md`) defines its own version of every shared component (Hero Banner Carousel, 3D Carousel, Theme Switcher, Glow Cards, Dropdown Selector). They produce similar-but-not-identical results because visual parameters are independently coded.

### 9 Exact Divergences Identified

| # | Component | Aspect | Svelte Value | Next.js Value | Fix |
|---|-----------|--------|-------------|---------------|-----|
| 1 | Glow Card | Radial gradient radius | `circle 150px` | `600px circle` | Standardize to **150px** (bounded to card) in both |
| 2 | Glow Card | Transition duration | `0.3s ease` | `0.4s ease` | Standardize to **300ms** in both |
| 3 | Glow Card | Border radius | `rounded-2xl` (16px) | `rounded-xl` (12px) | Standardize to **rounded-2xl** in both |
| 4 | Glow Card | Background opacity | `bg-white/70` | `bg-white/75` | Standardize to **bg-white/70** in both |
| 5 | Glow Card | Pulse animation | Has `@keyframes pulse-glow` | Missing entirely | Add **identical pulse animation** to both |
| 6 | Theme Dropdown | Entrance animation | `animate-in fade-in slide-in-from-top-2 duration-150` | `transition-all duration-300` (no slide) | Use Svelte's explicit slide-in at 150ms; implement equivalent in React via Framer Motion |
| 7 | Hero Banner | Ken Burns zoom | `animate-[zoom-in_40s_infinite_linear]` | Only `scale-105`, no zoom | Define shared `@utility ken-burns` in design system; apply in both. React impl uses Framer Motion `scale: [1, 1.05]` over 40s infinite |
| 8 | Hero Banner | Content entrance | Simple `in:fade={{ duration: 600 }}` | `initial={{ y: 20 }} animate={{ y: 0 }}` (slide-up) | Standardize to **slide-up entrance** (more premium); provide Svelte `fly({ y: 20 })` equivalent |
| 9 | All components | Hardcoded colors | Heavy use of `text-zinc-400`, `border-zinc-200/80` | Same pattern | Replace where possible with semantic tokens (`text-text-secondary`, `border-border-subtle`); keep hardcoded only for explicitly-theme-invariant dark elements (carousel stages, per existing rule) |

### Additional Modernization Gaps
- No bento grid layout patterns exist anywhere
- No scroll-triggered animation system exists
- No parallax layering exists
- Micro-interaction library is incomplete (only glow hover + basic scale)
- Typography uses Inter as sans-serif but not consistently across breakpoints
- Mobile bottom navigation pattern is documented in tailwind-design-system but not present in any carousel/template component

---

## Implementation Phases

### Phase 1: Create Design Token Manifest (NEW FILE)

**File**: `.agents/skills/jonin-skill/references/design-token-manifest.md`

This is the single source of truth for all visual parameters. Every UI template comment-links back to it.

Content structure:
- **Glow tokens**: gradient radius, transition duration, keyframe timings
- **Animation tokens**: durations (micro: 150ms, standard: 300ms, entrance: 500ms), easing curves
- **Typography tokens**: font families, sizes, tracking values, line heights
- **Perspective & 3D tokens**: perspective distance (1200px), translateZ values, tilt max (12deg)
- **Color migration map**: which hardcoded colors → which semantic tokens
- **Bento grid tokens**: card sizes, gap values, span classes
- **Scroll animation tokens**: intersection threshold, fade-up distances, stagger delays
- **Parallax tokens**: speed tiers (slow: 0.3, medium: 0.6, fast: 1.0)

Every entry includes: canonical value, Svelte impl note, Next.js impl note. This makes divergences impossible to introduce silently.

### Phase 2: Align Glow Card Component

Fix divergences #1-5 across both files.

**In `svelte-ui-expert.md`** (lines ~165-277):
- Change radial gradient from `150px` to `150px` (already correct) — but fix glow border to match
- Ensure pulse animation is present (it already is in svelte)
- Standardize transition to `0.3s ease` (already correct)

**In `nextjs-ui-expert.md`** (lines ~412-427 in GlowCard component):
- Change `600px circle` → `150px`
- Change `0.4s` → `0.3s` / `duration-300`
- Change `rounded-xl` → `rounded-2xl`
- Change `bg-white/75` → `bg-white/70`
- Add `pulse-glow` keyframes identical to the Svelte version
- Add matching border color and shadow tokens

### Phase 3: Align Theme Dropdown Selector

Fix divergence #6 across both files.

**In `svelte-ui-expert.md`** (~lines 297-392):
- Already has slide-in-from-top-2 at 150ms — keep as-is

**In `nextjs-ui-expert.md`** (~lines 429-522):
- Replace `transition-all duration-300` with Framer Motion equivalent:
  ```tsx
  initial={{ opacity: 0, y: -8, scale: 0.95 }}
  animate={{ opacity: 1, y: 0, scale: 1 }}
  exit={{ opacity: 0, y: -8, scale: 0.95 }}
  transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
  ```

### Phase 4: Align Hero Banner Carousel

Fix divergences #7-8 across both files.

**In `svelte-ui-expert.md`** (~lines 669-740):
- Add fly transition to content: `in:fly={{ y: 20, duration: 600 }}` replacing simple fade
- Keep `animate-[zoom-in_40s_infinite_linear]` on image

**In `nextjs-ui-expert.md`** (~lines 335-405):
- Replace `initial={{ opacity: 0 }}` with `initial={{ opacity: 0, y: 20 }}` for content
- Add `animate-in` Framer Motion transition matching Svelte fly: `{ duration: 0.6 }` slide-up
- Add Ken Burns to image: `animate={{ scale: [1, 1.05] }} transition={{ duration: 40, repeat: Infinity, repeatType: "reverse", ease: "linear" }}`

### Phase 5: Token-to-Utility Bridging in Tailwind Design System

**File**: `tailwind-design-system.md`

Add new sections after existing theme definitions:

```css
/* === Token-to-Utility Bridge (applied by both frameworks identically) === */
@utility radius-card { border-radius: var(--radius-card); }
@utility anim-micro { transition-duration: 150ms; }
@utility anim-standard { transition-duration: 300ms; }
@utility anim-entrance { transition-duration: 500ms; }
@utility ease-smooth { transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1); }
@utility ease-bounce { transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }
@utility shadow-card { box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25), 0 0 20px rgba(240,240,244,0.5); }
@utility ken-burns { animation: ken-burns 40s infinite linear; }
@utility glow-hover { /* standardized radial gradient on hover */ }
@utility glass-panel { background-color: rgba(255, 255, 255, 0.7); backdrop-filter: blur(16px); border: 1px solid rgba(24, 24, 27, 0.12); border-radius: var(--radius-card); }
```

Add new semantic tokens:
- `--color-border-subtle` mapping to existing `border-border-subtle` usage
- `--duration-micro: 150ms`
- `--duration-standard: 300ms`
- `--duration-entrance: 500ms`

### Phase 6: Add Modern Design Patterns to Design System

**File**: `tailwind-design-system.md`

Add new sections:

**Bento Grid System**:
```css
@utility bento-grid {
  display: grid;
  gap: var(--spacing-card);
  grid-template-columns: 1fr;
  @media (min-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 1024px) {
    grid-template-columns: repeat(3, 1fr);
  }
}
@utility bento-card {
  background-color: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(16px);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-card);
  transition: transform var(--duration-standard) ease-smooth, box-shadow var(--duration-standard) ease-smooth;
}
@utility bento-card:hover {
  transform: translateY(-4px) scale(1.01);
  box-shadow: 0 20px 40px -8px rgba(0, 0, 0, 0.12);
}
```

**Scroll Animation Tokens**: Define four animation keyframes (fade-up: translateY(20px)->0, scale-in: scale(0.95)->1, slide-left: translateX(30px)->0, stagger: delay variants). Set intersection observer threshold to 0.15.

**Parallax Layers**: Define three CSS custom properties for scroll-based transform tiers: `--parallax-slow: 0.3`, `--parallax-medium: 0.6`, `--parallax-fast: 1.0`. Document how to read these via a shared scroll handler.

**Micro-Interaction Library**: Five standardized interactions with exact duration/easing:
- chip-pop: scale(0.8)->scale(1.05)->scale(1.0) over 200ms
- ripple-expand: radial gradient scale 0->2 over 400ms
- press-feedback: scale(0.97) on active, 300ms ease-smooth
- shimmer: background position shift over 1.5s
- magnetic-hover: translateX/y up to 8px toward cursor over 150ms

### Phase 7: Update UI Expert References with Manifest Compliance

**In both `svelte-ui-expert.md` and `nextjs-ui-expert.md`**:

Add header comment citing the manifest:
```markdown
<!-- ALL components in this file MUST comply with design-token-manifest.md -->
<!-- See SKILL.md SOP-6 for cross-framework verification rules -->
```

Update all component templates to:
- Add manifest citation comments (e.g., `<!-- glow-circle-radius=150px per manifest #glow-tokens -->`)
- Use unified token class names (`glass-panel`, `anim-standard`, etc.) instead of ad-hoc Tailwind class strings where possible
- Replace hardcoded color values with semantic tokens per the migration map
- Add mobile bottom navigation dock where applicable
- Ensure all components pass the 10-theme switcher requirement and use `var(--gradient-primary)` for icon strokes

### Phase 8: Add Cross-Framework Design Sync Verification SOP

**File**: `SKILL.md`

Append new section:

**SOP 6: Cross-Framework Design Sync Verification**

Run AFTER generating any frontend code. Steps:

1. **Manifest compliance audit**: Verify that all component class strings reference the same values. Key checks:
   - Border radius: all cards use `rounded-2xl` or `class="radius-card"`
   - Transitions: all hover effects use `duration-300` / `anim-standard`
   - Opacity: glass panels use `bg-white/70` / `bg-white/70 backdrop-blur-xl`
   - Colors: text uses `text-text-secondary` not `text-zinc-400` where semantic token exists
   - Z-index: dropdown menus use `z-50`, backdrops use `z-40`

2. **Structural parity check**: Both Svelte and Next.js versions must have matching HTML structure at the component level:
   - Same number of sections
   - Same heading hierarchy (h1 > h2 > h3)
   - Same carousel item count (minimum 4, duplicated to 6+)
   - Same breakpoint behavior

3. **Visual diff validation** (if both projects exist side-by-side):
   - Build both projects to static HTML
   - Capture screenshots at 390x844, 768x1024, 1440x900
   - Compare via pixelmatch with <2% tolerance for sub-pixel rendering

4. **Resolution protocol**: On any mismatch → identify offending component → consult manifest → patch BOTH frameworks simultaneously → re-validate.

### Phase 9: Add Automated Verification Script

**New file**: `src/design_sync_verify.js`

Takes two directory paths as arguments:
```bash
node src/design_sync_verify.js path/to/sveltekit-project path/to/nextjs-project
```

Outputs JSON report:
```json
{
  "pass": true,
  "checks": [
    { "component": "HeroBanner", "aspect": "animation-duration", "svelte": "600ms", "nextjs": "600ms", "match": true },
    { "component": "GlowCard", "aspect": "gradient-radius", "svelte": "150px", "nextjs": "150px", "match": true },
    ...
  ]
}
```

Checks implemented:
- Extract all Tailwind utility strings from components
- Parse animation durations, border radii, transition times, background opacities, z-index values
- Compare against manifest expectations
- Flag mismatches

---

## Execution Order

1. **Phase 1**: Create `design-token-manifest.md`
2. **Phase 2**: Fix Glow Card divergences (#1-5)
3. **Phase 3**: Fix Theme Dropdown divergence (#6)
4. **Phase 4**: Fix Hero Banner divergences (#7-8)
5. **Phase 5**: Add Token-to-Utility bridging to `tailwind-design-system.md`
6. **Phase 6**: Add modern design patterns to `tailwind-design-system.md`
7. **Phase 7**: Update both UI experts with manifest citations and semantic tokens
8. **Phase 8**: Add SOP 6 to `SKILL.md`
9. **Phase 9**: Create automated verification script

Phases 1-4 fix the core sync issue (all 9 divergences). Phase 5-6 add the modern design upgrades. Phase 7-9 harden the system for ongoing enforcement.

## Risk Considerations
- These are skill REFERENCES, not runnable code. They guide AI agents during website generation. Modifying them means every future generation benefits.
- The visual diff pipeline (SOP 6 step 3) requires browser tooling — if unavailable, fall back to DOM structure comparison.
- The 10-theme switcher + localStorage persistence is already implemented; just need to ensure both framework versions have identical theme lists and hex values.
