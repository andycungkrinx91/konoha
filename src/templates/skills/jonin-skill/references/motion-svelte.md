---
name: motion-svelte
description: Verified Motion implementation reference for SvelteKit 2 and Svelte 5 (Runes) — combining svelte/motion class primitives (Spring, Tween) with the official motion JS API (animate, inView, scroll, stagger, spring) for interactive canvases, docks, and metric cards.
tags:
  - motion
  - sveltekit
  - svelte-5
  - runes
  - spring
  - animation
---

# Motion for SvelteKit 2 & Svelte 5 (`svelte/motion` + `motion` JS API)

Use this reference for all **SvelteKit 2 + Svelte 5 (Runes)** builds, including Konoha's own Web UI. Svelte 5.8+ provides reactive class-based physics primitives (`Spring` and `Tween` from `'svelte/motion'`) that pair directly with `$state`/`$derived` Runes and the official `'motion'` WAAPI engine (`animate`, `inView`, `scroll`, `stagger`, `spring`).

## 1. Installation & Imports

```bash
rtk pnpm add motion three @types/three @threlte/core @threlte/extras --silent
```

```ts
import { Spring, Tween } from 'svelte/motion';
import { cubicOut } from 'svelte/easing';
import { animate, inView, scroll, stagger, spring } from 'motion';
```

---

## 2. Reusable Svelte 5 Motion Action (`use:motionReveal` & `use:motionCard`)

```ts
// src/lib/motion.ts
import { animate, inView, stagger, spring } from 'motion';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionReveal(
  node: HTMLElement,
  options: { delay?: number; y?: number; staggerSelector?: string } = {}
) {
  if (prefersReducedMotion()) {
    node.style.opacity = '1';
    return {};
  }

  const yOffset = options.y ?? 20;
  const delay = options.delay ?? 0;

  const stop = inView(
    node,
    () => {
      if (options.staggerSelector) {
        const children = node.querySelectorAll<HTMLElement>(options.staggerSelector);
        if (children.length > 0) {
          const ctrl = animate(
            children,
            { opacity: [0, 1], transform: [`translateY(${yOffset}px)`, 'translateY(0px)'] },
            { type: spring, stiffness: 280, damping: 24, delay: stagger(0.06, { startDelay: delay }) }
          );
          return () => ctrl.stop();
        }
      }
      const ctrl = animate(
        node,
        { opacity: [0, 1], transform: [`translateY(${yOffset}px) scale(0.985)`, 'translateY(0px) scale(1)'] },
        { type: spring, stiffness: 280, damping: 24, delay }
      );
      return () => ctrl.stop();
    },
    { amount: 0.15 }
  );

  return {
    destroy() {
      stop();
    }
  };
}
```

---

## 3. Svelte 5 `Spring` Interactive Metric Card & Spider Flip Physics

```svelte
<script lang="ts">
  import { Spring } from 'svelte/motion';

  let { label, value, delta = '' } = $props<{ label: string; value: string; delta?: string }>();

  const tilt = new Spring({ x: 0, y: 0, scale: 1 }, { stiffness: 0.18, damping: 0.72 });

  function onPointerMove(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    tilt.target = { x: -ny * 8, y: nx * 8, scale: 1.015 };
  }

  function onPointerLeave() {
    tilt.target = { x: 0, y: 0, scale: 1 };
  }
</script>

<article
  onpointermove={onPointerMove}
  onpointerleave={onPointerLeave}
  style="transform: perspective(1200px) rotateX({tilt.current.x}deg) rotateY({tilt.current.y}deg) scale({tilt.current.scale});"
  class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 transition-shadow duration-300"
>
  <div class="flex items-center justify-between text-xs uppercase tracking-wider text-[var(--text-muted)]">
    <span>{label}</span>
    {#if delta}
      <span class="font-mono text-[var(--accent-primary)]">{delta}</span>
    {/if}
  </div>
  <div class="mt-3 text-3xl font-semibold font-mono text-[var(--text-primary)]">{value}</div>
</article>
```

---

## 4. Bottom Dock Gaussian Spring Magnification in Svelte 5

```svelte
<script lang="ts">
  import { Spring } from 'svelte/motion';

  interface DockItem {
    id: string;
    label: string;
    path: string;
  }

  let { items = [], activePath = '' } = $props<{ items: DockItem[]; activePath: string }>();
  let pointerX = $state<number | null>(null);
  let itemRefs: (HTMLElement | null)[] = [];

  const hoverScale = new Spring(1, { stiffness: 0.22, damping: 0.68 });

  function computeScale(idx: number): number {
    if (pointerX === null || !itemRefs[idx]) return 1;
    const rect = itemRefs[idx]!.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const dist = Math.abs(pointerX - center);
    return 1 + 0.22 * Math.exp(-(dist * dist) / (2 * 64 * 64));
  }
</script>

<nav
  aria-label="Operational dock"
  onpointermove={(e) => { pointerX = e.clientX; hoverScale.target = 1.02; }}
  onpointerleave={() => { pointerX = null; hoverScale.target = 1; }}
  class="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/85 backdrop-blur-xl px-3 py-2 shadow-2xl"
>
  {#each items as item, idx (item.id)}
    {@const scale = computeScale(idx)}
    <a
      bind:this={itemRefs[idx]}
      href={item.path}
      style="transform: translateY({(1 - scale) * 14}px) scale({scale});"
      class="relative px-3.5 py-2 rounded-xl text-xs font-medium transition-colors {activePath === item.path ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}"
    >
      {item.label}
    </a>
  {/each}
</nav>
```

---

## 5. Interactive 3D Stage in Svelte 5 (`@threlte/core` / `three` + `Spring` Camera & Shaders)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { Spring } from 'svelte/motion';
  import * as THREE from 'three';

  let canvasEl: HTMLCanvasElement | null = null;
  const pointer = new Spring({ x: 0, y: 0 }, { stiffness: 0.14, damping: 0.76 });

  onMount(() => {
    if (!canvasEl) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvasEl.clientWidth || 640, canvasEl.clientHeight || 400, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, (canvasEl.clientWidth || 640) / (canvasEl.clientHeight || 400), 0.1, 100);
    camera.position.set(0, 0.3, 4.2);

    scene.add(new THREE.AmbientLight(0x38bdf8, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(3, 4, 5);
    scene.add(dirLight);

    const geo = new THREE.OctahedronGeometry(1.05, 3);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        uniform float uTime;
        varying vec3 vN;
        void main() {
          vN = normalMatrix * normal;
          vec3 p = position + normal * sin(uTime * 2.2 + position.y * 3.0) * 0.06;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vN;
        void main() {
          float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0))), 2.1);
          gl_FragColor = vec4(mix(vec3(0.07, 0.48, 0.82), vec3(0.55, 0.92, 1.0), rim), 0.93);
        }
      `,
      transparent: true
    });
    const core = new THREE.Mesh(geo, mat);
    scene.add(core);

    const pts = new Float32Array(240 * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * 7;
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const ptMat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.035 });
    scene.add(new THREE.Points(ptGeo, ptMat));

    let raf = 0;
    const loop = (t: number) => {
      mat.uniforms.uTime.value = t * 0.001;
      if (!reduced) {
        core.rotation.y += 0.005 + pointer.current.x * 0.01;
        core.rotation.x += 0.003 + pointer.current.y * 0.01;
        camera.position.x = pointer.current.x * 0.45;
        camera.position.y = pointer.current.y * 0.35;
        camera.lookAt(0, 0, 0);
      }
      renderer.render(scene, camera);
      if (!reduced) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      geo.dispose();
      mat.dispose();
      ptGeo.dispose();
      ptMat.dispose();
      renderer.dispose();
    };
  });
</script>

<div
  role="region"
  aria-label="Interactive 3D telemetry stage"
  onpointermove={(e) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    pointer.target = { x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: -(((e.clientY - r.top) / r.height - 0.5) * 2) };
  }}
  onpointerleave={() => { pointer.target = { x: 0, y: 0 }; }}
  class="relative w-full h-[400px] rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-slate-950"
>
  <canvas bind:this={canvasEl} data-3d-stage="true" class="w-full h-full block"></canvas>
</div>
```
