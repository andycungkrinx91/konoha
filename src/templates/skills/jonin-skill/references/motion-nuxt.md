---
name: motion-nuxt
description: Verified Motion implementation reference for Nuxt 4 and Vue 3.5 — declarative motion-v components, imperative motion JS API (animate, scroll, inView, stagger, spring), SSR-safe lifecycle hooks, and reduced-motion accessibility.
tags:
  - motion
  - nuxt
  - vue-3
  - motion-v
  - animation
---

# Motion for Nuxt 4 & Vue 3.5 (`motion-v` & `motion` JS API)

Use this reference for all **Nuxt 4 / Vue 3.5** builds. Vue and Nuxt projects combine the declarative `motion-v` component suite (`<Motion>`, `<AnimatePresence>`) with the official `motion` JS engine (`animate`, `inView`, `scroll`, `stagger`, `spring`) for zero-overhead DOM and SVG choreography.

## 1. Installation & SSR Safety

```bash
rtk pnpm add motion motion-v --silent
```

- **SSR & Hydration Guard**: Always run imperative `animate()`, `inView()`, and `scroll()` calls inside `onMounted()` and clean up returned controls inside `onBeforeUnmount()` so SSR HTML and client hydration match 100%.

---

## 2. Declarative Hero & Staggered Cards with `motion-v`

```vue
<script setup lang="ts">
import { Motion, AnimatePresence } from 'motion-v';
import { ref } from 'vue';

interface MetricCard {
  id: string;
  label: string;
  value: string;
  delta: string;
}

defineProps<{
  eyebrow: string;
  title: string;
  subtitle: string;
  metrics: MetricCard[];
}>();

const activeId = ref<string | null>(null);
</script>

<template>
  <section class="relative min-h-[100dvh] flex flex-col justify-center py-24 px-6">
    <Motion
      as="span"
      :initial="{ opacity: 0, y: 16 }"
      :animate="{ opacity: 1, y: 0 }"
      :transition="{ type: 'spring', stiffness: 300, damping: 24 }"
      class="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--accent-primary)]"
    >
      {{ eyebrow }}
    </Motion>

    <Motion
      as="h1"
      :initial="{ opacity: 0, y: 24 }"
      :animate="{ opacity: 1, y: 0 }"
      :transition="{ type: 'spring', stiffness: 260, damping: 24, delay: 0.08 }"
      class="mt-4 text-5xl md:text-7xl font-semibold tracking-tight text-[var(--text-primary)]"
    >
      {{ title }}
    </Motion>

    <Motion
      as="p"
      :initial="{ opacity: 0, y: 20 }"
      :animate="{ opacity: 1, y: 0 }"
      :transition="{ type: 'spring', stiffness: 260, damping: 24, delay: 0.16 }"
      class="mt-6 max-w-2xl text-lg text-[var(--text-muted)]"
    >
      {{ subtitle }}
    </Motion>

    <div class="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
      <Motion
        v-for="(item, idx) in metrics"
        :key="item.id"
        as="article"
        :initial="{ opacity: 0, y: 24, scale: 0.97 }"
        :animate="{ opacity: 1, y: 0, scale: 1 }"
        :while-hover="{ y: -5, scale: 1.015 }"
        :while-tap="{ scale: 0.985 }"
        :transition="{ type: 'spring', stiffness: 320, damping: 25, delay: 0.2 + idx * 0.07 }"
        class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 cursor-pointer"
        @click="activeId = activeId === item.id ? null : item.id"
      >
        <div class="flex items-center justify-between text-xs uppercase tracking-wider text-[var(--text-muted)]">
          <span>{{ item.label }}</span>
          <span class="font-mono text-[var(--accent-primary)]">{{ item.delta }}</span>
        </div>
        <div class="mt-3 text-3xl font-semibold font-mono text-[var(--text-primary)]">
          {{ item.value }}
        </div>
        <AnimatePresence>
          <Motion
            v-if="activeId === item.id"
            as="div"
            :initial="{ opacity: 0, height: 0 }"
            :animate="{ opacity: 1, height: 'auto' }"
            :exit="{ opacity: 0, height: 0 }"
            class="mt-3 pt-3 border-t border-[var(--border-subtle)] text-xs text-[var(--text-muted)]"
          >
            Live telemetry synchronized.
          </Motion>
        </AnimatePresence>
      </Motion>
    </div>
  </section>
</template>
```

---

## 3. Imperative Scroll & InView Choreography with `motion` JS API

```ts
// composables/useMotionReveal.ts
import { onMounted, onBeforeUnmount, type Ref } from 'vue';
import { animate, inView, stagger, spring } from 'motion';

export function useMotionReveal(containerRef: Ref<HTMLElement | null>, selector = '[data-motion-item]') {
  let stopInView: (() => void) | null = null;

  onMounted(() => {
    if (!containerRef.value || typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    stopInView = inView(
      containerRef.value,
      (element) => {
        const items = element.querySelectorAll<HTMLElement>(selector);
        if (!items.length) return;
        const controls = animate(
          items,
          { opacity: [0, 1], transform: ['translateY(24px)', 'translateY(0px)'] },
          { type: spring, stiffness: 280, damping: 24, delay: stagger(0.08) }
        );
        return () => controls.stop();
      },
      { amount: 0.2 }
    );
  });

  onBeforeUnmount(() => {
    if (stopInView) stopInView();
  });
}
```
