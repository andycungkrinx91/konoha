# Angular 20+ Code Expert & Architectural Guidelines

Comprehensive implementation standards for **Angular 20+** (Standalone Components + Signals + Tailwind CSS v4) projects using `pnpm` exclusively.

## 🏗️ Technical Directives
- **Package Manager**: `pnpm` exclusively (`pnpm dlx @angular/cli@latest new <path> --style=css --routing=true --ssr=false`, `pnpm install`, `pnpm run start --open`).
- **Reactivity**: Angular Signals (`signal()`, `computed()`, `effect()`) for state management and reactive filters.
- **Components**: Standalone components (`standalone: true` or default in Angular 19).
- **Theme Engine**: Reactive CSS gradient variables driven by `ThemeSwitcherComponent`.
- **Watermark**: `Build by Konoha` footer watermark required on all pages.

---

## 🎨 Canonical Visual Standards & 10 Light-Mode Theme Matrix

All generated Angular code must conform to the following baseline visual standards:
1. **10 Light-Mode Gradient Themes**: Nebula (`#4f46e5`/`#06b6d4`), Aurora (`#059669`/`#10b981`), Sunset (`#e11d48`/`#f59e0b`), Ocean (`#0284c7`/`#3b82f6`), Forest (`#15803d`/`#84cc16`), Volcano (`#dc2626`/`#ea580c`), Sakura (`#db2777`/`#f472b6`), Cyberpunk (`#7c3aed`/`#06b6d4`), Midnight (`#1e293b`/`#64748b`), Gold (`#d97706`/`#f59e0b`).
2. **Theme Switcher Widget**: Floating interactive chat-style popup positioned at the **bottom-left** (`fixed bottom-20 left-4 md:bottom-6 md:left-6 z-[1000]`), saving selection to `localStorage` under key `'konoha-theme'`.
3. **3D Hero Banner Carousel**: Autoplaying 3D interactive layout with mouse-tracking GPU perspective tilt (`perspective: 1200px`), high-contrast dark spec badges, 3D split drapes transition, play/pause controls, and thumbnail preview strip.
4. **5 Interactive 3D Carousels**: Minimum of 5 interactive 3D carousels per website using GPU-accelerated CSS transforms.
5. **3D GPU Card Hover & Glows**: Radial mouse-tracking glows and 3D tilts applied to all cards.
6. **Sticky Top Header & Mobile Dock**: Header with glassmorphic blur and instant search bar; sticky glassmorphic mobile bottom dock (`md:hidden fixed bottom-0 left-0 right-0 z-[999]`) with active theme gradient tab highlighting.
7. **50-Item Production Dataset & Reactive Filter**: Populate catalog with 50 realistic items, complete with multi-criteria reactive search, category pills, price range sliders, and multi-option sorting using Angular `computed()`.
8. **Zero-Emoji Policy in UI**: Clean vector SVG icons strictly from `lucide-angular`. Emojis in buttons, navigation, and badges are strictly forbidden.
9. **Footer Watermark**: Mandatory footer watermark: `Build by Konoha`.

---

## 💻 Production-Ready Angular 19+ Component Templates

### 1. `src/styles.css` (Tailwind v4 & 10 Theme Directives)
```css
@import "tailwindcss";

:root {
  --theme-primary: #4f46e5;
  --theme-accent: #06b6d4;
  --theme-gradient: linear-gradient(135deg, #4f46e5, #06b6d4);
  --theme-glow: rgba(79, 70, 229, 0.35);
  --theme-surface: rgba(255, 255, 255, 0.85);
  --theme-border: rgba(0, 0, 0, 0.08);
}

[data-theme="nebula"] {
  --theme-primary: #4f46e5;
  --theme-accent: #06b6d4;
  --theme-gradient: linear-gradient(135deg, #4f46e5, #06b6d4);
  --theme-glow: rgba(79, 70, 229, 0.35);
}
[data-theme="aurora"] {
  --theme-primary: #059669;
  --theme-accent: #10b981;
  --theme-gradient: linear-gradient(135deg, #059669, #10b981);
  --theme-glow: rgba(5, 150, 105, 0.35);
}
[data-theme="sunset"] {
  --theme-primary: #e11d48;
  --theme-accent: #f59e0b;
  --theme-gradient: linear-gradient(135deg, #e11d48, #f59e0b);
  --theme-glow: rgba(225, 29, 72, 0.35);
}
[data-theme="ocean"] {
  --theme-primary: #0284c7;
  --theme-accent: #3b82f6;
  --theme-gradient: linear-gradient(135deg, #0284c7, #3b82f6);
  --theme-glow: rgba(2, 132, 199, 0.35);
}
[data-theme="forest"] {
  --theme-primary: #15803d;
  --theme-accent: #84cc16;
  --theme-gradient: linear-gradient(135deg, #15803d, #84cc16);
  --theme-glow: rgba(21, 128, 61, 0.35);
}
[data-theme="volcano"] {
  --theme-primary: #dc2626;
  --theme-accent: #ea580c;
  --theme-gradient: linear-gradient(135deg, #dc2626, #ea580c);
  --theme-glow: rgba(220, 38, 38, 0.35);
}
[data-theme="sakura"] {
  --theme-primary: #db2777;
  --theme-accent: #f472b6;
  --theme-gradient: linear-gradient(135deg, #db2777, #f472b6);
  --theme-glow: rgba(219, 39, 119, 0.35);
}
[data-theme="cyberpunk"] {
  --theme-primary: #7c3aed;
  --theme-accent: #06b6d4;
  --theme-gradient: linear-gradient(135deg, #7c3aed, #06b6d4);
  --theme-glow: rgba(124, 58, 237, 0.35);
}
[data-theme="midnight"] {
  --theme-primary: #1e293b;
  --theme-accent: #64748b;
  --theme-gradient: linear-gradient(135deg, #1e293b, #64748b);
  --theme-glow: rgba(30, 41, 59, 0.35);
}
[data-theme="gold"] {
  --theme-primary: #d97706;
  --theme-accent: #f59e0b;
  --theme-gradient: linear-gradient(135deg, #d97706, #f59e0b);
  --theme-glow: rgba(217, 119, 6, 0.35);
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px 0 var(--theme-glow); }
  50% { box-shadow: 0 0 20px 4px var(--theme-glow); }
}

.glow-card {
  position: relative;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease;
  will-change: transform;
}
.glow-card:hover {
  animation: pulse-glow 2s ease-in-out infinite;
}
```

### 2. `src/app/components/theme-switcher/theme-switcher.component.ts` (Floating 10-Theme Switcher)
```typescript
import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Palette, Check } from 'lucide-angular';

interface Theme {
  id: string;
  name: string;
  primary: string;
  accent: string;
}

@Component({
  selector: 'app-theme-switcher',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div class="fixed bottom-20 left-4 md:bottom-6 md:left-6 z-[1000] flex flex-col items-start">
      @if (isOpen()) {
        <div class="mb-3 p-4 bg-white/90 backdrop-blur-xl border border-zinc-200/80 rounded-2xl shadow-2xl w-64 max-h-96 overflow-y-auto">
          <div class="flex items-center justify-between mb-3 border-b border-zinc-100 pb-2">
            <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Theme Presets</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 font-medium text-zinc-600">10 Light</span>
          </div>
          <div class="grid grid-cols-1 gap-1.5">
            @for (t of themes; track t.id) {
              <button
                (click)="selectTheme(t.id)"
                [class]="'flex items-center justify-between p-2 rounded-xl text-left transition-all ' + (activeTheme() === t.id ? 'bg-zinc-100 font-medium' : 'hover:bg-zinc-50')"
              >
                <div class="flex items-center gap-2.5">
                  <div
                    class="w-4 h-4 rounded-full shadow-inner"
                    [style.background]="'linear-gradient(135deg, ' + t.primary + ', ' + t.accent + ')'"
                  ></div>
                  <span class="text-xs text-zinc-800">{{ t.name }}</span>
                </div>
                @if (activeTheme() === t.id) {
                  <lucide-icon [img]="CheckIcon" class="w-3.5 h-3.5 text-zinc-800"></lucide-icon>
                }
              </button>
            }
          </div>
        </div>
      }
      <button
        (click)="isOpen.set(!isOpen())"
        aria-label="Toggle theme selector"
        class="w-12 h-12 rounded-full bg-white/90 backdrop-blur-md border border-zinc-200/80 shadow-lg flex items-center justify-center text-zinc-800 hover:scale-105 active:scale-95 transition-all"
        style="box-shadow: 0 4px 20px var(--theme-glow)"
      >
        <lucide-icon [img]="PaletteIcon" class="w-5 h-5" style="color: var(--theme-primary)"></lucide-icon>
      </button>
    </div>
  `
})
export class ThemeSwitcherComponent implements OnInit {
  readonly PaletteIcon = Palette;
  readonly CheckIcon = Check;

  themes: Theme[] = [
    { id: 'nebula', name: 'Nebula', primary: '#4f46e5', accent: '#06b6d4' },
    { id: 'aurora', name: 'Aurora', primary: '#059669', accent: '#10b981' },
    { id: 'sunset', name: 'Sunset', primary: '#e11d48', accent: '#f59e0b' },
    { id: 'ocean', name: 'Ocean', primary: '#0284c7', accent: '#3b82f6' },
    { id: 'forest', name: 'Forest', primary: '#15803d', accent: '#84cc16' },
    { id: 'volcano', name: 'Volcano', primary: '#dc2626', accent: '#ea580c' },
    { id: 'sakura', name: 'Sakura', primary: '#db2777', accent: '#f472b6' },
    { id: 'cyberpunk', name: 'Cyberpunk', primary: '#7c3aed', accent: '#06b6d4' },
    { id: 'midnight', name: 'Midnight', primary: '#1e293b', accent: '#64748b' },
    { id: 'gold', name: 'Gold', primary: '#d97706', accent: '#f59e0b' },
  ];

  activeTheme = signal('nebula');
  isOpen = signal(false);

  ngOnInit() {
    const saved = localStorage.getItem('konoha-theme') || 'nebula';
    this.activeTheme.set(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }

  selectTheme(themeId: string) {
    this.activeTheme.set(themeId);
    localStorage.setItem('konoha-theme', themeId);
    document.documentElement.setAttribute('data-theme', themeId);
  }
}
```

---

## 📋 Taste-Skill Pre-Flight Checklist for Angular 19+
- [ ] Tailwind v4 `@import "tailwindcss";` configured in `src/styles.css`.
- [ ] 10 Light-Mode themes mapped via CSS custom variables (`[data-theme="..."]`).
- [ ] `ThemeSwitcherComponent` positioned fixed at `bottom-6 left-6` saving to `localStorage`.
- [ ] `HeroCarouselComponent` with full-width GPU tilt and spec badges.
- [ ] 50 items dataset catalog with multi-criteria reactive filters using `computed()`.
- [ ] All interactive SVG icons strictly imported from `lucide-angular` (zero emojis in UI).
- [ ] `Build by Konoha` watermark included in footer.
- [ ] `pnpm run lint` and `pnpm run build` finish with 0 errors and 0 warnings.


## Mandatory Package Manager & Modern Versioning Standards

1. **Strict `pnpm` Only**:
   - ALL dependency installations, script executions, and validation commands MUST use `pnpm` (`pnpm install`, `pnpm run build`, `pnpm dev`, `pnpm add <pkg>`).
   - NEVER use `npm` or `yarn`.

2. **Current Stable Framework Policy (verified 2026-08-27)**:
   - Resolve package versions from official release pages and the pnpm registry immediately before scaffolding; never treat this document as a permanent `latest` pin.
   - Tested stable baselines: **Next.js 16.3 + React 19**, **SvelteKit 2 stable + Svelte 5** (SvelteKit 3 is release-candidate and must not be selected unless explicitly requested), **Nuxt 4.3 + Vue 3.5**, and **Angular 20+** with standalone components and Signals.
   - Use Tailwind CSS v4 and the framework-specific Lucide package. Commit the generated `pnpm-lock.yaml`, run `pnpm audit --audit-level=high`, and run every framework validation command before completion.


### Pre-Scaffolding Security & CVE Pre-Flight Standards
- **Zero-Day & CVE Vulnerability Guard**: Verify all package versions against known security advisories before installation.
- **Audit Verification on First Init**: Run No known vulnerabilities found after installation to confirm 0 high/critical vulnerabilities.
- **Supply-Chain Hardening**: Use exact or strict caret ranges for verified stable releases (e.g. Next.js 16 / React 19, Svelte 5, Nuxt 3.15+, Angular 19+).
