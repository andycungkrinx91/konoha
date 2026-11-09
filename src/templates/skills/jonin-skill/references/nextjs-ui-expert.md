# Next.js 16 UI Expert & Universal Archetype Blueprints

Canonical design system directives and production blueprints for **Next.js 16.3 App Router (`app/`)** web applications supporting all major archetypes: **E-commerce, Admin & Metric Infra Dashboards, Portfolios, SaaS Landing Pages, and Corporate Profiles**.

---

## 🎨 Universal UI/UX & Storytelling Invariants (Next.js 16 App Router)

### 1. Dynamic Context-Driven Composition (Astra/Fable Standard)
- Compose hero stages, section layouts, and interactive surfaces dynamically around the product domain and prompt.
- Composition, section order, theme count, and navigation pattern come from the 9-field design brief; never reuse a house template. Place the brand identity cleanly on the left of a horizontal header (`flex items-center justify-between`).

### 2. Adaptive Dark & Light Mode + SSR Hydration Safety
- Choose the theme strategy from the design brief (single or dual theme) and define semantic color tokens (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) with WCAG AA contrast.
- Use a strict `useMounted()` guard before accessing `localStorage` or rendering client-only theme state to guarantee **0 hydration mismatch errors**.

### 3. Motion Choreography (`motion/react`)
- Use `import { motion, AnimatePresence, LayoutGroup, useScroll, useTransform, useSpring, useReducedMotion } from 'motion/react'` (`jonin-skill/motion-nextjs`) inside `'use client'` leaf components for spring-physics card elevation, shared `layoutId` pills, dock magnification, and staggered hero storytelling.

### 4. Konoha Signature & Zero Errors Quality Gate
- Include `<meta name="generator" content="Build by konoha">` in `app/layout.tsx` metadata (`other: { generator: 'Build by konoha' }` or `generator: 'Build by konoha'`) and render the visible text `Build by konoha` in `<footer>`.
- Scaffolding MUST include `@phosphor-icons/react` or hand-exported inline SVG icon components — NEVER `lucide-react` and zero emojis anywhere in UI copy or controls.
- Do not claim completion until `pnpm run build` and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.

---

## 🛠️ Canonical Code Blueprints

### Blueprint 1: `app/globals.css` (Project Token Set)

```css
@import "tailwindcss";

@layer base {
  :root {
    /* Replace with the project's tokens from the design brief. */
    --theme-primary: #4f46e5;
    --theme-primary-hover: #4338ca;
    --theme-secondary: #eef2ff;
    --theme-accent: #06b6d4;
    --theme-bg: #ffffff;
    --theme-card: #ffffff;
    --theme-text: #0f172a;
    --theme-muted: #64748b;
    --theme-border: #e2e8f0;
    /* Add [data-theme="..."] overrides ONLY when the brief defines multiple themes. */
  }
}

body {
  background-color: var(--theme-bg);
  color: var(--theme-text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  overflow-x: hidden;
}
```

---

### Blueprint 2: `components/DashboardShell.tsx` & `DashboardSidebar.tsx` (Admin & Infra Dashboard)

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SquaresFour, HardDrives, ChartBar, Users, Gear, Bell, MagnifyingGlass, ShieldCheck } from '@phosphor-icons/react/dist/ssr';

export interface SidebarItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

export function DashboardSidebar({ brandName, items }: { brandName: string; items: SidebarItem[] }) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r border-[var(--theme-border)] bg-white/95 backdrop-blur-md min-h-screen sticky top-0 shrink-0">
      {/* Brand Logo Header */}
      <div className="h-16 flex items-center gap-3 px-6 border-b border-[var(--theme-border)]">
        <div className="h-9 w-9 rounded-xl bg-[var(--theme-primary)] flex items-center justify-center text-white font-black text-lg shadow-sm">
          {brandName.charAt(0)}
        </div>
        <span className="font-bold text-lg text-gray-900 tracking-tight">{brandName}</span>
      </div>

      {/* Navigation Menu */}
      <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-[var(--theme-secondary)] text-[var(--theme-primary)] font-semibold shadow-xs'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`h-5 w-5 ${isActive ? 'text-[var(--theme-primary)]' : 'text-gray-500'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span className="rounded-full bg-[var(--theme-primary)]/15 px-2 py-0.5 text-xs font-semibold text-[var(--theme-primary)]">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User Profile Footer */}
      <div className="p-4 border-t border-[var(--theme-border)]">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-gray-50/80">
          <div className="h-8 w-8 rounded-full bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] flex items-center justify-center font-bold text-xs">
            OP
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-900 truncate">Admin Operator</p>
            <p className="text-[10px] text-gray-500 truncate flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block" />
              Connected
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function DashboardHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-30 h-16 border-b border-[var(--theme-border)] bg-white/80 backdrop-blur-md px-4 sm:px-6 lg:px-8 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold text-gray-900">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative hidden sm:block">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search resources, nodes, users..."
            className="h-9 w-64 rounded-xl border border-[var(--theme-border)] bg-gray-50/60 pl-9 pr-4 text-xs focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[var(--theme-primary)]"
          />
        </div>
        <button className="relative rounded-xl p-2 text-gray-600 hover:bg-gray-100 transition-colors">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500" />
        </button>
      </div>
    </header>
  );
}
```

---

### Blueprint 3: `components/MetricWidgets.tsx` (SSR-Safe KPI Cards & Pure SVG Area Chart)

```tsx
'use client';

import React from 'react';
import { TrendUp, TrendDown, ArrowUpRight } from '@phosphor-icons/react/dist/ssr';

export interface MetricCardProps {
  label: string;
  value: string;
  trend: string;
  isPositive: boolean;
  subtext: string;
}

export function MetricCard({ label, value, trend, isPositive, subtext }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-white p-5 shadow-xs hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between text-xs text-gray-500 font-medium">
        <span>{label}</span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
            isPositive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
          }`}
        >
          {isPositive ? <TrendUp className="h-3 w-3" /> : <TrendDown className="h-3 w-3" />}
          {trend}
        </span>
      </div>
      <div className="mt-3">
        <span className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">{value}</span>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">{subtext}</p>
    </div>
  );
}

export function SvgAreaChart({ title, points }: { title: string; points: number[] }) {
  const max = Math.max(...points, 100);
  const width = 600;
  const height = 180;
  const step = width / (points.length - 1);

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${height - (p / max) * (height - 20) - 10}`)
    .join(' ');

  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-white p-6 shadow-xs">
      <div className="flex items-center justify-between pb-4 border-b border-gray-100">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
          <p className="text-xs text-gray-500">Real-time throughput telemetry</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--theme-secondary)] px-2.5 py-1 text-xs font-semibold text-[var(--theme-primary)]">
          Live (SSR Safe)
        </span>
      </div>
      <div className="pt-4 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible">
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--theme-primary)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--theme-primary)" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={areaD} fill="url(#chartGradient)" />
          <path d={pathD} fill="none" stroke="var(--theme-primary)" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
```

---

### Blueprint 4: `components/PortfolioHero.tsx` & `ProjectsBento.tsx` (Portfolio Archetype)

```tsx
'use client';

import React, { useState } from 'react';
import { ExternalLink, GithubLogo, ArrowRight, Code, Sparkle } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

export interface Project {
  id: string;
  title: string;
  category: 'Fullstack' | 'AI / ML' | 'DevOps' | 'Mobile';
  description: string;
  tags: string[];
  demoUrl: string;
  githubUrl: string;
}

export function PortfolioHero({ name, role, bio }: { name: string; role: string; bio: string }) {
  return (
    <section className="py-16 md:py-24 text-center max-w-4xl mx-auto px-4">
      <div className="inline-flex items-center gap-2 rounded-full border border-[var(--theme-border)] bg-[var(--theme-secondary)] px-4 py-1.5 text-xs font-semibold text-[var(--theme-primary)] mb-6">
        <Sparkle className="h-3.5 w-3.5" />
        <span>Available for Strategic Projects & Architecture</span>
      </div>
      <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-gray-900 leading-tight">
        Building high-performance software with <span className="text-[var(--theme-primary)]">{name}</span>
      </h1>
      <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
        {bio}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="#projects"
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--theme-primary)] px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-[var(--theme-primary-hover)] transition-all cursor-pointer"
        >
          View Case Studies
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="#contact"
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--theme-border)] bg-white px-6 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 transition-all cursor-pointer"
        >
          Get in Touch
        </Link>
      </div>
    </section>
  );
}

export function ProjectsBento({ projects }: { projects: Project[] }) {
  const [activeTab, setActiveTab] = useState<string>('All');
  const categories = ['All', 'Fullstack', 'AI / ML', 'DevOps', 'Mobile'];

  const filtered = activeTab === 'All' ? projects : projects.filter((p) => p.category === activeTab);

  return (
    <section id="projects" className="py-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Featured Engineering Work</h2>
          <p className="text-sm text-gray-500">Selected production architectures and applications</p>
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveTab(cat)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                activeTab === cat
                  ? 'bg-[var(--theme-primary)] text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((proj) => (
          <div
            key={proj.id}
            className="group rounded-2xl border border-[var(--theme-border)] bg-white p-6 shadow-xs hover:shadow-xl transition-all duration-300 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="rounded-full bg-[var(--theme-secondary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--theme-primary)]">
                  {proj.category}
                </span>
                <div className="flex items-center gap-2">
                  <a href={proj.githubUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-800">
                    <GithubLogo className="h-4 w-4" />
                  </a>
                  <a href={proj.demoUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-gray-800">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              </div>
              <h3 className="font-bold text-gray-900 text-lg group-hover:text-[var(--theme-primary)] transition-colors">
                {proj.title}
              </h3>
              <p className="mt-2 text-xs sm:text-sm text-gray-600 line-clamp-3">
                {proj.description}
              </p>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap gap-1.5">
              {proj.tags.map((t) => (
                <span key={t} className="rounded-md bg-gray-50 border border-gray-200 px-2 py-0.5 text-[10px] text-gray-600">
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```
