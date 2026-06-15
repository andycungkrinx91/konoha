# Next.js Creative UI Expert

> Read when: building Next.js 16 user interfaces, composing App Router components, or implementing immersive 3D effects, animations, and WebGL with high performance.
> 
> **Related References:**
> - For styling, setup, and global design: read `references/tailwind-design-system.md`

## Next.js Component Architecture

In Next.js App Router, components default to **Server Components**. Only use `"use client"` when you need browser APIs, interactivity, or React hooks (useState, useEffect, etc.).

### Server Component (Default)
Used for data fetching and static UI structure.
```tsx
// app/dashboard/page.tsx
export default async function DashboardPage() {
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <InteractiveClientWidget />
    </main>
  )
}
```

### Client Component (Interactive)
Used for UI that requires state, events, or animations (Framer, GSAP, WebGL).
```tsx
// components/InteractiveClientWidget.tsx
"use client"
import { useState } from 'react'
import { motion } from 'framer-motion'

export function InteractiveClientWidget() {
  const [active, setActive] = useState(false)
  return (
    <motion.button 
      whileHover={{ scale: 1.05 }}
      onClick={() => setActive(!active)}
      className="bg-brand-500 rounded-lg px-4 py-2 text-white"
    >
      Click me
    </motion.button>
  )
}
```

## 3D & Visual Effects Libraries

| Library | When to use | Next.js details |
|---|---|---|
| **TSParticles** | Fire, snow, lightning, neural net links, confetti | Fast, low overhead. Use `@tsparticles/react` + preset. |
| **React Three Fiber (R3F)** | Full 3D scenes, interactive models, WebGL | Must lazy load (`ssr: false`). Pair with `@react-three/drei`. |
| **Spline** | No-code 3D embed | Very easy implementation for premium feel. |
| **GSAP** | Complex timelines, scroll-driven | `gsap.context()` inside `useEffect`, always revert on cleanup. |
| **Framer Motion** | Page transitions, drag, physics | Use `AnimatePresence` + `motion.div` for transitions. |

## Icons
**Mandatory**: ALWAYS use `lucide-react`. **Crucially, all icons MUST use the active theme's gradient color.** Do not use flat colors. 
To achieve this, define an SVG `<linearGradient>` using the theme's CSS variables (`var(--color-primary)`, `var(--color-accent)`) and set the icon's stroke to `url(#theme-gradient)`. Alternatively, use CSS masking. Do not hallucinate SVG icons.

## Mandatory Performance Rules

**Rule 1: SSR disabled for all canvas/WebGL components**
React Three Fiber and Vanta.js will crash during SSR. You must load them dynamically.

**Rule 2: 3D Modals & Carousels (MANDATORY)**
All modals, popups, and carousels MUST use 3D animations (e.g., flipping, tilting, depth scaling) to feel immersive. However, performance must not drop. Achieve this exclusively using native CSS 3D transforms (`perspective`, `rotateX`, `rotateY`, `scale`, `translateZ`) combined with `will-change: transform`. Do not use heavy JS physics for basic entrances. Example: a modal entrance using Framer Motion should transition from `{ scale: 0.95, rotateX: 12, opacity: 0 }` to `{ scale: 1, rotateX: 0, opacity: 1 }` with `translateZ(0)` enabled for GPU acceleration.

- **Mobile Bottom Navigation**: In React layouts, use a sticky bottom navigation bar with Lucide icons (e.g. `Home`, `ShoppingBag`, `ShoppingCart`, `User`) styled with theme variables (`bg-surface-elevated`, `text-text-secondary`, `text-brand`). Never use custom hardcoded SVG paths for icons. Add a React component like the example below:

```tsx
// components/MobileBottomNav.tsx
"use client"
import { useState } from 'react'
import { Home, ShoppingBag, ShoppingCart, User } from 'lucide-react'

export function MobileBottomNav() {
  const [activeTab, setActiveTab] = useState('home')
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border-subtle bg-surface-elevated/80 backdrop-blur-lg md:hidden h-16 shadow-lg">
      <div className="flex h-full items-center justify-around">
        <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all ${activeTab === 'home' ? 'text-brand' : 'text-text-secondary'}`}>
          <Home size={20} />
          <span>Home</span>
        </button>
        <button onClick={() => setActiveTab('shop')} className={`flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all ${activeTab === 'shop' ? 'text-brand' : 'text-text-secondary'}`}>
          <ShoppingBag size={20} />
          <span>Shop</span>
        </button>
        <button onClick={() => setActiveTab('cart')} className={`flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all ${activeTab === 'cart' ? 'text-brand' : 'text-text-secondary'} relative`}>
          <ShoppingCart size={20} />
          <span>Cart</span>
          <span className="absolute -top-1 -right-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] font-bold text-white">3</span>
        </button>
        <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center justify-center gap-1 text-xs font-medium transition-all ${activeTab === 'profile' ? 'text-brand' : 'text-text-secondary'}`}>
          <User size={20} />
          <span>Profile</span>
        </button>
      </div>
    </div>
  )
}
```

**Rule 3: Alert Dialogs (with 3D animations)**
For all system alerts, warnings, and simple confirmation dialogs, ALWAYS use `sweetalert2` (via `sweetalert2-react-content` if React hooks are needed). You MUST customize the SweetAlert2 popup to use one of these **3 custom 3D entrance animations** and apply the active theme's gradient to its confirm buttons.

##### SweetAlert2 3D CSS Animations:
```css
/* globals.css */
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

##### SweetAlert2 Usage in React:
```tsx
import Swal from 'sweetalert2'

Swal.fire({
  title: 'Approved!',
  text: 'Action completed securely.',
  icon: 'success',
  showClass: {
    popup: 'swal2-3d-zoom' // Choose from: swal2-3d-flip, swal2-3d-zoom, swal2-3d-slide-rotate
  },
  customClass: {
    popup: 'glass-panel border-border-subtle rounded-2xl p-6',
    confirmButton: 'px-6 py-2.5 bg-gradient-primary text-white rounded-full font-bold'
  }
})
```

```tsx
import dynamic from 'next/dynamic'

const Scene = dynamic(() => import('@/components/ThreeDScene'), {
  ssr: false,
  loading: () => <div className="h-[400px] w-full animate-pulse bg-zinc-800 rounded-xl" />,
})
```

**Rule 4: Split 3D bundle from main bundle**
Ensure heavy libraries are optimized in `next.config.ts`:
```ts
// next.config.ts
export default {
  experimental: {
    optimizePackageImports: ['three', '@react-three/fiber', '@react-three/drei', 'framer-motion', 'gsap'],
  }
}
```

**Rule 5: Respect reduced motion**
Disable heavy canvas physics if the user requests reduced motion:
```tsx
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (prefersReduced) return <FallbackStaticImage />;
```

**Rule 6: GPU layer hints for animated elements**
Apply `will-change: transform, opacity` and `transform: translateZ(0)` during complex animations to prevent layout thrashing.

**Rule 7: Theme-Aware 3D Colors**
All 3D models, canvas animations (TSParticles, Three.js), and glow effects MUST dynamically inherit their colors from the active CSS variables (e.g., `getComputedStyle(document.body).getPropertyValue('--color-brand')`) so they perfectly match the active theme and update when the user switches themes.

## CSS `@property` Glow Cards

To make glows dynamically match the user's chosen gradient theme in React, define the start and end colors inside each theme block in your CSS:

```css
/* globals.css */
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

@property --glow-opacity { syntax: '<number>'; initial-value: 0; inherits: false; }

.glow-card {
  position: relative;
  transition: --glow-opacity 0.4s ease;
}
.glow-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  background: radial-gradient(
    600px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
    var(--color-glow-start) 0%,
    var(--color-glow-end) 100%
  );
  opacity: var(--glow-opacity);
  transition: opacity 0.4s ease;
  pointer-events: none;
}
.glow-card:hover { --glow-opacity: 1; }
```

## Click-to-Toggle Theme Dropdown Selector in React (with Backdrop)
In React/Next.js, avoid CSS-based hover dropdown triggers for mobile compatibility. Instead, use local state toggle combined with a full-screen backdrop:

```tsx
"use client"
import { useState } from 'react'
import { Palette } from 'lucide-react'

export function ThemeSwitcher() {
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false)
  const [activeGradient, setActiveGradient] = useState('gold')

  const setGradientTheme = (name: string) => {
    setActiveGradient(name)
    localStorage.setItem('gradient-theme', name)
    // document.documentElement adjustments...
    setIsThemeMenuOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
        className="relative z-50 p-2.5 rounded-full hover:bg-zinc-150"
      >
        <Palette size={20} />
      </button>

      {isThemeMenuOpen && (
        <>
          {/* Backdrop dismisser */}
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setIsThemeMenuOpen(false)}
          />

          {/* Dropdown Menu */}
          <div className="absolute right-0 mt-2 w-48 rounded-lg border border-border-subtle bg-surface-elevated/95 backdrop-blur-md shadow-xl py-2 px-1 z-50 transition-all duration-300">
            <button onClick={() => setGradientTheme('gold')}>Aurum Gold</button>
            <button onClick={() => setGradientTheme('nebula')}>Nebula Purple</button>
          </div>
        </>
      )}
    </div>
  )
}
```

## Interactive Autoplay Hero Banner Carousel in React/Next.js
Below is a code template for a 4-image autoplaying, interactive crossfading banner carousel in React/Next.js using standard Tailwind and Framer Motion:

```tsx
"use client"
import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'

const banners = [
  { image: 'url1', tag: 'Tag 1', title: 'Line 1<br />Line 2', desc: 'Desc 1', btnLink: '/url' },
  // ... 4 banners
]

export function HeroBannerCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0)

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % banners.length)
  }, [])

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + banners.length) % banners.length)
  }, [])

  useEffect(() => {
    const timer = setInterval(handleNext, 6000)
    return () => clearInterval(timer)
  }, [handleNext])

  return (
    <section className="relative h-[85vh] flex items-center justify-center bg-zinc-900 overflow-hidden">
      <div className="absolute inset-0 z-0 grid grid-cols-1 grid-rows-1 w-full h-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="col-start-1 row-start-1 w-full h-full relative"
          >
            <img src={banners[currentIndex].image} alt="Banner" className="w-full h-full object-cover opacity-60 scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-zinc-950/20" />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative z-10 w-full max-w-5xl text-center grid grid-cols-1 grid-rows-1 justify-items-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.6 }}
            className="col-start-1 row-start-1 flex flex-col items-center space-y-6 w-full"
          >
            <span className="text-xs uppercase tracking-[0.4em] font-semibold text-brand">{banners[currentIndex].tag}</span>
            <h1 className="font-serif text-4xl sm:text-6xl text-white" dangerouslySetInnerHTML={{ __html: banners[currentIndex].title }} />
            <p className="max-w-xl text-zinc-300">{banners[currentIndex].desc}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <button type="button" className="absolute left-4 z-20 p-3 rounded-full border border-white/10 bg-black/20 text-white backdrop-blur-md" onClick={handlePrev}><ChevronLeft size={20} /></button>
      <button type="button" className="absolute right-4 z-20 p-3 rounded-full border border-white/10 bg-black/20 text-white backdrop-blur-md" onClick={handleNext}><ChevronRight size={20} /></button>
    </section>
  )
}
```

tsx
"use client"
import { useRef } from 'react'

export function GlowCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    ref.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    ref.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }
  
  return (
    <div ref={ref} onMouseMove={onMove} className="glow-card rounded-xl border border-zinc-200/80 bg-white/75 backdrop-blur-md p-6">
      {children}
    </div>
  )
}

## Floating Theme Switcher Component (React)

Below is the React/Next.js equivalent of the floating chat-like theme switcher popup menu. It floats in the bottom-right corner as a chat-like bubble, expands into a theme choice menu with a 3D entrance transition, and saves the theme selection to `localStorage`.

```tsx
"use client"
import { useState, useEffect } from 'react'
import { Paintbrush, X, Check } from 'lucide-react'

// Available exclusively light themes
const themes = [
  { id: 'nebula', name: 'Nebula Light', gradient: 'from-[#7c3aed] to-[#4f46e5]' },
  { id: 'aurora', name: 'Aurora Light', gradient: 'from-[#059669] to-[#0891b2]' },
  { id: 'sunset', name: 'Sunset Light', gradient: 'from-[#e11d48] to-[#d97706]' },
  { id: 'ocean', name: 'Ocean Light', gradient: 'from-[#2563eb] to-[#0d9488]' }
]

export function ThemeSwitcher() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeTheme, setActiveTheme] = useState('nebula')

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'nebula'
    setActiveTheme(saved)
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  const setTheme = (themeId: string) => {
    setActiveTheme(themeId)
    localStorage.setItem('theme', themeId)
    document.documentElement.setAttribute('data-theme', themeId)
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 font-sans">
      {isOpen && (
        <div 
          className="w-64 origin-bottom-right rounded-2xl border border-zinc-200/80 bg-white/90 p-4 shadow-2xl shadow-zinc-300/50 backdrop-blur-xl transition-all duration-300 ease-out will-change-transform"
          style={{
            transform: isOpen ? 'perspective(500px) rotateX(0deg) scale(1)' : 'perspective(500px) rotateX(15deg) scale(0.9) translateY(10px)',
            opacity: isOpen ? 1 : 0
          }}
        >
          <div className="mb-3 flex items-center justify-between border-b border-zinc-100 pb-2">
            <span className="text-sm font-semibold text-zinc-800">Customize Theme</span>
            <button 
              onClick={() => setIsOpen(false)} 
              className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              aria-label="Close theme menu"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid gap-2">
            {themes.map((theme) => (
              <button
                key={theme.id}
                onClick={() => setTheme(theme.id)}
                className={`flex items-center justify-between rounded-xl border p-2 text-left transition-all hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-brand/50 ${activeTheme === theme.id ? 'border-zinc-300 bg-zinc-50' : 'border-transparent'}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-6 w-6 rounded-full bg-gradient-to-br ${theme.gradient} shadow-sm`} />
                  <span className="text-sm font-medium text-zinc-700">{theme.name}</span>
                </div>
                {activeTheme === theme.id && (
                  <Check size={16} className="text-zinc-600" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[image:var(--gradient-primary)] text-white shadow-lg shadow-zinc-300/50 transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
        aria-label="Toggle theme settings"
      >
        {isOpen ? (
          <X size={24} className="transition-transform duration-300 rotate-90" />
        ) : (
          <Paintbrush size={24} className="transition-transform duration-300 hover:rotate-12" />
        )}
      </button>
    </div>
  )
}

## Next.js Category SPA Routing (Zero-Reload Page Filters)

Instead of using query parameters (e.g. `?category=outerwear`), which can trigger full server re-renders or require complex search parameter handling, Next.js App Router applications should use optional dynamic segments: `app/shop/[[category]]/page.tsx`.

1. **Route Segment Access**: Access the dynamic category directly in the page component props (React 19 / Next.js 15+ asynchronous `params` prop style):
```tsx
// app/shop/[[category]]/page.tsx
interface PageProps {
  params: Promise<{ category?: string }>
}

export default async function ShopPage({ params }: PageProps) {
  const resolvedParams = await params
  const activeCategory = resolvedParams.category || 'all'
  
  return (
    <ShopContent activeCategory={activeCategory} />
  )
}
```
2. **Anchor Navigation**: Use Next.js `<Link>` for fast client-side navigation without page reloading:
```tsx
import Link from 'next/link'

// In your category switcher:
<Link 
  href={category === 'all' ? '/shop' : `/shop/${category}`} 
  className={activeCategory === category ? 'text-active font-bold' : ''}
>
  {category}
</Link>
```

## Troubleshooting `EMFILE: too many open files`

During development or build processes (especially when watching files in Next.js), you might encounter the following error:
```
Watchpack Error (watcher): Error: EMFILE: too many open files
```

This occurs when the number of open files or the system's inotify watch limits are too low for the size of your project.

### 1. Increase Shell File Limit
Temporary limit increase (for current terminal session):
```bash
ulimit -n 65536
```
To make it permanent, add the following line to your shell configuration file (e.g., `~/.bashrc`, `~/.zshrc`):
```bash
ulimit -n 65536
```
Or configure it system-wide in `/etc/security/limits.conf`:
```text
* soft nofile 65536
* hard nofile 65536
```

### 2. Increase System-wide inotify Watches
To check your current limits:
```bash
cat /proc/sys/fs/inotify/max_user_watches
```
Temporary limit increase:
```bash
sudo sysctl fs.inotify.max_user_watches=524288
```
To make it permanent, add or update the setting in `/etc/sysctl.conf` or `/etc/sysctl.d/90-inotify.conf`:
```text
fs.inotify.max_user_watches=524288
```
Then apply the changes:
```bash
sudo sysctl -p
```

## 3D Interactive Carousel Component (React / Next.js)

Below is the React/Next.js interactive 3D carousel component code template. It positions cards in a 3D circle/ring, supports click-to-center with shortest-path rotation, touch/mouse dragging, autoplay with progress bar, active card mouse-tracking 3D tilt, and active theme dynamic hover glows.

```tsx
// ThreeDCarousel.tsx
"use client"
import React, { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Play, Pause, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils' // Adjust path as needed

interface CarouselItem {
  id: number
  image: string
  title: string
  category: string
  description: string
  link: string
  price?: string
}

interface ThreeDCarouselProps {
  items: CarouselItem[]
  autoplay?: boolean
  interval?: number
  className?: string
}

export function ThreeDCarousel({ items: rawItems, autoplay = true, interval = 5000, className }: ThreeDCarouselProps) {
  // Duplicate items if N < 6 to prevent side items from becoming edge-on (sideways) and invisible in 3D circle
  const items = React.useMemo(() => {
    let list = [...rawItems]
    if (list.length === 0) return []
    while (list.length < 6) {
      list = [...list, ...rawItems]
    }
    return list
  }, [rawItems])

  const N = items.length
  const theta = 360 / N
  const radius = 280

  // Runes-like React State
  const [activeIndex, setActiveIndex] = useState(0)
  const [rotationAngle, setRotationAngle] = useState(0)
  const [isAutoplayActive, setIsAutoplayActive] = useState(autoplay)
  const [touchStartX, setTouchStartX] = useState(0)
  const [touchEndX, setTouchEndX] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [tiltX, setTiltX] = useState(0)
  const [tiltY, setTiltY] = useState(0)

  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const activeOriginalIndex = activeIndex % (rawItems.length || 1)

  const rotateTo = (index: number) => {
    let diff = index - activeIndex
    if (diff > N / 2) diff -= N
    if (diff < -N / 2) diff += N
    setRotationAngle(prev => prev - diff * theta)
    setActiveIndex((index + N) % N)
  }

  const handleNext = () => {
    setRotationAngle(prev => prev - theta)
    setActiveIndex(prev => (prev + 1) % N)
  }

  const handlePrev = () => {
    setRotationAngle(prev => prev + theta)
    setActiveIndex(prev => (prev - 1 + N) % N)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX)
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const swipeThreshold = 50
    const endX = e.changedTouches[0].clientX
    if (touchStartX - endX > swipeThreshold) handleNext()
    else if (endX - touchStartX > swipeThreshold) handlePrev()
  }

  // Active Card 3D Tilt on Mouse Move
  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>, isActive: boolean) => {
    if (!isActive) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const px = x / rect.width - 0.5
    const py = y / rect.height - 0.5
    setTiltX(-py * 12) // Max 12 deg tilt
    setTiltY(px * 12)
  }

  const handleMouseLeave = () => {
    setTiltX(0)
    setTiltY(0)
  }

  useEffect(() => {
    if (isAutoplayActive && !isHovered) {
      timerRef.current = setInterval(handleNext, interval)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isAutoplayActive, isHovered, activeIndex])

  return (
    <div 
      className={cn("relative w-full overflow-hidden bg-zinc-950 py-16 px-4 flex flex-col items-center justify-center min-h-[580px] select-none", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 3D Perspective Scene Container */}
      <div 
        className="relative w-full max-w-[800px] h-[380px] flex items-center justify-center"
        style={{ perspective: '1200px' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Rotating Stage */}
        <div 
          className="relative w-[280px] h-[350px] transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ 
            transformStyle: 'preserve-3d',
            transform: `rotateY(${rotationAngle}deg)` 
          }}
        >
          {items.map((item, i) => {
            const isActive = i === activeIndex
            return (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "absolute inset-0 w-full h-full rounded-xl overflow-hidden border transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] cursor-pointer text-left shadow-2xl focus:outline-none",
                  isActive 
                    ? "border-brand/40 opacity-100 scale-100 z-30 shadow-brand/20" 
                    : "border-zinc-800/80 opacity-50 scale-90 z-10 shadow-black/50"
                )}
                style={{
                  transformStyle: 'preserve-3d',
                  transform: `rotateY(${i * theta}deg) translateZ(${radius}px) ${isActive ? `rotateX(${tiltX}deg) rotateY(${tiltY}deg)` : ''}`,
                  filter: isActive ? 'none' : 'brightness(0.55) blur(1.5px)'
                }}
                onClick={() => rotateTo(i)}
                onMouseMove={(e) => handleMouseMove(e, isActive)}
                onMouseLeave={handleMouseLeave}
              >
                <div className="relative w-full h-full">
                  <img src={item.image} alt={item.title} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/35 to-transparent"></div>
                  
                  <span className="absolute top-4 left-4 px-2 py-0.5 text-[9px] font-semibold tracking-widest uppercase bg-zinc-950/70 border border-zinc-800/50 text-brand rounded-sm backdrop-blur-sm">
                    {item.category}
                  </span>

                  <div className="absolute bottom-0 left-0 right-0 p-5 space-y-1">
                    <h3 className="font-serif text-lg font-semibold text-white tracking-wide leading-tight">
                      {item.title}
                    </h3>
                    {item.price && (
                      <p className="text-[10px] text-brand font-bold tracking-widest">{item.price}</p>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Description Panel */}
      <div className="relative w-full max-w-md mx-auto mt-6 text-center space-y-2 h-24">
        <span className="text-[10px] font-bold tracking-widest text-brand uppercase">
          {rawItems[activeOriginalIndex]?.category}
        </span>
        <h3 className="font-serif text-xl font-medium text-white">
          {rawItems[activeOriginalIndex]?.title}
        </h3>
        <p className="text-xs text-zinc-400 font-light leading-relaxed max-w-sm mx-auto">
          {rawItems[activeOriginalIndex]?.description}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 mt-4">
        <button onClick={handlePrev} className="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95">
          <ChevronLeft size={16} />
        </button>
        <button onClick={() => setIsAutoplayActive(!isAutoplayActive)} className="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95">
          {isAutoplayActive ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <button onClick={handleNext} className="p-2 rounded-full border border-zinc-800 hover:border-brand/40 text-zinc-400 hover:text-white transition active:scale-95">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
```

## Click-to-Toggle Theme Dropdown Selector in React (with Backdrop)
In React/Next.js, avoid CSS-based hover dropdown triggers for mobile compatibility. Instead, use local state toggle combined with a full-screen backdrop:

```tsx
"use client"
import { useState } from 'react'
import { Palette } from 'lucide-react'

export function ThemeSwitcher() {
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false)
  const [activeGradient, setActiveGradient] = useState('gold')

  const setGradientTheme = (name: string) => {
    setActiveGradient(name)
    localStorage.setItem('gradient-theme', name)
    // document.documentElement adjustments...
    setIsThemeMenuOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
        className="relative z-50 p-2.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <Palette size={20} />
      </button>

      {isThemeMenuOpen && (
        <>
          {/* Backdrop dismisser */}
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setIsThemeMenuOpen(false)}
          />

          {/* Dropdown Menu */}
          <div className="absolute right-0 mt-2 w-48 rounded-lg border border-border-subtle bg-surface-elevated/95 backdrop-blur-md shadow-xl py-2 px-1 z-50 transition-all duration-300">
            <button onClick={() => setGradientTheme('gold')}>Aurum Gold</button>
            <button onClick={() => setGradientTheme('nebula')}>Nebula Purple</button>
          </div>
        </>
      )}
    </div>
  )
}
```

## Interactive Autoplay Hero Banner Carousel in React/Next.js
Below is a code template for a 4-image autoplaying, interactive crossfading banner carousel in React/Next.js using standard Tailwind and Framer Motion:

```tsx
"use client"
import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react'

const banners = [
  { image: 'url1', tag: 'Tag 1', title: 'Line 1<br />Line 2', desc: 'Desc 1', btnLink: '/url' },
  // ... 4 banners
]

export function HeroBannerCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0)

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % banners.length)
  }, [])

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + banners.length) % banners.length)
  }, [])

  useEffect(() => {
    const timer = setInterval(handleNext, 6000)
    return () => clearInterval(timer)
  }, [handleNext])

  return (
    <section className="relative h-[85vh] flex items-center justify-center bg-zinc-900 overflow-hidden">
      <div className="absolute inset-0 z-0 grid grid-cols-1 grid-rows-1 w-full h-full">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="col-start-1 row-start-1 w-full h-full relative"
          >
            <img src={banners[currentIndex].image} alt="Banner" className="w-full h-full object-cover opacity-60 scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 to-zinc-950/20" />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative z-10 w-full max-w-5xl text-center grid grid-cols-1 grid-rows-1 justify-items-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.6 }}
            className="col-start-1 row-start-1 flex flex-col items-center space-y-6 w-full"
          >
            <span className="text-xs uppercase tracking-[0.4em] font-semibold text-brand">{banners[currentIndex].tag}</span>
            <h1 className="font-serif text-4xl sm:text-6xl text-white" dangerouslySetInnerHTML={{ __html: banners[currentIndex].title }} />
            <p className="max-w-xl text-zinc-300">{banners[currentIndex].desc}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <button type="button" className="absolute left-4 z-20 p-3 rounded-full border border-white/10 bg-black/20 text-white backdrop-blur-md" onClick={handlePrev}><ChevronLeft size={20} /></button>
      <button type="button" className="absolute right-4 z-20 p-3 rounded-full border border-white/10 bg-black/20 text-white backdrop-blur-md" onClick={handleNext}><ChevronRight size={20} /></button>
    </section>
  )
}
```

