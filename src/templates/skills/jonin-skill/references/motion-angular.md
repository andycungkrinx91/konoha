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
rtk pnpm add motion --silent
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
