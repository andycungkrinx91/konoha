---
name: motion-angular
description: Verified Motion implementation reference for Angular 19/20+ Standalone Components & Signals — using the official motion JS API (animate, inView, scroll, stagger, spring) with afterNextRender, ElementRef, and DestroyRef cleanup.
tags:
  - motion
  - angular
  - signals
  - standalone-components
  - animation
---

# Motion for Angular 19/20+ (`motion` JS API + Signals & `afterNextRender`)

Use this reference for all **Angular 19/20+** builds. Angular standalone components integrate directly with the official `'motion'` package (`animate`, `inView`, `scroll`, `stagger`, `spring`) using `afterNextRender()`, `ElementRef`, Angular `signal()`/`effect()`, and `DestroyRef` for SSR-safe hydration and deterministic teardown.

## 1. Installation & Imports

```bash
rtk pnpm add motion gsap three @types/three angular-three --silent
```

```ts
import {
  Component,
  ElementRef,
  DestroyRef,
  inject,
  signal,
  viewChild,
  viewChildren,
  afterNextRender
} from '@angular/core';
import { animate, inView, scroll, stagger, spring } from 'motion';
```

---

## 2. Staggered Narrative Hero & Metric Cards in Angular 19/20+

```ts
import {
  Component,
  ElementRef,
  DestroyRef,
  inject,
  input,
  signal,
  viewChild,
  afterNextRender
} from '@angular/core';
import { animate, inView, stagger, spring } from 'motion';

export interface MetricItem {
  id: string;
  label: string;
  value: string;
  delta: string;
}

@Component({
  selector: 'app-hero-stage',
  standalone: true,
  template: `
    <section #stageRef class="relative min-h-[100dvh] flex flex-col justify-center py-24 px-6">
      <span data-motion-hero class="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--accent-primary)]">
        {{ eyebrow() }}
      </span>
      <h1 data-motion-hero class="mt-4 text-5xl md:text-7xl font-semibold tracking-tight text-[var(--text-primary)]">
        {{ title() }}
      </h1>
      <p data-motion-hero class="mt-6 max-w-2xl text-lg text-[var(--text-muted)]">
        {{ subtitle() }}
      </p>

      <div class="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        @for (item of metrics(); track item.id) {
          <article
            data-motion-card
            (pointerenter)="onCardHover($event, true)"
            (pointerleave)="onCardHover($event, false)"
            (click)="selectedId.set(item.id)"
            class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 cursor-pointer"
          >
            <div class="flex items-center justify-between text-xs uppercase tracking-wider text-[var(--text-muted)]">
              <span>{{ item.label }}</span>
              <span class="font-mono text-[var(--accent-primary)]">{{ item.delta }}</span>
            </div>
            <div class="mt-3 text-3xl font-semibold font-mono text-[var(--text-primary)]">
              {{ item.value }}
            </div>
          </article>
        }
      </div>
    </section>
  `
})
export class HeroStageComponent {
  readonly eyebrow = input.required<string>();
  readonly title = input.required<string>();
  readonly subtitle = input.required<string>();
  readonly metrics = input<MetricItem[]>([]);
  readonly selectedId = signal<string | null>(null);

  private readonly stageRef = viewChild<ElementRef<HTMLElement>>('stageRef');
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const host = this.stageRef()?.nativeElement;
      if (!host || typeof window === 'undefined') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const heroItems = host.querySelectorAll<HTMLElement>('[data-motion-hero]');
      const heroCtrl = animate(
        heroItems,
        { opacity: [0, 1], transform: ['translateY(22px)', 'translateY(0px)'] },
        { type: spring, stiffness: 280, damping: 24, delay: stagger(0.08) }
      );

      const stopInView = inView(
        host,
        () => {
          const cards = host.querySelectorAll<HTMLElement>('[data-motion-card]');
          if (!cards.length) return;
          const cardCtrl = animate(
            cards,
            { opacity: [0, 1], transform: ['translateY(24px) scale(0.98)', 'translateY(0px) scale(1)'] },
            { type: spring, stiffness: 300, damping: 25, delay: stagger(0.07, { startDelay: 0.18 }) }
          );
          return () => cardCtrl.stop();
        },
        { amount: 0.15 }
      );

      this.destroyRef.onDestroy(() => {
        heroCtrl.stop();
        stopInView();
      });
    });
  }

  onCardHover(event: PointerEvent, entering: boolean): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animate(
      el,
      { transform: entering ? 'translateY(-4px) scale(1.015)' : 'translateY(0px) scale(1)' },
      { type: spring, stiffness: 380, damping: 24 }
    );
  }
}
```

---

## 3. Native `animate.enter` / `animate.leave` & Interactive 3D Stage (`three` + `NgZone.runOutsideAngular`)

```ts
import {
  Component,
  ElementRef,
  DestroyRef,
  NgZone,
  inject,
  signal,
  viewChild,
  afterNextRender
} from '@angular/core';
import * as THREE from 'three';

@Component({
  selector: 'app-orbital-3d-stage',
  standalone: true,
  template: `
    <div
      animate.enter="stage-enter"
      animate.leave="stage-leave"
      (pointermove)="onPointerMove($event)"
      (pointerleave)="pointer.set({ x: 0, y: 0 })"
      class="relative w-full h-[400px] rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-slate-950"
    >
      <canvas #canvasRef data-3d-stage="true" class="w-full h-full block"></canvas>
    </div>
  `
})
export class Orbital3dStageComponent {
  readonly pointer = signal({ x: 0, y: 0 });
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvasRef');
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  constructor() {
    afterNextRender(() => {
      const canvas = this.canvasRef()?.nativeElement;
      if (!canvas || typeof window === 'undefined') return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      this.zone.runOutsideAngular(() => {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(canvas.clientWidth || 640, canvas.clientHeight || 400, false);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, (canvas.clientWidth || 640) / (canvas.clientHeight || 400), 0.1, 100);
        camera.position.set(0, 0.3, 4.2);

        scene.add(new THREE.AmbientLight(0x38bdf8, 0.7));
        const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
        keyLight.position.set(3, 4, 5);
        scene.add(keyLight);

        const geo = new THREE.IcosahedronGeometry(1.0, 3);
        const mat = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 } },
          vertexShader: `
            uniform float uTime;
            varying vec3 vN;
            void main() {
              vN = normalMatrix * normal;
              vec3 p = position + normal * sin(uTime * 2.0 + position.z * 3.0) * 0.06;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }
          `,
          fragmentShader: `
            varying vec3 vN;
            void main() {
              float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0))), 2.0);
              gl_FragColor = vec4(mix(vec3(0.06, 0.46, 0.8), vec3(0.5, 0.9, 1.0), rim), 0.92);
            }
          `,
          transparent: true
        });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);

        const pts = new Float32Array(240 * 3);
        for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * 7;
        const ptGeo = new THREE.BufferGeometry();
        ptGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
        const ptMat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.035 });
        scene.add(new THREE.Points(ptGeo, ptMat));

        let raf = 0;
        const tick = (t: number) => {
          mat.uniforms.uTime.value = t * 0.001;
          if (!reduced) {
            const p = this.pointer();
            mesh.rotation.y += 0.005 + p.x * 0.01;
            mesh.rotation.x += 0.003 + p.y * 0.01;
            camera.position.x = p.x * 0.45;
            camera.position.y = p.y * 0.35;
            camera.lookAt(0, 0, 0);
          }
          renderer.render(scene, camera);
          if (!reduced) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        this.destroyRef.onDestroy(() => {
          cancelAnimationFrame(raf);
          geo.dispose();
          mat.dispose();
          ptGeo.dispose();
          ptMat.dispose();
          renderer.dispose();
        });
      });
    });
  }

  onPointerMove(event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    this.pointer.set({
      x: ((event.clientX - r.left) / (r.width || 1) - 0.5) * 2,
      y: -(((event.clientY - r.top) / (r.height || 1) - 0.5) * 2)
    });
  }
}
```
