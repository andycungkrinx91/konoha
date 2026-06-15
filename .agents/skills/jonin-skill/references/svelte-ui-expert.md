# SvelteKit UI Expert

> Read when: designing reusable Svelte components, building component APIs with Runes, handling advanced UI states, or implementing gradient/glow systems.
> 
> **Related References:**
> - For styling, setup, and global design: read `references/tailwind-design-system.md`

> [!WARNING]
> **Tool Boundaries**: Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it for skills burns quota tokens. Always use `skills-db` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.


## 💎 MANDATORY VISUAL EFFECTS (ZERO EXCEPTION)
For EVERY website you generate or build, you MUST implement these premium visual features:
1. **The 10 Gradient Themes & Switcher**: Nebula (purple-blue), Aurora (emerald-cyan), Sunset (rose-amber), Ocean (blue-teal), Forest (green-emerald), Volcano (red-orange), Sakura (pink-rose), Cyberpunk (magenta-violet), Midnight (indigo-slate), and Gold (amber-yellow) defined via `@theme` in `app.css` / `globals.css`. A functional theme switcher saved to `localStorage` must be included.
2. **Homepage Hero Banner 3D Carousel**: The homepage banner/hero section MUST be an interactive 3D carousel slider featuring a minimum of 4 images, utilizing GPU-accelerated 3D transition effects (such as 3D cube rotation, 3D card flipping, coverflow, or perspective carousel rotation) and smooth control transitions. **Importantly, the homepage hero banner MUST be full-width when displayed from desktop view (i.e. edge-to-edge of the viewport without margins or layout constraints).**
3. **Standard Minimum 5 Interactive 3D Carousels**: Newly generated websites MUST feature at least **5 interactive 3D carousels** (e.g. hero slide deck, category showcases, featured items, customer lookbook, testimonials/reviews). These carousels must utilize GPU-accelerated 3D CSS transforms (using `perspective`, `rotateX`/`rotateY`, `translateZ`, and `scale`) with full transition handles and navigation control elements.
4. **3D GPU Card Hover & Animated Glows in ALL Cards**: EVERY single card component (e.g. product cards, features, categories, testimonials) must feature a 3D perspective rotation on hover (using CSS card-3d styles) combined with a dynamic GPU-accelerated animated glow border or radial mouse-tracking gradient glow.
5. **Custom 3D SweetAlert2 Dialogs**: All system alerts, success/error confirmations, warnings, and prompt dialogs MUST use `sweetalert2` configured with a 3D entrance transition (via `showClass` and custom CSS transforms) and confirm buttons styled with the active theme's gradient.
6. **Custom Styled SVG/CSS Logo**: Newly generated websites MUST feature a custom, premium logo in both the header and footer consisting of a styled inline SVG icon combined with custom CSS gradient typography (or a fully custom visual SVG mark) dynamically displaying the project's name as specified in the user's prompt (instead of static default placeholders like VIBELAB). Never leave the logo empty/missing.
7. **Footer Watermark**: The footer of all newly generated websites MUST feature the watermark text: `Build with Antigravity and Konoha agentic AI` in small, muted typography.

## Svelte 5 Component Architecture

Use Svelte 5 Runes for all state and effects.

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '$lib/utils'

  // 1. Props ($props) - never use `export let`
  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    children,
    class: className = '',
  }: {
    variant?: 'primary' | 'secondary' | 'ghost'
    size?: 'sm' | 'md' | 'lg'
    disabled?: boolean
    children?: Snippet
    class?: string
  } = $props()

  // 2. State ($state)
  let isHovered = $state(false)

  // 3. Derived ($derived)
  let isActive = $derived(!disabled && isHovered)

  // 4. Effects ($effect) - use sparingly
</script>

<button 
  class={cn(variants[variant], sizes[size], className)}
  {disabled}
  onmouseenter={() => isHovered = true}
  onmouseleave={() => isHovered = false}
>
  {@render children?.()}
</button>
```

Rules:
- Accept a `class` prop for styling overrides via `cn()`.
- Provide sensible defaults for all optional props.
- Use `Snippet` for composable children.

## Component Libraries

We favor copy-paste and headless libraries over bloated NPM packages.

| Library | Best For |
|---------|----------|
| **shadcn-svelte** | Enterprise UI, full customization. Start here. |
| **SvelteUI** | Svelte 5 UI components, page blocks, and animations. Great for rapid premium assembly. |
| **Bits UI** | Headless accessible primitives. |
| **Ark UI** | Complex compound UI (Combobox, Date picker). |

## Icons
**Mandatory**: ALWAYS use `@lucide/svelte`. **Crucially, all icons MUST use the active theme's gradient color.** Do not use flat colors. 
To achieve this, define an SVG `<linearGradient>` (e.g., in your root layout) using the theme's CSS variables (`var(--color-primary)`, `var(--color-accent)`) and set the icon's stroke to `url(#theme-gradient)`. Alternatively, use CSS masking. Do not hallucinate SVG icons.

## UI Animations and Glow Effects

Never use `filter: blur()` for large glowing areas as it causes heavy repaints. Always use `box-shadow` or pre-blurred background elements.

### 3D Modals & Carousels (MANDATORY)
All modals, popups, and carousels MUST use 3D animations (e.g., flipping, tilting, depth scaling) to feel immersive. However, performance must not drop. Achieve this exclusively using native CSS 3D transforms (`perspective`, `rotateX`, `rotateY`, `scale`, `translateZ`) combined with `will-change: transform`. Do not use heavy JS physics for basic entrances. Example: a modal entrance should transition from `scale-95 rotate-x-12 opacity-0` to `scale-100 rotate-x-0 opacity-100`.

- **Homepage Hero Banner 3D Carousel (Minimum 4 Images)**: The homepage hero banner section MUST be an interactive 3D carousel slider featuring at least 4 images, utilizing GPU-accelerated 3D CSS transforms (like cube rotation, perspective flip, or coverflow) with smooth navigation transitions.
- **Minimum 5 Interactive 3D Carousels**: Svelte websites generated from scratch must contain at least 5 interactive 3D carousels (e.g., hero banner, category showcases, reviews, featured items, customer lookbooks).
- **Custom Styled SVG/CSS Logo**: All generated websites MUST feature a custom, premium logo in both the header and footer consisting of a styled inline SVG icon (utilizing the global theme gradient `stroke="url(#theme-gradient)"`) combined with custom CSS gradient typography (e.g. `bg-[image:var(--gradient-primary)] bg-clip-text text-transparent`). Never use text-only default placeholders or leave the logo empty.
- **Footer Watermark**: Newly generated websites MUST display the footer watermark: `Build with Antigravity and Konoha agentic AI` in small, muted typography.

- **Mobile Bottom Navigation**: In Svelte layouts, use a sticky bottom navigation bar with Lucide icons (e.g. `Home`, `ShoppingBag`, `ShoppingCart`, `User`) styled with theme variables (`bg-surface-elevated`, `text-text-secondary`, `text-brand`). Never use custom hardcoded SVG paths for icons. Add a Svelte 5 component like the example below:

```svelte
<!-- MobileBottomNav.svelte -->
<script lang="ts">
  import { Home, ShoppingBag, ShoppingCart, User } from 'lucide-svelte';
  let activeTab = $state('home');
</script>

<div class="fixed bottom-0 left-0 right-0 z-40 border-t border-border-subtle bg-surface-elevated/80 backdrop-blur-lg md:hidden h-16 shadow-lg">
  <div class="flex h-full items-center justify-around">
    <button onclick={() => activeTab = 'home'} class="flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all {activeTab === 'home' ? 'text-brand' : 'text-text-secondary'}">
      <Home size={20} />
      <span>Home</span>
    </button>
    <button onclick={() => activeTab = 'shop'} class="flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all {activeTab === 'shop' ? 'text-brand' : 'text-text-secondary'}">
      <ShoppingBag size={20} />
      <span>Shop</span>
    </button>
    <button onclick={() => activeTab = 'cart'} class="flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all {activeTab === 'cart' ? 'text-brand' : 'text-text-secondary'} relative">
      <ShoppingCart size={20} />
      <span>Cart</span>
      <span class="absolute -top-1 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white">3</span>
    </button>
    <button onclick={() => activeTab = 'profile'} class="flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all {activeTab === 'profile' ? 'text-brand' : 'text-text-secondary'}">
      <User size={20} />
      <span>Profile</span>
    </button>
  </div>
</div>
```

### Alert Dialogs
For all system alerts, warnings, and simple confirmation dialogs, ALWAYS use `sweetalert2`. You MUST customize the SweetAlert2 popup to use one of these **3 custom 3D entrance animations** and apply the active theme's gradient to its confirm buttons.

#### SweetAlert2 3D CSS Animations:
```css
/* app.css */
@keyframes swal2-3d-flip {
  0% { transform: perspective(1000px) rotateX(-80deg) scale(0.6); opacity: 0; }
  100% { transform: perspective(1000px) rotateX(0deg) scale(1); opacity: 1; }
}
.swal2-3d-flip {
  animation: swal2-3d-flip 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes swal2-3d-zoom {
  0% { transform: perspective(1000px) translateZ(-400px) scale(0.5); opacity: 0; }
  100% { transform: perspective(1000px) translateZ(0) scale(1); opacity: 1; }
}
.swal2-3d-zoom {
  animation: swal2-3d-zoom 0.45s cubic-bezier(0.25, 1, 0.5, 1) forwards;
}

@keyframes swal2-3d-slide-rotate {
  0% { transform: perspective(1000px) translateY(100px) rotateY(-25deg); opacity: 0; }
  100% { transform: perspective(1000px) translateY(0) rotateY(0deg); opacity: 1; }
}
.swal2-3d-slide-rotate {
  animation: swal2-3d-slide-rotate 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}
```

#### SweetAlert2 Usage with 3D Popups:
```ts
import Swal from 'sweetalert2';

Swal.fire({
  title: 'Success!',
  text: 'Theme changed successfully.',
  icon: 'success',
  showClass: {
    popup: 'swal2-3d-flip' // Choose from: swal2-3d-flip, swal2-3d-zoom, swal2-3d-slide-rotate
  },
  customClass: {
    popup: 'glass-panel border-border-subtle rounded-2xl p-6',
    confirmButton: 'px-6 py-2.5 bg-gradient-primary text-white rounded-full font-bold'
  }
});
```

### Pure CSS GPU-Accelerated Glow
To make glows dynamically match the user's chosen gradient theme, define the start and end colors inside each theme block in your CSS:

```css
/* app.css */
[data-theme="nebula"] {
  --color-glow-start: rgba(124, 58, 237, 0.25);
  --color-glow-end: rgba(79, 70, 229, 0);
  --color-brand: #7c3aed;
}
[data-theme="aurora"] {
  --color-glow-start: rgba(5, 150, 105, 0.25);
  --color-glow-end: rgba(8, 145, 178, 0);
  --color-brand: #059669;
}
[data-theme="sunset"] {
  --color-glow-start: rgba(225, 29, 72, 0.25);
  --color-glow-end: rgba(217, 119, 6, 0);
  --color-brand: #e11d48;
}
[data-theme="ocean"] {
  --color-glow-start: rgba(37, 99, 230, 0.25);
  --color-glow-end: rgba(13, 148, 136, 0);
  --color-brand: #2563eb;
}
[data-theme="forest"] {
  --color-glow-start: rgba(22, 163, 74, 0.25);
  --color-glow-end: rgba(5, 150, 105, 0);
  --color-brand: #16a34a;
}
[data-theme="volcano"] {
  --color-glow-start: rgba(220, 38, 38, 0.25);
  --color-glow-end: rgba(234, 88, 12, 0);
  --color-brand: #dc2626;
}
[data-theme="sakura"] {
  --color-glow-start: rgba(219, 39, 119, 0.25);
  --color-glow-end: rgba(225, 29, 72, 0);
  --color-brand: #db2777;
}
[data-theme="cyberpunk"] {
  --color-glow-start: rgba(192, 38, 211, 0.25);
  --color-glow-end: rgba(124, 58, 237, 0);
  --color-brand: #c026d3;
}
[data-theme="midnight"] {
  --color-glow-start: rgba(79, 70, 229, 0.25);
  --color-glow-end: rgba(71, 85, 105, 0);
  --color-brand: #4f46e5;
}
[data-theme="gold"] {
  --color-glow-start: rgba(217, 119, 6, 0.25);
  --color-glow-end: rgba(202, 138, 4, 0);
  --color-brand: #d97706;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px 0 var(--color-glow-start); }
  50%      { box-shadow: 0 0 20px 4px var(--color-glow-start); }
}

@utility animate-pulse-glow {
  animation: pulse-glow 2s ease-in-out infinite;
}

@utility glow-hover {
  position: relative;
  overflow: hidden;
  
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(
      circle 150px at var(--mouse-x, 50%) var(--mouse-y, 50%),
      var(--color-glow-start) 0%,
      var(--color-glow-end) 100%
    );
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }
  
  &:hover::after {
    opacity: 1;
  }
}
```

```svelte
<!-- Usage -->
<div 
  onmousemove={handleMouseMove}
  class="group rounded-2xl border border-zinc-200/80 p-6 glow-hover bg-white/70 backdrop-blur-md"
  role="presentation"
>
  <h3 class="text-xl font-semibold text-zinc-800">Feature</h3>
  <button class="animate-pulse-glow" aria-label="Action">Click me</button>
</div>
```

### Performance & Theme Rules for Glows
- Max 2-3 animated glow elements per viewport.
- No `backdrop-filter` stacking.
- Respect `prefers-reduced-motion` to disable animations.
- **Theme-Aware Colors**: All glow effects and 3D animations MUST dynamically use the CSS variables (e.g., `var(--color-glow)`, `var(--color-brand)`) so their colors perfectly match the active theme. If rendering to canvas (e.g., Three.js), read the CSS variable via `getComputedStyle` and subscribe to theme changes.

## Component Quality Checklist

- [ ] Props typed with sensible defaults
- [ ] Accepts `class` prop for style overrides via `cn()`
- [ ] Works with keyboard navigation (Tab, Enter)
- [ ] Handles empty / loading / error states
- [ ] Responsive at mobile / tablet / desktop breakpoints
- [ ] No horizontal overflow on mobile
- [ ] Focus states visible (`focus-visible:ring-2`)
- [ ] Theme tokens used (not hardcoded hex colors)
- [ ] Glow effects use `box-shadow`, not `filter: blur()`

## Floating Theme Switcher Component (Svelte 5 Runes)

Below is the Svelte 5 Rune floating chat-like theme switcher popup component code template. Builders can copy-paste it directly to newly generated websites. It floats in the bottom-right corner as a chat-like bubble, expands into a theme choice menu with a 3D entrance transition, and saves the theme selection to `localStorage`.

```svelte
<!-- ThemeSwitcher.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Paintbrush, X, Check } from 'lucide-svelte';

  // Available gradient themes
  const themes = [
    { id: 'nebula', name: 'Nebula', gradient: 'from-[#7c3aed] to-[#4f46e5]' },
    { id: 'aurora', name: 'Aurora', gradient: 'from-[#10b981] to-[#06b6d4]' },
    { id: 'sunset', name: 'Sunset', gradient: 'from-[#f43f5e] to-[#f59e0b]' },
    { id: 'ocean', name: 'Ocean', gradient: 'from-[#3b82f6] to-[#14b8a6]' },
    { id: 'forest', name: 'Forest', gradient: 'from-[#22c55e] to-[#10b981]' },
    { id: 'volcano', name: 'Volcano', gradient: 'from-[#ef4444] to-[#f97316]' },
    { id: 'sakura', name: 'Sakura', gradient: 'from-[#ec4899] to-[#f43f5e]' },
    { id: 'cyberpunk', name: 'Cyberpunk', gradient: 'from-[#d946ef] to-[#8b5cf6]' },
    { id: 'midnight', name: 'Midnight', gradient: 'from-[#6366f1] to-[#475569]' },
    { id: 'gold', name: 'Gold', gradient: 'from-[#f59e0b] to-[#eab308]' }
  ];

  let isOpen = $state(false);
  let activeTheme = $state('nebula');

  onMount(() => {
    const saved = localStorage.getItem('theme') || 'nebula';
    activeTheme = saved;
    document.documentElement.setAttribute('data-theme', saved);
  });

  function setTheme(themeId: string) {
    activeTheme = themeId;
    localStorage.setItem('theme', themeId);
    document.documentElement.setAttribute('data-theme', themeId);
  }

  function toggleOpen() {
    isOpen = !isOpen;
  }
</script>

<div class="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 font-sans">
  {#if isOpen}
    <!-- 3D Entrance Dropup Menu -->
    <div 
      class="w-64 origin-bottom-right rounded-2xl border border-zinc-200/80 bg-white/90 p-4 shadow-2xl shadow-zinc-300/50 backdrop-blur-xl transition-all duration-300 ease-out will-change-transform"
      style:transform={isOpen ? 'perspective(500px) rotateX(0deg) scale(1)' : 'perspective(500px) rotateX(15deg) scale(0.9) translateY(10px)'}
      style:opacity={isOpen ? '1' : '0'}
    >
      <div class="mb-3 flex items-center justify-between border-b border-zinc-100 pb-2">
        <span class="text-sm font-semibold text-zinc-800">Customize Theme</span>
        <button 
          onclick={toggleOpen} 
          class="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
          aria-label="Close theme menu"
        >
          <X size={16} />
        </button>
      </div>

      <div class="grid gap-2">
        {#each themes as theme}
          <button
            onclick={() => setTheme(theme.id)}
            class="flex items-center justify-between rounded-xl border p-2 text-left transition-all hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-brand/50 {activeTheme === theme.id ? 'border-zinc-300 bg-zinc-50' : 'border-transparent'}"
          >
            <div class="flex items-center gap-3">
              <div class="h-6 w-6 rounded-full bg-gradient-to-br {theme.gradient} shadow-sm"></div>
              <span class="text-sm font-medium text-zinc-700">{theme.name}</span>
            </div>
            {#if activeTheme === theme.id}
              <Check size={16} class="text-zinc-600" />
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Toggle Button (Floating Chat Bubble Style) -->
  <button
    onclick={toggleOpen}
    class="flex h-14 w-14 items-center justify-center rounded-full bg-[image:var(--gradient-primary)] text-white shadow-lg shadow-zinc-300/50 transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
    aria-label="Toggle theme settings"
  >
    {#if isOpen}
      <X size={24} class="transition-transform duration-300 rotate-90" />
    {:else}
      <Paintbrush size={24} class="transition-transform duration-300 hover:rotate-12" />
    {/if}
  </button>
</div>
```
## SvelteKit Category SPA Routing (Zero-Reload Page Filters)
Instead of relying on server-side search params (e.g., `?category=outerwear`) which trigger unnecessary refetches/reload states, SvelteKit applications should use SPA routing parameters inside optional dynamic segments: `src/routes/shop/[[category]]/+page.svelte`.

1. **State Derivation**: Derive the active filter directly from SvelteKit's page params. This keeps selection states in sync with URLs automatically:
```typescript
import { page } from '$app/state';
let selectedCategory = $derived(page.params.category || 'all');
```
2. **Anchor Navigation**: Use native `<a>` elements for category buttons to leverage SvelteKit's client-side prefetching and navigation:
```html
<a href={category === 'all' ? '/shop' : `/shop/${category}`} class={selectedCategory === category ? 'text-active font-bold' : ''}>
  {category}
</a>
```
3. **Reset Filters**: To clear navigation-based filters, use SvelteKit's `goto` router:
```typescript
import { goto } from '$app/navigation';
function resetFilters() {
  goto('/shop');
}
```

## 3D Interactive Carousel Component (Svelte 5 Runes)

Below is the Svelte 5 Rune interactive 3D carousel component code template. Builders can copy-paste it directly to newly generated websites. It positions cards in a 3D circle/ring, supports click-to-center with shortest-path rotation, touch/mouse dragging, autoplay with progress bar, and active theme dynamic hover glows.

```svelte
<!-- ThreeDCarousel.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ChevronLeft, ChevronRight, Play, Pause, ExternalLink } from 'lucide-svelte';
  import { cn } from '$lib/utils'; // Adjust path as needed

  let {
    items: rawItems = [], // Array of { id, image, title, category, description, link, price }
    autoplay = true,
    interval = 5000,
    class: className = ''
  }: {
    items: Array<{
      id: number;
      image: string;
      title: string;
      category: string;
      description: string;
      link: string;
      price?: string;
    }>;
    autoplay?: boolean;
    interval?: number;
    class?: string;
  } = $props();

  // Duplicate items if N < 6 to prevent side items from becoming edge-on (sideways) and invisible in 3D circle
  const items = $derived.by(() => {
    let list = [...rawItems];
    if (list.length === 0) return [];
    while (list.length < 6) {
      list = [...list, ...rawItems];
    }
    return list;
  });

  const N = $derived(items.length);
  const theta = $derived(360 / N);
  const radius = 280; // transform translateZ distance

  // Runes State
  let activeIndex = $state(0);
  let rotationAngle = $state(0);
  let isAutoplayActive = $state(autoplay);
  let touchStartX = $state(0);
  let touchEndX = $state(0);
  let isHovered = $state(false);
  let tiltX = $state(0);
  let tiltY = $state(0);

  let autoplayTimer: any;

  function rotateTo(index: number) {
    let diff = index - activeIndex;
    if (diff > N / 2) diff -= N;
    if (diff < -N / 2) diff += N;
    rotationAngle -= diff * theta;
    activeIndex = (index + N) % N;
  }

  function handleNext() {
    rotationAngle -= theta;
    activeIndex = (activeIndex + 1) % N;
  }

  function handlePrev() {
    rotationAngle += theta;
    activeIndex = (activeIndex - 1 + N) % N;
  }

  function startAutoplay() {
    stopAutoplay();
    if (isAutoplayActive) {
      autoplayTimer = setInterval(() => {
        if (!isHovered) handleNext();
      }, interval);
    }
  }

  function stopAutoplay() {
    if (autoplayTimer) clearInterval(autoplayTimer);
  }

  function toggleAutoplay() {
    isAutoplayActive = !isAutoplayActive;
    if (isAutoplayActive) startAutoplay();
    else stopAutoplay();
  }

  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
  }

  function handleTouchEnd(e: TouchEvent) {
    touchEndX = e.changedTouches[0].clientX;
    const swipeThreshold = 50;
    if (touchStartX - touchEndX > swipeThreshold) handleNext();
    else if (touchEndX - touchStartX > swipeThreshold) handlePrev();
  }

  // Active Card 3D Tilt on Mouse Move
  function handleMouseMove(e: MouseEvent, isActive: boolean) {
    if (!isActive) return;
    const target = e.currentTarget as HTMLElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const px = x / rect.width - 0.5;
    const py = y / rect.height - 0.5;
    tiltX = -py * 12; // Max 12 deg tilt
    tiltY = px * 12;
  }

  function handleMouseLeave() {
    tiltX = 0;
    tiltY = 0;
  }

  onMount(() => {
    startAutoplay();
    return () => stopAutoplay();
  });

  $effect(() => {
    startAutoplay();
  });
</script>

<div 
  class={cn("relative w-full overflow-hidden bg-zinc-950 py-16 px-4 flex flex-col items-center justify-center min-h-[580px] select-none", className)}
  onmouseenter={() => isHovered = true}
  onmouseleave={() => isHovered = false}
>
  <!-- 3D Perspective Scene Container -->
  <div 
    class="relative w-full max-w-[800px] h-[380px] flex items-center justify-center perspective-[1200px]"
    ontouchstart={handleTouchStart}
    ontouchend={handleTouchEnd}
  >
    <!-- Rotating Stage -->
    <div 
      class="relative w-[280px] h-[350px] transform-3d transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      style:transform="rotateY({rotationAngle}deg)"
    >
      {#each items as item, i}
        {@const isActive = i === activeIndex}
        <button
          type="button"
          class={cn(
            "absolute inset-0 w-full h-full rounded-xl overflow-hidden border transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] cursor-pointer text-left transform-3d shadow-2xl focus:outline-none",
            isActive 
              ? "border-brand/40 opacity-100 scale-100 z-30 shadow-brand/20" 
              : "border-zinc-800/80 opacity-50 scale-90 z-10 shadow-black/50"
          )}
          style:transform="rotateY({i * theta}deg) translateZ({radius}px) {isActive ? `rotateX(${tiltX}deg) rotateY(${tiltY}deg)` : ''}"
          style:filter={isActive ? 'none' : 'brightness(0.55) blur(1.5px)'}
          onclick={() => rotateTo(i)}
          onmousemove={(e) => handleMouseMove(e, isActive)}
          onmouseleave={handleMouseLeave}
        >
          <div class="relative w-full h-full">
            <img src={item.image} alt={item.title} class="w-full h-full object-cover" />
            <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/35 to-transparent"></div>
            
            <span class="absolute top-4 left-4 px-2 py-0.5 text-[9px] font-semibold tracking-widest uppercase bg-zinc-950/70 border border-zinc-800/50 text-brand rounded-sm backdrop-blur-sm">
              {item.category}
            </span>

            <div class="absolute bottom-0 left-0 right-0 p-5 space-y-1">
              <h3 class="font-serif text-lg font-semibold text-white tracking-wide leading-tight">
                {item.title}
              </h3>
              {#if item.price}
                <p class="text-[10px] text-brand font-bold tracking-widest">{item.price}</p>
              {/if}
            </div>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- Description Panel -->
  <div class="relative w-full max-w-md mx-auto mt-6 text-center space-y-2 h-24">
    <span class="text-[10px] font-bold tracking-widest text-brand uppercase">
      {items[activeIndex]?.category}
    </span>
    <h3 class="font-serif text-xl font-medium text-white">
      {items[activeIndex]?.title}
    </h3>
    <p class="text-xs text-zinc-400 font-light leading-relaxed max-w-sm mx-auto">
      {items[activeIndex]?.description}
    </p>
  </div>

  <!-- Controls -->
  <div class="flex items-center justify-center gap-6 mt-4">
    <button onclick={handlePrev} class="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95">
      <ChevronLeft size={16} />
    </button>
    <button onclick={toggleAutoplay} class="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95">
      {#if isAutoplayActive}<Pause size={12} />{:else}<Play size={12} />{/if}
    </button>
    <button onclick={handleNext} class="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95">
      <ChevronRight size={16} />
    </button>
  </div>
</div>

<style>
  .transform-3d { transform-style: preserve-3d; }
</style>
```

## Click-to-Toggle Theme Dropdown Selector (with Backdrop)
Instead of CSS-based hover dropdown triggers (which fail or feel clunky on mobile devices), use a Svelte 5 click-to-toggle dropdown trigger combined with a full-screen dismissible backdrop:

```svelte
<script lang="ts">
  let isThemeMenuOpen = $state(false);
  let activeGradient = $state('gold');

  function setGradientTheme(name: string) {
    activeGradient = name;
    localStorage.setItem('gradient-theme', name);
    // document.documentElement adjustments...
    isThemeMenuOpen = false;
  }
</script>

<div class="relative">
  <button type="button" onclick={() => (isThemeMenuOpen = !isThemeMenuOpen)} class="relative z-50">
    <!-- Trigger Icon/Text -->
  </button>

  {#if isThemeMenuOpen}
    <!-- Backdrop dismisser -->
    <div class="fixed inset-0 z-40 cursor-default" onclick={() => (isThemeMenuOpen = false)}></div>

    <!-- Dropdown Content -->
    <div class="absolute right-0 mt-2 w-48 rounded-lg border border-border-subtle bg-surface-elevated/95 backdrop-blur-md shadow-xl py-2 px-1 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
      <button onclick={() => setGradientTheme('gold')}>Aurum Gold</button>
      <!-- More buttons... -->
    </div>
  {/if}
</div>
```

## Interactive Autoplay Hero Banner Carousel
Below is a code template for a 4-image autoplaying, interactive crossfading banner carousel in Svelte 5. It manages active indices, timer resets upon user clicks, glassmorphic floating arrows, and indicator dots:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-svelte';

  let currentBannerIndex = $state(0);
  let autoplayInterval: any;

  const banners = [
    { image: 'url1', tag: 'Tag 1', title: 'Line 1<br />Line 2', desc: 'Desc 1', btnLink: '/url' },
    // ... 4 banners
  ];

  function startAutoplay() {
    stopAutoplay();
    autoplayInterval = setInterval(() => {
      currentBannerIndex = (currentBannerIndex + 1) % banners.length;
    }, 6000);
  }

  function stopAutoplay() {
    if (autoplayInterval) clearInterval(autoplayInterval);
  }

  function nextBanner() {
    currentBannerIndex = (currentBannerIndex + 1) % banners.length;
    startAutoplay();
  }

  function prevBanner() {
    currentBannerIndex = (currentBannerIndex - 1 + banners.length) % banners.length;
    startAutoplay();
  }

  onMount(() => {
    startAutoplay();
    return () => stopAutoplay();
  });
</script>

<!-- MUST be full-width on desktop view (edge-to-edge of the viewport without margins or layout constraints) -->
<section class="relative h-[85vh] w-full w-screen left-1/2 right-1/2 -translate-x-1/2 flex items-center justify-center bg-zinc-900 overflow-hidden">
  <!-- Overlay grid for crossfades -->
  <div class="absolute inset-0 z-0 grid grid-cols-1 grid-rows-1 w-full h-full">
    {#key currentBannerIndex}
      <div class="col-start-1 row-start-1 w-full h-full" in:fade={{ duration: 600 }}>
        <img src={banners[currentBannerIndex].image} alt="Banner" class="w-full h-full object-cover opacity-60 scale-105 animate-[zoom-in_40s_infinite_linear]" />
        <div class="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-zinc-950/20"></div>
      </div>
    {/key}
  </div>

  <!-- Content Grid Overlay -->
  <div class="relative z-10 w-full max-w-5xl text-center grid grid-cols-1 grid-rows-1 justify-items-center">
    {#key currentBannerIndex}
      <div class="col-start-1 row-start-1 flex flex-col items-center space-y-6 w-full animate-in fade-in" in:fade={{ duration: 600 }}>
        <span class="text-xs uppercase tracking-[0.4em] font-semibold text-brand">{banners[currentBannerIndex].tag}</span>
        <h1 class="font-serif text-4xl sm:text-6xl text-white">{@html banners[currentBannerIndex].title}</h1>
        <p class="max-w-xl text-zinc-300">{banners[currentBannerIndex].desc}</p>
      </div>
    {/key}
  </div>

  <!-- Arrows & Dots -->
  <button type="button" class="absolute left-4 z-20 p-3 rounded-full border border-white/10 bg-black/20 text-white backdrop-blur-md" onclick={prevBanner}><ChevronLeft size={20} /></button>
  <button type="button" class="absolute right-4 z-20 p-3 rounded-full border border-white/10 bg-black/20 text-white backdrop-blur-md" onclick={nextBanner}><ChevronRight size={20} /></button>
</section>
```

## 3D Interactive Carousel Component (Svelte 5 Runes)

Below is the Svelte 5 Rune equivalent of the interactive 3D carousel component. It positions cards in a 3D circle/ring, supports click-to-center with shortest-path rotation, touch/mouse dragging, autoplay, active card mouse-tracking 3D tilt, and active theme dynamic hover glows.

```svelte
<!-- ThreeDCarousel.svelte -->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ChevronLeft, ChevronRight, Play, Pause } from 'lucide-svelte';

  interface CarouselItem {
    id: number;
    image: string;
    title: string;
    category: string;
    description: string;
    link: string;
    price?: string;
  }

  let { 
    items: rawItems = [], 
    autoplay = true, 
    interval = 5000, 
    class: className = '' 
  }: { 
    items: CarouselItem[]; 
    autoplay?: boolean; 
    interval?: number; 
    class?: string; 
  } = $props();

  // Duplicate items if N < 6 to prevent edge-on visibility issues in 3D circular ring
  let items = $derived.by(() => {
    let list = [...rawItems];
    if (list.length === 0) return [];
    while (list.length < 6) {
      list = [...list, ...rawItems];
    }
    return list;
  });

  let N = $derived(items.length);
  let theta = $derived(360 / (N || 1));
  const radius = 280;

  // Reactive states
  let activeIndex = $state(0);
  let rotationAngle = $state(0);
  let isAutoplayActive = $state(autoplay);
  let touchStartX = $state(0);
  let isHovered = $state(false);
  let tiltX = $state(0);
  let tiltY = $state(0);

  let activeOriginalIndex = $derived(activeIndex % (rawItems.length || 1));

  let intervalId: any;

  function rotateTo(index: number) {
    let diff = index - activeIndex;
    if (diff > N / 2) diff -= N;
    if (diff < -N / 2) diff += N;
    rotationAngle -= diff * theta;
    activeIndex = (index + N) % N;
  }

  function handleNext() {
    rotationAngle -= theta;
    activeIndex = (activeIndex + 1) % N;
  }

  function handlePrev() {
    rotationAngle += theta;
    activeIndex = (activeIndex - 1 + N) % N;
  }

  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
  }

  function handleTouchEnd(e: TouchEvent) {
    const swipeThreshold = 50;
    const endX = e.changedTouches[0].clientX;
    if (touchStartX - endX > swipeThreshold) handleNext();
    else if (endX - touchStartX > swipeThreshold) handlePrev();
  }

  function handleMouseMove(e: MouseEvent, isActive: boolean) {
    if (!isActive) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const px = x / rect.width - 0.5;
    const py = y / rect.height - 0.5;
    tiltX = -py * 12; // Max 12 deg tilt
    tiltY = px * 12;
  }

  function handleMouseLeave() {
    tiltX = 0;
    tiltY = 0;
  }

  function startAutoplay() {
    stopAutoplay();
    if (isAutoplayActive && !isHovered) {
      intervalId = setInterval(handleNext, interval);
    }
  }

  function stopAutoplay() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  $effect(() => {
    startAutoplay();
    return stopAutoplay;
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  class="relative w-full overflow-hidden bg-zinc-950 py-16 px-4 flex flex-col items-center justify-center min-h-[580px] select-none {className}"
  onmouseenter={() => isHovered = true}
  onmouseleave={() => { isHovered = false; handleMouseLeave(); }}
>
  <!-- 3D Perspective Scene Container -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div 
    class="relative w-full max-w-[800px] h-[380px] flex items-center justify-center"
    style="perspective: 1200px;"
    ontouchstart={handleTouchStart}
    ontouchend={handleTouchEnd}
  >
    <!-- Rotating Stage -->
    <div 
      class="relative w-[280px] h-[350px] transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      style="transform-style: preserve-3d; transform: rotateY({rotationAngle}deg);"
    >
      {#each items as item, i (i)}
        {@const isActive = i === activeIndex}
        <button
          type="button"
          class="absolute inset-0 w-full h-full rounded-xl overflow-hidden border transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] cursor-pointer text-left shadow-2xl focus:outline-none
            {isActive ? 'border-brand/40 opacity-100 scale-100 z-30 shadow-brand/20' : 'border-zinc-800/80 opacity-50 scale-90 z-10 shadow-black/50'}"
          style="transform-style: preserve-3d; transform: rotateY({i * theta}deg) translateZ({radius}px) {isActive ? `rotateX(${tiltX}deg) rotateY(${tiltY}deg)` : ''}; filter: {isActive ? 'none' : 'brightness(0.55) blur(1.5px)'};"
          onclick={() => rotateTo(i)}
          onmousemove={(e) => handleMouseMove(e, isActive)}
          onmouseleave={handleMouseLeave}
        >
          <div class="relative w-full h-full">
            <img src={item.image} alt={item.title} class="w-full h-full object-cover" />
            <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/35 to-transparent"></div>
            
            <span class="absolute top-4 left-4 px-2 py-0.5 text-[9px] font-semibold tracking-widest uppercase bg-zinc-950/70 border border-zinc-800/50 text-brand rounded-sm backdrop-blur-sm">
              {item.category}
            </span>

            <div class="absolute bottom-0 left-0 right-0 p-5 space-y-1">
              <h3 class="font-serif text-lg font-semibold text-white tracking-wide leading-tight">
                {item.title}
              </h3>
              {#if item.price}
                <p class="text-[10px] text-brand font-bold tracking-widest">{item.price}</p>
              {/if}
            </div>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- Description Panel -->
  <div class="relative w-full max-w-md mx-auto mt-6 text-center space-y-2 h-24">
    {#if rawItems[activeOriginalIndex]}
      <span class="text-[10px] font-bold tracking-widest text-brand uppercase">
        {rawItems[activeOriginalIndex].category}
      </span>
      <h3 class="font-serif text-xl font-medium text-white">
        {rawItems[activeOriginalIndex].title}
      </h3>
      <p class="text-xs text-zinc-400 font-light leading-relaxed max-w-sm mx-auto">
        {rawItems[activeOriginalIndex].description}
      </p>
    {/if}
  </div>

  <!-- Controls -->
  <div class="flex items-center justify-center gap-6 mt-4">
    <button onclick={handlePrev} class="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95" aria-label="Previous card">
      <ChevronLeft size={16} />
    </button>
    <button onclick={() => isAutoplayActive = !isAutoplayActive} class="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95" aria-label={isAutoplayActive ? 'Pause autoplay' : 'Start autoplay'}>
      {#if isAutoplayActive}
        <Pause size={12} />
      {:else}
        <Play size={12} />
      {/if}
    </button>
    <button onclick={handleNext} class="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95" aria-label="Next card">
      <ChevronRight size={16} />
    </button>
  </div>
</div>
```
```

