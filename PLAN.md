# Web UI Refinement Plan & Architectural Specification

**Product:** Konoha Web UI (`apps/web`)  
**Version:** 2.1.18  
**Date:** 2026-10-16  
**Document Status:** Active Implementation Plan  
**Target Areas:** Zero Emoticons / SVG Icon Standards, Sidebar Categories & Submenu Parity, Floating Theme Button Layout, 10 Custom 4-Color Gradient System & Glassmorphism  

---

## 1. Executive Objective

The objective of this Web UI refinement is to modernize and polish the Konoha Web Dashboard across 5 core dimensions:
1. **Zero Emoticon Invariant & SVG Icon Standard**: Eliminate all unicode emojis/emoticons across all Svelte components (`Agents.svelte`, `Detector.svelte`, `Persona.svelte`, `Savings.svelte`, `Search.svelte`, `Skills.svelte`, `Tasks.svelte`, `ThemeSwitcher.svelte`) and replace them with crisp, accessible vector SVG icons from the standard library.
2. **Left Sidebar Category & Submenu Alignment**: Restructure the category headings in `apps/web/src/routes/+layout.svelte` so that every category name semantically and accurately matches the items grouped underneath it (eliminating outdated groupings like "Clients & Finance" for bridges and token savings).
3. **Theme Switcher Floating Button Position & Icon**: Replace the plain dot on the Theme Switcher FAB with an authentic SVG palette/theme icon from the library, and add a `2em` bottom margin offset (`margin-bottom: 2em`) to guarantee zero visual overlap with the left sidebar system status footer.
4. **10 Custom 4-Color Gradient Themes with Glassmorphism**: Update `apps/web/src/lib/state/themeState.svelte.js` and `ThemeSwitcher.svelte` to implement the exact 10 4-color gradient color palettes requested by the user, while preserving full glassmorphism effects (backdrop blur, specular sheen, dynamic CSS variables `--theme-grad-1` through `--theme-grad-4`, `--theme-4gradient`, `--theme-4gradient-bar`, `--theme-4gradient-subtle`).
5. **Codebase Hygiene & Zero Errors/Warnings**: Ensure `pnpm --dir apps/web run check` and `node scripts/lint.js` pass with 0 errors and 0 warnings.

---

## 2. 10 Custom 4-Color Gradient Themes Specification

The 10 themes in `apps/web/src/lib/state/themeState.svelte.js` will be mapped to the user-specified 4-color gradients with custom glassmorphism tints:

| # | Theme ID | Theme Name | 4-Color Gradient Array | Primary Color | Accent Color | Border Color | Light Surface Background |
|:---:|:---|:---|:---|:---:|:---:|:---:|:---:|
| 1 | `chidori` | Chidori Azure Light | `['#3B82F6', '#14B8A6', '#8B5CF6', '#F97316']` | `#3B82F6` | `#14B8A6` | `#bfdbfe` | `#f0f9ff` |
| 2 | `byakugan` | Byakugan Sunburst Light | `['#EAB308', '#EC4899', '#84CC16', '#06B6D4']` | `#EAB308` | `#EC4899` | `#fef08a` | `#fefce8` |
| 3 | `konoha-leaf` | Konoha Indigo Rose Light | `['#6366F1', '#F43F5E', '#3B82F6', '#EAB308']` | `#6366F1` | `#F43F5E` | `#c7d2fe` | `#eef2ff` |
| 4 | `rasengan` | Rasengan Violet Light | `['#8B5CF6', '#06B6D4', '#F97316', '#EC4899']` | `#8B5CF6` | `#06B6D4` | `#ddd6fe` | `#f5f3ff` |
| 5 | `sharingan` | Sharingan Teal Lime Light | `['#14B8A6', '#84CC16', '#6366F1', '#F43F5E']` | `#14B8A6` | `#84CC16` | `#99f6e4` | `#f0fdfa` |
| 6 | `hokage-gold` | Hokage Amber Light | `['#F97316', '#EAB308', '#3B82F6', '#EC4899']` | `#F97316` | `#EAB308` | `#fed7aa` | `#fff7ed` |
| 7 | `anbu-shadow` | Anbu Cyan Purple Light | `['#06B6D4', '#8B5CF6', '#14B8A6', '#6366F1']` | `#06B6D4` | `#8B5CF6` | `#a5f3fc` | `#ecfeff` |
| 8 | `sage-mode` | Sage Pink Ruby Light | `['#EC4899', '#F43F5E', '#EAB308', '#84CC16']` | `#EC4899` | `#F43F5E` | `#fbcfe8` | `#fdf2f8` |
| 9 | `sound-village` | Sound Cobalt Light | `['#3B82F6', '#6366F1', '#06B6D4', '#F43F5E']` | `#3B82F6` | `#6366F1` | `#bfdbfe` | `#eff6ff` |
| 10 | `akatsuki` | Akatsuki Emerald Light | `['#84CC16', '#14B8A6', '#EAB308', '#8B5CF6']` | `#84CC16` | `#14B8A6` | `#d9f99d` | `#f7fee7` |

### Glassmorphism Integration Rules
- Dynamic CSS variables: `--color-primary`, `--color-accent`, `--color-primary-glow`, `--color-bg`, `--color-surface`, `--color-border`.
- Multi-stop gradients: `--theme-4gradient` (`linear-gradient(135deg, ...)`), `--theme-4gradient-bar` (`linear-gradient(90deg, ...)`), and `--theme-4gradient-subtle` (`linear-gradient(135deg, ...22)`).
- Specular glass sheen on cards and modals via `glass-frost-strong` (`backdrop-filter: blur(24px) saturate(200%)`).

---

## 3. Left Sidebar Categories & Submenu Parity Specification

Restructure `navSections` in `apps/web/src/routes/+layout.svelte` from the legacy mismatched categories into structured, domain-accurate groupings:

```javascript
const navSections = [
  {
    title: 'Overview',
    items: [
      { id: 'dashboard', path: '/dashboard', label: 'Dashboard', ... }
    ]
  },
  {
    title: 'Connectivity & Gateways',
    items: [
      { id: 'clients', path: '/clients', label: 'Client IDEs', ... },
      { id: 'bridges', path: '/bridges', label: 'LLM Bridges', ... },
      { id: 'remote', path: '/remote', label: 'Remote Access', badge: 'Telegram', ... }
    ]
  },
  {
    title: 'Token Optimization',
    items: [
      { id: 'savings', path: '/savings', label: 'Token Savings', ... }
    ]
  },
  {
    title: 'Agent Intelligence',
    items: [
      { id: 'agents', path: '/agents', label: 'Ninja Agents', ... },
      { id: 'skills', path: '/skills', label: 'Skills & Vectors', ... },
      { id: 'persona', path: '/persona', label: 'Persona & Memory', ... },
      { id: 'context', path: '/context', label: 'Workspace Context', ... }
    ]
  },
  {
    title: 'Developer Tools',
    items: [
      { id: 'search', path: '/search', label: 'Web Search', badge: 'SearXNG', ... },
      { id: 'semble', path: '/semble', label: 'Semble MCP', badge: '98%', ... },
      { id: 'detector', path: '/detector', label: 'AI Detector', badge: 'Web & Docs', ... }
    ]
  },
  {
    title: 'SDLC Operations & Diagnostics',
    items: [
      { id: 'tasks', path: '/tasks', label: 'SDLC Tasks', ... },
      { id: 'doctor', path: '/doctor', label: 'Health & Doctor', ... },
      { id: 'docs', path: '/docs', label: 'Documentation', ... }
    ]
  }
];
```

---

## 4. Theme Switcher FAB Layout & Icon Specification

In `apps/web/src/components/ThemeSwitcher.svelte`:
- **Bottom Margin Offset**: Add `margin-bottom: 2em;` to the floating container (`class="fixed bottom-20 left-5 lg:bottom-6 lg:left-6 z-50 mb-[2em]" style="margin-bottom: 2em;"`) to guarantee clearance above the left sidebar footer (`Live MCP Gateway`).
- **Library SVG Icon**: Replace the plain `<span>` circle with a clean SVG Theme Palette icon:
  ```svelte
  <svg class="w-5 h-5 transition-transform duration-200 group-hover:rotate-45" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4 4 4 0 014-4c.73 0 1.41.2 2 .54V7a4 4 0 118 0v10.54c.59-.34 1.27-.54 2-.54a4 4 0 014 4 4 4 0 01-4 4H7zM7 17a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z" />
  </svg>
  ```

---

## 5. Zero-Emoticon Inventory & SVG Replacement Map

| Component | Target Location | Legacy Emoticon / Character | Replacement Library SVG Icon |
|:---|:---|:---:|:---|
| `Agents.svelte` | Badge | `🛡️ Protected` | `<svg class="w-3.5 h-3.5"> (Shield check path) </svg> Protected` |
| `Agents.svelte` | Hero icon | `🥷` | `<svg class="w-5 h-5"> (User / ninja mask path) </svg>` |
| `Agents.svelte` | Edit button | `✏️` | `<svg class="w-3.5 h-3.5"> (Pencil path) </svg>` |
| `Agents.svelte` | Close button | `✕` | `<svg class="w-3.5 h-3.5"> (Close X path) </svg>` |
| `Detector.svelte` | Tab button | `🌐 Website AI` | `<svg class="w-3.5 h-3.5"> (Globe path) </svg> Website AI` |
| `Detector.svelte` | Tab button | `📄 Document AI` | `<svg class="w-3.5 h-3.5"> (Document path) </svg> Document AI` |
| `Persona.svelte` | Preset chips | `✧ Sannin`, `♦ Jonin`, `♠ Anbu`, `⚑ Genin` | Clean inline SVG badge / rank icons without unicode dingbats |
| `Savings.svelte` | Hero badge | `🏆` | `<svg class="w-5 h-5"> (Trophy path) </svg>` |
| `Savings.svelte` | Section titles | `⚡`, `🔍`, `⚙` | `<svg class="w-4 h-4"> (Lightning / Search / Cog paths) </svg>` |
| `Search.svelte` | Fallback chain | `➔` | `<svg class="w-3 h-3"> (Arrow right path) </svg>` |
| `Skills.svelte` | Tab buttons | `🔤 Local FTS5`, `⚡ Neural Vector`, `🌐 skills.sh` | `<svg class="w-3.5 h-3.5"> (Font / Sparkle / Globe paths) </svg>` |
| `Skills.svelte` | Action buttons | `🔍`, `📄 Instructions & Manual` | `<svg class="w-3.5 h-3.5"> (Magnifier / FileText paths) </svg>` |
| `Tasks.svelte` | DoR status | `✓ Ready`, `✗ Not Ready` | `<svg class="w-3.5 h-3.5"> (CheckCircle / XCircle paths) </svg>` |
| `ThemeSwitcher.svelte`| Close modal | `✕` | `<svg class="w-4 h-4"> (X path) </svg>` |

---

## 6. Phased Implementation Steps

- [x] **Phase 1: Planning & Architecture (This Document)**
- [x] **Phase 2: Theme State & 10 Color Gradients Update (`themeState.svelte.js` & `ThemeSwitcher.svelte`)**
- [x] **Phase 3: Theme Switcher FAB Button Layout (`mb-[2em]` + Library SVG Icon)**
- [x] **Phase 4: Left Sidebar Category & Submenu Restructuring (`+layout.svelte`)**
- [x] **Phase 5: Zero-Emoticon Sweep & Vector Icon Replacement Across All Components**
- [x] **Phase 6: Typecheck, Build, Linting & Delivery Gate Validation**
