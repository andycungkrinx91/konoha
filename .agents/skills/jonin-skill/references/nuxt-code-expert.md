# Nuxt 4.3 Code Expert & Architectural Guidelines

Comprehensive implementation standards for **Nuxt 4.3** (Vue 3 Composition API + Pinia + Tailwind CSS v4) projects using `pnpm` exclusively.

## 🏗️ Technical Directives
- **Package Manager**: `pnpm` exclusively (`pnpm dlx nuxi@latest init <path>`, `pnpm install`, `pnpm dev --open`).
- **Reactivity & State**: Vue 3 `<script setup lang="ts">`, `ref()`, `computed()`, and Pinia stores.
- **Routing**: Nuxt 4 file-based routing in `app/pages/` with layout inheritance in `app/layouts/`.
- **Theme Engine**: Reactive CSS custom properties driven by `components/ThemeSwitcher.vue`.
- **Watermark**: `Build by Konoha` footer watermark required on all pages.

---

## 🎨 Canonical Visual Standards & 10 Light-Mode Theme Matrix

All generated Nuxt 3 code must conform to the following baseline visual standards:
1. **10 Light-Mode Gradient Themes**: Nebula (`#4f46e5`/`#06b6d4`), Aurora (`#059669`/`#10b981`), Sunset (`#e11d48`/`#f59e0b`), Ocean (`#0284c7`/`#3b82f6`), Forest (`#15803d`/`#84cc16`), Volcano (`#dc2626`/`#ea580c`), Sakura (`#db2777`/`#f472b6`), Cyberpunk (`#7c3aed`/`#06b6d4`), Midnight (`#1e293b`/`#64748b`), Gold (`#d97706`/`#f59e0b`).
2. **Theme Switcher Widget**: Floating interactive chat-style popup positioned at the **bottom-left** (`fixed bottom-20 left-4 md:bottom-6 md:left-6 z-[1000]`), saving selection to `localStorage` under key `'konoha-theme'`.
3. **3D Hero Banner Carousel**: Autoplaying 3D interactive layout with mouse-tracking GPU perspective tilt (`perspective: 1200px`), high-contrast dark spec badges, 3D split drapes transition, play/pause controls, and thumbnail preview strip.
4. **5 Interactive 3D Carousels**: Minimum of 5 interactive 3D carousels per website using GPU-accelerated CSS transforms.
5. **3D GPU Card Hover & Glows**: Radial mouse-tracking glows and 3D tilts applied to all cards.
6. **Sticky Top Header & Mobile Dock**: Header with glassmorphic blur and instant search bar; sticky glassmorphic mobile bottom dock (`md:hidden fixed bottom-0 left-0 right-0 z-[999]`) with active theme gradient tab highlighting.
7. **50-Item Production Dataset & Reactive Filter**: Populate catalog with 50 realistic items, complete with multi-criteria reactive search, category pills, price range sliders, and multi-option sorting.
8. **Zero-Emoji Policy in UI**: Clean vector SVG icons strictly from `lucide-vue-next`. Emojis in buttons, navigation, and badges are strictly forbidden.
9. **Footer Watermark**: Mandatory footer watermark: `Build by Konoha`.

---

## 💻 Production-Ready Nuxt 3 Component Templates

### 1. `assets/css/main.css` (Tailwind v4 & 10 Theme Directives)
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

### 2. `components/ThemeSwitcher.vue` (Floating 10-Theme Switcher)
```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Palette, Check } from 'lucide-vue-next';

const THEMES = [
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

const activeTheme = ref('nebula');
const isOpen = ref(false);

onMounted(() => {
  const saved = localStorage.getItem('konoha-theme') || 'nebula';
  activeTheme.value = saved;
  document.documentElement.setAttribute('data-theme', saved);
});

function selectTheme(themeId: string) {
  activeTheme.value = themeId;
  localStorage.setItem('konoha-theme', themeId);
  document.documentElement.setAttribute('data-theme', themeId);
}
</script>

<template>
  <div class="fixed bottom-20 left-4 md:bottom-6 md:left-6 z-[1000] flex flex-col items-start">
    <div
      v-if="isOpen"
      class="mb-3 p-4 bg-white/90 backdrop-blur-xl border border-zinc-200/80 rounded-2xl shadow-2xl w-64 max-h-96 overflow-y-auto"
    >
      <div class="flex items-center justify-between mb-3 border-b border-zinc-100 pb-2">
        <span class="text-xs font-semibold uppercase tracking-wider text-zinc-500">Theme Presets</span>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 font-medium text-zinc-600">10 Light</span>
      </div>
      <div class="grid grid-cols-1 gap-1.5">
        <button
          v-for="t in THEMES"
          :key="t.id"
          @click="selectTheme(t.id)"
          :class="[
            'flex items-center justify-between p-2 rounded-xl text-left transition-all',
            activeTheme === t.id ? 'bg-zinc-100 font-medium' : 'hover:bg-zinc-50'
          ]"
        >
          <div class="flex items-center gap-2.5">
            <div
              class="w-4 h-4 rounded-full shadow-inner"
              :style="{ background: `linear-gradient(135deg, ${t.primary}, ${t.accent})` }"
            />
            <span class="text-xs text-zinc-800">{{ t.name }}</span>
          </div>
          <Check v-if="activeTheme === t.id" class="w-3.5 h-3.5 text-zinc-800" />
        </button>
      </div>
    </div>

    <button
      @click="isOpen = !isOpen"
      aria-label="Toggle theme selector"
      class="w-12 h-12 rounded-full bg-white/90 backdrop-blur-md border border-zinc-200/80 shadow-lg flex items-center justify-center text-zinc-800 hover:scale-105 active:scale-95 transition-all"
      style="box-shadow: 0 4px 20px var(--theme-glow)"
    >
      <Palette class="w-5 h-5" style="color: var(--theme-primary)" />
    </button>
  </div>
</template>
```

### 3. `components/HeroCarousel.vue` (3D Interactive Hero Banner)
```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { ChevronLeft, ChevronRight, Play, Pause, Sparkles } from 'lucide-vue-next';

interface Slide {
  id: string | number;
  title: string;
  subtitle: string;
  tag: string;
  specs: { label: string; value: string }[];
  image: string;
}

const props = defineProps<{ slides: Slide[] }>();

const current = ref(0);
const isPlaying = ref(true);
const tilt = ref({ x: 0, y: 0 });
const containerRef = ref<HTMLElement | null>(null);

let intervalId: any = null;

onMounted(() => {
  startAutoplay();
});

onUnmounted(() => {
  stopAutoplay();
});

function startAutoplay() {
  stopAutoplay();
  if (props.slides.length <= 1) return;
  intervalId = setInterval(() => {
    if (isPlaying.value) {
      current.value = (current.value + 1) % props.slides.length;
    }
  }, 6000);
}

function stopAutoplay() {
  if (intervalId) clearInterval(intervalId);
}

function handleMouseMove(e: MouseEvent) {
  if (!containerRef.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width - 0.5) * 16;
  const y = ((e.clientY - rect.top) / rect.height - 0.5) * -16;
  tilt.value = { x, y };
}

function handleMouseLeave() {
  tilt.value = { x: 0, y: 0 };
}
</script>

<template>
  <div
    v-if="slides && slides.length > 0"
    ref="containerRef"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
    class="relative w-full overflow-hidden rounded-3xl bg-zinc-950 text-white min-h-[460px] md:min-h-[560px] flex items-center shadow-2xl"
    style="perspective: 1200px"
  >
    <div
      class="absolute inset-0 transition-transform duration-500 ease-out"
      :style="{
        transform: `scale(1.05) rotateX(${tilt.y}deg) rotateY(${tilt.x}deg) translateZ(10px)`
      }"
    >
      <img
        :src="slides[current].image"
        :alt="slides[current].title"
        class="w-full h-full object-cover opacity-40 brightness-75"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent" />
    </div>

    <div class="relative z-10 max-w-5xl mx-auto px-8 py-16 w-full flex flex-col justify-between min-h-[460px] md:min-h-[560px]">
      <div>
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase bg-white/10 backdrop-blur-md border border-white/20 text-white mb-6">
          <Sparkles class="w-3.5 h-3.5" style="color: var(--theme-accent)" />
          <span>{{ slides[current].tag }}</span>
        </div>
        <h1 class="text-4xl md:text-6xl font-bold tracking-tight max-w-3xl leading-[1.1] mb-4">
          {{ slides[current].title }}
        </h1>
        <p class="text-base md:text-lg text-zinc-300 max-w-xl mb-8">
          {{ slides[current].subtitle }}
        </p>

        <div class="flex flex-wrap gap-4 mb-8">
          <div
            v-for="(spec, i) in slides[current].specs"
            :key="i"
            class="px-4 py-2 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 flex flex-col"
          >
            <span class="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">{{ spec.label }}</span>
            <span class="text-sm font-bold text-white">{{ spec.value }}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between pt-6 border-t border-white/10">
        <div class="flex items-center gap-2">
          <button
            v-for="(_, idx) in slides"
            :key="idx"
            @click="current = idx"
            :class="[
              'h-2 rounded-full transition-all',
              current === idx ? 'w-8 bg-white' : 'w-2 bg-white/30 hover:bg-white/60'
            ]"
          />
        </div>

        <div class="flex items-center gap-2">
          <button
            @click="isPlaying = !isPlaying"
            class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all"
          >
            <Pause v-if="isPlaying" class="w-4 h-4" />
            <Play v-else class="w-4 h-4" />
          </button>
          <button
            @click="current = (current - 1 + slides.length) % slides.length"
            class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all"
          >
            <ChevronLeft class="w-5 h-5" />
          </button>
          <button
            @click="current = (current + 1) % slides.length"
            class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all"
          >
            <ChevronRight class="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
```

---

## 📋 Taste-Skill Pre-Flight Checklist for Nuxt 3
- [ ] Tailwind v4 `@import "tailwindcss";` configured in `assets/css/main.css`.
- [ ] 10 Light-Mode themes mapped via CSS custom variables (`[data-theme="..."]`).
- [ ] `ThemeSwitcher.vue` positioned fixed at `bottom-6 left-6` saving to `localStorage`.
- [ ] `HeroCarousel.vue` with full-width GPU tilt and spec badges.
- [ ] 50 items dataset catalog with multi-criteria reactive filters and search.
- [ ] All interactive SVG icons strictly imported from `lucide-vue-next` (zero emojis in UI).
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
