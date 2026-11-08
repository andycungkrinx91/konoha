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
rtk pnpm add motion motion-v three @types/three @tresjs/core --silent
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

---

## 4. Interactive 3D Stage in Nuxt 4 (`@tresjs/core` / `three` + Custom Shaders & Particles)

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as THREE from 'three';

const canvasRef = ref<HTMLCanvasElement | null>(null);
let cleanupFn: (() => void) | null = null;

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas || typeof window === 'undefined') return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || 640, canvas.clientHeight || 400, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, (canvas.clientWidth || 640) / (canvas.clientHeight || 400), 0.1, 100);
  camera.position.set(0, 0.3, 4.2);

  const ambient = new THREE.AmbientLight(0x38bdf8, 0.7);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(3, 4, 5);
  scene.add(ambient, keyLight);

  const torusGeo = new THREE.TorusKnotGeometry(0.85, 0.26, 128, 32);
  const shaderMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPointer: { value: new THREE.Vector2(0, 0) } },
    vertexShader: `
      uniform float uTime;
      varying vec3 vNormal;
      void main() {
        vNormal = normalMatrix * normal;
        vec3 p = position + normal * sin(uTime * 2.0 + position.x * 3.0) * 0.05;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.0);
        gl_FragColor = vec4(mix(vec3(0.06, 0.52, 0.84), vec3(0.56, 0.9, 1.0), rim), 0.94);
      }
    `,
    transparent: true
  });
  const mesh = new THREE.Mesh(torusGeo, shaderMat);
  scene.add(mesh);

  const pts = new Float32Array(240 * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * 7;
  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const ptMat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.035 });
  const cloud = new THREE.Points(ptGeo, ptMat);
  scene.add(cloud);

  let raf = 0;
  const tick = (t: number) => {
    shaderMat.uniforms.uTime.value = t * 0.001;
    if (!reduced) {
      mesh.rotation.y += 0.006;
      mesh.rotation.x += 0.003;
      cloud.rotation.y -= 0.0015;
    }
    renderer.render(scene, camera);
    if (!reduced) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  cleanupFn = () => {
    cancelAnimationFrame(raf);
    torusGeo.dispose();
    shaderMat.dispose();
    ptGeo.dispose();
    ptMat.dispose();
    renderer.dispose();
  };
});

onBeforeUnmount(() => {
  if (cleanupFn) cleanupFn();
});
</script>

<template>
  <ClientOnly>
    <div class="relative w-full h-[400px] rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-slate-950">
      <canvas ref="canvasRef" data-3d-stage="true" class="w-full h-full block" />
    </div>
  </ClientOnly>
</template>
```
