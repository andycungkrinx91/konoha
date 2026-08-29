# Next.js 16 UI Expert & Universal Archetype Blueprints

Canonical design system directives and production blueprints for **Next.js 16.3 App Router (`app/`)** web applications supporting all major archetypes: **E-commerce, Admin & Metric Infra Dashboards, Portfolios, SaaS Landing Pages, and Corporate Profiles**.

---

## 🎨 Universal UI/UX Invariants (Mandatory Across All Archetypes)

### 1. Header Architecture (Far-Left Logo & Zero Mobile Hamburger Toggle)
- **Far-Left Brand Logo**: Brand logo MUST always be placed on the far LEFT (`justify-start` / `flex items-center gap-3`) of the navigation header.
- **Zero Mobile Hamburger Menu**: In mobile view (`lg:hidden`), **NEVER render a hamburger menu or top menu toggle button in the header**. Mobile navigation is powered exclusively by the fixed bottom Mobile Dock!

### 2. Floating Bottom-Left 10-Theme Switcher Popup
- **Placement**: Theme switcher trigger button MUST be positioned floating in the **bottom-left corner** (`fixed bottom-6 left-6 z-50`) on both desktop and mobile viewports.
- **Pure Light Mode**: 10 curated Light Mode gradient themes. Zero dark mode enforcement.
- **SSR Hydration Safety**: Strict `useMounted()` guard before accessing `localStorage` or rendering theme DOM to guarantee **0 hydration mismatch errors**.

### 3. Archetype-Adaptive Sticky Mobile Bottom Navigation Dock
- **Placement**: Fixed mobile navigation dock (`fixed bottom-0 left-0 right-0 z-40 lg:hidden backdrop-blur-lg bg-white/90 border-t border-[var(--theme-border)] pb-safe`).
- **Adaptive Routes**: Dynamically maps quick one-tap links to the website's archetype:
  - *Admin / Infra Dashboard*: Overview, Analytics, Servers/Nodes, Alerts, Themes
  - *Portfolio*: Home, Projects, Experience, Skills, Contact, Themes
  - *SaaS / Landing*: Home, Features, Pricing, Testimonials, Themes
  - *E-commerce*: Home, Shop, Categories, Wishlist, Cart, Themes
  - *Company Profile*: Home, About, Services, Case Studies, Contact, Themes

### 4. Zero Errors & Zero Warnings Quality Gate
- Scaffolding MUST include required packages: `lucide-react`, `clsx`, `tailwind-merge`.
- Do not claim completion until `pnpm run build` and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.

---

## 🛠️ Canonical Code Blueprints

### Blueprint 1: `app/globals.css` (10 Light Themes Engine)

```css
@import "tailwindcss";

@layer base {
  :root, [data-theme="imperial-gold"] {
    --theme-primary: #d97706;
    --theme-primary-hover: #b45309;
    --theme-secondary: #fef3c7;
    --theme-accent: #f59e0b;
    --theme-bg: #fffdfa;
    --theme-card: #ffffff;
    --theme-text: #1c1917;
    --theme-muted: #78716c;
    --theme-border: #fde68a;
  }
  [data-theme="nebula-indigo"] {
    --theme-primary: #4f46e5;
    --theme-primary-hover: #4338ca;
    --theme-secondary: #e0e7ff;
    --theme-accent: #6366f1;
    --theme-bg: #f8fafc;
    --theme-card: #ffffff;
    --theme-text: #0f172a;
    --theme-muted: #64748b;
    --theme-border: #cbd5e1;
  }
  [data-theme="aurora-emerald"] {
    --theme-primary: #059669;
    --theme-primary-hover: #047857;
    --theme-secondary: #d1fae5;
    --theme-accent: #10b981;
    --theme-bg: #f0fdf4;
    --theme-card: #ffffff;
    --theme-text: #064e3b;
    --theme-muted: #047857;
    --theme-border: #a7f3d0;
  }
  [data-theme="sunset-amber"] {
    --theme-primary: #ea580c;
    --theme-primary-hover: #c2410c;
    --theme-secondary: #ffedd5;
    --theme-accent: #f97316;
    --theme-bg: #fffaf5;
    --theme-card: #ffffff;
    --theme-text: #27272a;
    --theme-muted: #71717a;
    --theme-border: #fed7aa;
  }
  [data-theme="ocean-sapphire"] {
    --theme-primary: #0284c7;
    --theme-primary-hover: #0369a1;
    --theme-secondary: #e0f2fe;
    --theme-accent: #38bdf8;
    --theme-bg: #f8fafc;
    --theme-card: #ffffff;
    --theme-text: #0f172a;
    --theme-muted: #64748b;
    --theme-border: #bae6fd;
  }
  [data-theme="forest-jade"] {
    --theme-primary: #15803d;
    --theme-primary-hover: #166534;
    --theme-secondary: #dcfce7;
    --theme-accent: #22c55e;
    --theme-bg: #f0fdf4;
    --theme-card: #ffffff;
    --theme-text: #14532d;
    --theme-muted: #15803d;
    --theme-border: #bbf7d0;
  }
  [data-theme="volcano-crimson"] {
    --theme-primary: #dc2626;
    --theme-primary-hover: #b91c1c;
    --theme-secondary: #fee2e2;
    --theme-accent: #ef4444;
    --theme-bg: #fff5f5;
    --theme-card: #ffffff;
    --theme-text: #1f2937;
    --theme-muted: #6b7280;
    --theme-border: #fecaca;
  }
  [data-theme="sakura-rose"] {
    --theme-primary: #db2777;
    --theme-primary-hover: #be185d;
    --theme-secondary: #fce7f3;
    --theme-accent: #ec4899;
    --theme-bg: #fdf2f8;
    --theme-card: #ffffff;
    --theme-text: #374151;
    --theme-muted: #6b7280;
    --theme-border: #fbcfe8;
  }
  [data-theme="cyber-violet"] {
    --theme-primary: #7c3aed;
    --theme-primary-hover: #6d28d9;
    --theme-secondary: #ede9fe;
    --theme-accent: #8b5cf6;
    --theme-bg: #faf5ff;
    --theme-card: #ffffff;
    --theme-text: #1e1b4b;
    --theme-muted: #6b7280;
    --theme-border: #ddd6fe;
  }
  [data-theme="midnight-slate"] {
    --theme-primary: #334155;
    --theme-primary-hover: #1e293b;
    --theme-secondary: #f1f5f9;
    --theme-accent: #475569;
    --theme-bg: #ffffff;
    --theme-card: #ffffff;
    --theme-text: #0f172a;
    --theme-muted: #64748b;
    --theme-border: #e2e8f0;
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

### Blueprint 2: `components/ThemeSwitcher.tsx` (Hydration-Safe FAB Modal)

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Palette, Check, X } from 'lucide-react';

export const THEMES = [
  { id: 'imperial-gold', name: 'Imperial Gold', primary: '#d97706', bg: '#fffdfa' },
  { id: 'nebula-indigo', name: 'Nebula Indigo', primary: '#4f46e5', bg: '#f8fafc' },
  { id: 'aurora-emerald', name: 'Aurora Emerald', primary: '#059669', bg: '#f0fdf4' },
  { id: 'sunset-amber', name: 'Sunset Amber', primary: '#ea580c', bg: '#fffaf5' },
  { id: 'ocean-sapphire', name: 'Ocean Sapphire', primary: '#0284c7', bg: '#f8fafc' },
  { id: 'forest-jade', name: 'Forest Jade', primary: '#15803d', bg: '#f0fdf4' },
  { id: 'volcano-crimson', name: 'Volcano Crimson', primary: '#dc2626', bg: '#fff5f5' },
  { id: 'sakura-rose', name: 'Sakura Rose', primary: '#db2777', bg: '#fdf2f8' },
  { id: 'cyber-violet', name: 'Cyber Violet', primary: '#7c3aed', bg: '#faf5ff' },
  { id: 'midnight-slate', name: 'Midnight Slate', primary: '#334155', bg: '#ffffff' },
] as const;

export function ThemeSwitcher() {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<string>('imperial-gold');

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('konoha-theme') || 'imperial-gold';
    setCurrentTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  const selectTheme = (themeId: string) => {
    setCurrentTheme(themeId);
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('konoha-theme', themeId);
    setIsOpen(false);
  };

  if (!mounted) return null;

  return (
    <>
      {/* Floating Bottom-Left Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Open theme switcher"
        className="fixed bottom-6 left-6 z-50 flex h-13 w-13 items-center justify-center rounded-full bg-[var(--theme-primary)] text-white shadow-xl hover:scale-105 active:scale-95 transition-transform duration-200 border-2 border-white/80 cursor-pointer"
      >
        <Palette className="h-6 w-6" />
      </button>

      {/* Theme Selection Modal Popup */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-start p-4 sm:p-6 bg-black/30 backdrop-blur-xs">
          <div 
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl border border-[var(--theme-border)] animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-[var(--theme-primary)]" />
                <h3 className="font-semibold text-gray-900 text-sm">Light Mode Themes</h3>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-4 max-h-[60vh] overflow-y-auto">
              {THEMES.map((theme) => {
                const isActive = currentTheme === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => selectTheme(theme.id)}
                    className={`flex items-center gap-2.5 rounded-xl p-2.5 text-left text-xs font-medium transition-all border ${
                      isActive 
                        ? 'border-[var(--theme-primary)] bg-[var(--theme-secondary)] text-[var(--theme-text)] font-semibold shadow-xs' 
                        : 'border-gray-200 bg-gray-50/50 hover:bg-gray-100/70 text-gray-700'
                    }`}
                  >
                    <span 
                      className="h-4 w-4 rounded-full border border-black/10 shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: theme.primary }}
                    >
                      {isActive && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
                    </span>
                    <span className="truncate">{theme.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

---

### Blueprint 3: `components/DashboardShell.tsx` & `DashboardSidebar.tsx` (Admin & Infra Dashboard)

```tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Server, BarChart3, Users, Settings, Bell, Search, ShieldCheck } from 'lucide-react';

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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
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

### Blueprint 4: `components/MetricWidgets.tsx` (SSR-Safe KPI Cards & Pure SVG Area Chart)

```tsx
'use client';

import React from 'react';
import { TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';

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
          {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
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

### Blueprint 5: `components/PortfolioHero.tsx` & `ProjectsBento.tsx` (Portfolio Archetype)

```tsx
'use client';

import React, { useState } from 'react';
import { ExternalLink, Github, ArrowRight, Code2, Sparkles } from 'lucide-react';
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
        <Sparkles className="h-3.5 w-3.5" />
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
                    <Github className="h-4 w-4" />
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
