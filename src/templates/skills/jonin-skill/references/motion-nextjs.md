---
name: motion-nextjs
description: Verified Motion (motion/react) implementation reference for Next.js 16 App Router and React 19 — spring physics, AnimatePresence, layoutId morphing, scroll storytelling, dock magnification, and reduced-motion accessibility.
tags:
  - motion
  - nextjs
  - react-19
  - framer-motion
  - animation
---

# Motion for Next.js 16 & React 19 (`motion/react`)

Use this reference for all **Next.js 16 App Router + React 19** builds. In Motion v12+, the canonical React entry point is `motion/react`.

## 1. Installation & Client Boundary Rules

```bash
rtk pnpm add motion three @types/three @react-three/fiber @react-three/drei gsap --silent
```

- **Server Component Boundary**: Next.js 16 defaults to React Server Components (RSC). Any component importing from `'motion/react'` MUST declare `'use client'` at line 1.
- **Leaf Wrapper Strategy**: Keep route `page.tsx` and `layout.tsx` as Server Components for SEO/metadata (`<meta name="generator" content="Build by konoha">`), and extract animated sections into client leaf components (`HeroStage.tsx`, `InteractiveBento.tsx`, `MotionDock.tsx`).

---

## 2.Choreographed Hero Storytelling & Staggered Reveal

```tsx
'use client';

import { motion, useReducedMotion, type Variants } from 'motion/react';

const stageVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.09, delayChildren: 0.05 }
  }
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 280, damping: 24, mass: 0.9 }
  }
};

export function HeroNarrative({
  eyebrow,
  title,
  subtitle,
  children
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      variants={reduceMotion ? undefined : stageVariants}
      initial={reduceMotion ? false : 'hidden'}
      animate="visible"
      className="relative min-h-[100dvh] flex flex-col justify-center py-24 px-6"
    >
      <motion.span
        variants={reduceMotion ? undefined : itemVariants}
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--accent-primary)]"
      >
        {eyebrow}
      </motion.span>
      <motion.h1
        variants={reduceMotion ? undefined : itemVariants}
        className="mt-4 text-5xl md:text-7xl font-semibold tracking-tight text-[var(--text-primary)]"
      >
        {title}
      </motion.h1>
      <motion.p
        variants={reduceMotion ? undefined : itemVariants}
        className="mt-6 max-w-2xl text-lg text-[var(--text-muted)]"
      >
        {subtitle}
      </motion.p>
      {children && (
        <motion.div variants={reduceMotion ? undefined : itemVariants} className="mt-10">
          {children}
        </motion.div>
      )}
    </motion.section>
  );
}
```

---

## 3. Interactive Metric Card with 3D Spring Tilt & Layout Morphing

```tsx
'use client';

import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import React from 'react';

export function InteractiveMetricCard({
  label,
  value,
  delta,
  children
}: {
  label: string;
  value: string;
  delta?: string;
  children?: React.ReactNode;
}) {
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const rotateX = useSpring(useTransform(rawY, [-0.5, 0.5], [7, -7]), { stiffness: 320, damping: 26 });
  const rotateY = useSpring(useTransform(rawX, [-0.5, 0.5], [-7, 7]), { stiffness: 320, damping: 26 });

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    rawX.set((e.clientX - rect.left) / rect.width - 0.5);
    rawY.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function handlePointerLeave() {
    rawX.set(0);
    rawY.set(0);
  }

  return (
    <motion.article
      layout
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      style={{ rotateX, rotateY, transformPerspective: 1200 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm"
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-[var(--text-muted)]">
        <span>{label}</span>
        {delta && <span className="text-[var(--accent-primary)] font-mono">{delta}</span>}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-primary)] font-mono">
        {value}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </motion.article>
  );
}
```

---

## 4. Shared-Element Navigation & Bottom Dock Magnification

```tsx
'use client';

import { motion, AnimatePresence } from 'motion/react';
import { useState } from 'react';

export interface DockItem {
  id: string;
  label: string;
  href: string;
}

export function MotionBottomDock({
  items,
  activeId,
  onSelect
}: {
  items: DockItem[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <nav
      aria-label="Primary dock navigation"
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/85 backdrop-blur-xl px-3 py-2 shadow-2xl"
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        const isHovered = item.id === hoveredId;
        return (
          <motion.button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            onHoverStart={() => setHoveredId(item.id)}
            onHoverEnd={() => setHoveredId(null)}
            animate={{ scale: isHovered ? 1.14 : 1, y: isHovered ? -4 : 0 }}
            whileTap={{ scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            className="relative px-3.5 py-2 rounded-xl text-xs font-medium text-[var(--text-primary)]"
          >
            {isActive && (
              <motion.span
                layoutId="dock-active-pill"
                transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                className="absolute inset-0 rounded-xl bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/40"
              />
            )}
            <span className="relative z-10">{item.label}</span>
            <AnimatePresence>
              {isHovered && (
                <motion.span
                  initial={{ opacity: 0, y: 6, scale: 0.92 }}
                  animate={{ opacity: 1, y: -34, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.92 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-md bg-[var(--bg-canvas)] px-2 py-0.5 text-[10px] whitespace-nowrap border border-[var(--border-subtle)] shadow-md"
                >
                  {item.label}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        );
      })}
    </nav>
  );
}
```

---

## 5. Interactive 3D Stage (React Three Fiber / Three.js + Shaders, Particles & Scroll/Pointer Camera)

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { motion, useScroll, useTransform, useReducedMotion } from 'motion/react';
import * as THREE from 'three';

export function InteractiveOrbital3DStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const yParallax = useTransform(scrollYProgress, [0, 1], [0, -48]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth || 640, canvas.clientHeight || 420, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, (canvas.clientWidth || 640) / (canvas.clientHeight || 420), 0.1, 100);
    camera.position.set(0, 0.4, 4.2);

    const ambient = new THREE.AmbientLight(0x38bdf8, 0.65);
    const keyLight = new THREE.DirectionalLight(0xf8fafc, 1.8);
    keyLight.position.set(3, 4, 5);
    const rimLight = new THREE.PointLight(0x6366f1, 2.4, 14);
    rimLight.position.set(-3, -2, 3);
    scene.add(ambient, keyLight, rimLight);

    const coreGeo = new THREE.IcosahedronGeometry(1.05, 4);
    const shaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPointer: { value: new THREE.Vector2(0, 0) }
      },
      vertexShader: `
        uniform float uTime;
        uniform vec2 uPointer;
        varying vec3 vNormal;
        void main() {
          vNormal = normalMatrix * normal;
          vec3 pos = position + normal * sin(uTime * 2.0 + position.y * 3.5 + uPointer.x * 2.0) * 0.08;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float fresnel = pow(1.0 - abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 2.2);
          vec3 col = mix(vec3(0.05, 0.45, 0.78), vec3(0.45, 0.85, 1.0), fresnel);
          gl_FragColor = vec4(col, 0.92);
        }
      `,
      transparent: true
    });
    const coreMesh = new THREE.Mesh(coreGeo, shaderMat);
    scene.add(coreMesh);

    const particleCount = 320;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) {
      positions[i] = (Math.random() - 0.5) * 7.5;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({ color: 0x38bdf8, size: 0.035, transparent: true, opacity: 0.75 });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    const pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / (r.width || 1) - 0.5) * 2;
      pointer.y = -(((e.clientY - r.top) / (r.height || 1) - 0.5) * 2);
      shaderMat.uniforms.uPointer.value.set(pointer.x, pointer.y);
    };
    canvas.addEventListener('pointermove', onMove);

    let rafId = 0;
    const renderFrame = (t: number) => {
      shaderMat.uniforms.uTime.value = t * 0.001;
      if (!reduceMotion) {
        coreMesh.rotation.y += 0.005 + pointer.x * 0.01;
        coreMesh.rotation.x += 0.003 + pointer.y * 0.01;
        particles.rotation.y -= 0.0015;
        camera.position.x += (pointer.x * 0.45 - camera.position.x) * 0.06;
        camera.position.y += (pointer.y * 0.35 - camera.position.y) * 0.06;
        camera.lookAt(0, 0, 0);
      }
      renderer.render(scene, camera);
      if (!reduceMotion) rafId = requestAnimationFrame(renderFrame);
    };
    rafId = requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointermove', onMove);
      coreGeo.dispose();
      shaderMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      renderer.dispose();
    };
  }, [reduceMotion]);

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: -24, right: 24 }}
      style={reduceMotion ? undefined : { y: yParallax }}
      className="relative w-full h-[420px] rounded-2xl overflow-hidden border border-[var(--border-subtle)] bg-slate-950"
    >
      <canvas ref={canvasRef} data-3d-stage="true" className="w-full h-full block" />
    </motion.div>
  );
}
```
