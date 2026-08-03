# Konoha Full Production App Architecture & Directives

> Read when: executing a build_from_text or build_from_source scaffolding task.
>
> **THIS IS MANDATORY FOR EVERY SPA ARCHITECTURE BUILD.** This document replaces the previously hardcoded constraints in the orchestrator.

## FULL PRODUCTION APP ARCHITECTURE

The generated website MUST be a complete, production-ready Single Page Application (SPA) with internal client-side routing (e.g. Home, Catalog, Cart, Account views) implemented in ONE SHOT. Do NOT generate a simple landing page UNLESS the user explicitly requests to build a 'landing page'. If they request a landing page, then build it as a landing page. Otherwise, generate a FULL SPA APPLICATION.

**Page 1 — Home/Beranda**: Hero banner with 3D carousel (min 4 slides with domain-relevant imagery and specs), stats counter banner, brand/category grid, featured items showcase (6-8 cards), customer testimonials carousel, and trade-in/CTA banner.

**Page 2 — Catalog/Showroom**: MUST contain exactly 50 dummy data items relevant to the domain described in the user prompt. Each item must have: id, name, category, brand, price, year/date, image URL (use picsum.photos), rating, description, specs object, and boolean flags (featured, new, popular). Implement a 100% reactive multi-criteria filter engine with: category filter (checkboxes or pills), brand filter, price range slider (min/max), sort dropdown (price low-high, price high-low, newest, popular, rating), and a LIVE SEARCH BAR that filters items by name/description in real-time. All filters must work simultaneously and reactively. Display items in a responsive grid with 3D hover cards.

**Page 3 — About Us**: Company legacy/history section, mission & vision, core values grid (3-4 values with icons), executive leadership team grid (4-6 members with avatar placeholders, name, role, bio), milestone statistics banner, and awards/certifications.

**Page 4 — Contact Us**: Interactive inquiry form (name, email, phone, subject dropdown, message textarea with validation), direct support cards (Phone Hotline, WhatsApp, Email with click-to-action), office address with operating hours, and FAQ accordion (minimum 5 questions).

**Page 5 — Location & Branch Finder**: Interactive branch selector with minimum 3 branch locations (each with name, full address, phone, coordinates, operating hours, available item count), map preview card with Google Maps directions CTA button, and branch detail cards.

**Page 6 — Auth System**: Login/Register modal or page with tab switcher between Login, Register, and Forgot Password forms. Include social auth buttons (Google, Facebook), form validation (email format, password strength), and remember me checkbox. Show logged-in user name in navbar after login.

**ROUTING**: For Next.js use App Router with `app/` directory. For Nuxt use `pages/` directory. For Svelte/SvelteKit ALWAYS use SvelteKit file-based routing with `src/routes/+page.svelte` and `+layout.svelte`. NEVER use hash-based SPA routing with activePage store. For Angular use Angular Router. The navbar and mobile bottom nav must have working navigation links to ALL 6 pages. Current active page must be visually highlighted in both navbar and bottom nav.

**NAVBAR**: Desktop navbar with logo, navigation links to all pages (Home, Catalog, About, Contact, Location), Login/Register button, and search icon. Must be sticky/fixed on scroll with glassmorphism background.

**MOBILE BOTTOM NAV**: Sticky bottom navigation dock for mobile with 5 icon tabs (Home, Catalog, Location, Contact, and Menu/More). Active tab must be highlighted with theme gradient. Must use rounded pill shape for active indicator.

**DATA LAYER**: Create a dedicated data file (e.g., `data/items.ts`, `lib/data/items.ts`, or `composables/useItems.ts`) containing the 50 dummy items array, category/brand constants, filter utility functions, and any shared types/interfaces. This data file is the single source of truth — components import from it.

---

## KONOHA DESIGN SYSTEM (MANDATORY)

DS-1. Google Fonts: import DM Sans (400/500/700) + Roboto (100-900) at the top of global CSS.
DS-2. CSS Variables: `--color-bg:#F8F8F8; --color-black:#000; --color-accent:#C89B77; --color-muted:#666; --color-border:#E5E5E5; --font-primary:'DM Sans'; --font-body:'Roboto'`. Tailwind `@tailwind` directives MUST precede these.
DS-3. Header: transparent default -> glassmorphism (rgba(255,255,255,0.95)+backdrop-filter:blur(12px)) on scroll. Logo left, nav center, action icons right. Mobile: show logo+icons ONLY — NO hamburger menu.
DS-4. Hero: Premium full image wide carousel with interactive 3D. Full-width edge-to-edge hero banner (100vw). Must break out of any container padding (e.g. w-[100vw] max-w-none absolute left-0 right-0 or negative margins). Must have modern 3D animation effect like 'open windows' on load, and interactive 3D mouse-tracking hover animation. Auto-advance 4.5s.
DS-5. Product Cards: 3D hover tilt perspective(1000px) rotateX(4deg) rotateY(-4deg) scale3d(1.02,1.02,1) + shadow. Quick-add overlay slides up (translateY 100%->0) on hover.
DS-6. 10-Theme Switcher: ALWAYS a floating button fixed to bottom-left for BOTH mobile and desktop (fixed bottom-4 left-4 z-50 in Tailwind). NEVER place this button in the header. Circular trigger, popup opens upward. 10 Light Mode gradient themes. Persist selection in localStorage key 'konoha-theme'. Theme IDs: crimson-amber, ocean-cyan, emerald-teal, violet-pink, sunset-orange, midnight-indigo, rose-gold, forest-mint, royal-blue, amber-copper.
DS-7. Sticky Mobile Bottom Dock: ALWAYS fixed bottom-0, z-index:999, backdrop-filter:blur(16px). 5 nav items (Home, Shop/Showroom, Wishlist, Cart, Account). Active item = `--color-accent` indicator. Mobile ONLY (<=1024px display). This is the SOLE mobile navigation — no hamburger menu. Ensure desktop header navigation links are strictly hidden on mobile screens (e.g. hidden md:flex) to prevent duplicate menus. NEVER use emojis for icons.
DS-8. Error Pages (4xx/5xx): Interactive 5-mode animation switcher (Crash Debris, Ice Frost, Rainy Drops, Lightning Storm, Glass Crack — canvas/SVG overlays). Giant outlined error code text (-webkit-text-stroke). Rich illustrated 3D hero. CTA: Back to Home + Contact Support.
DS-9. Footer: Dark (#111) background, multi-column links, 'Build by Konoha' watermark (font-size:11px; color:#999).
DS-10. Icons: MUST use real icon libraries (e.g. lucide-react, lucide-svelte, lucide-angular) for ALL icons. NEVER use emojis as icons in the UI.

---

## DESIGN DIRECTIVES

1. **Package Manager Mandate**: ALWAYS use `pnpm` (e.g. `pnpm dlx create-next-app@latest`, `pnpm create`, `pnpm install`, `pnpm run dev`). NEVER use `npm` or standalone `npx`.
1b. **Tailwind CSS Enforcement**: You MUST install and fully configure Tailwind CSS. If Tailwind is not working, the design will fail.
2. **NO DARK MODE**: All layouts MUST be Light Mode only. NEVER use dark backgrounds, dark themes, or dark color schemes. Backgrounds must be clean, bright, and elegant (white, off-white, subtle warm grays, or light gradient washes).
3. **Premium Gradient Color Theme**: Use a single, cohesive premium gradient color palette throughout the entire site. Define CSS custom properties for `--gradient-primary` (e.g. `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`), `--gradient-accent`, `--color-primary`, `--color-accent` in `globals.css` / `app.css`. All buttons, headings, icons, borders, and interactive elements must use these gradient variables. NO flat/generic colors (plain red, blue, green). Use curated HSL-based harmonious palettes.
4. **10-Theme Switcher (Light Mode Only)**: Implement the custom 10-theme switcher component (Nebula, Aurora, Sunset, Ocean, Forest, Volcano, Sakura, Cyberpunk, Midnight, Gold) saved to `localStorage`. It MUST NOT include dark mode options (since the site is strictly Light Mode), providing 10 distinct, premium gradient color themes for the user to select from dynamically. ALWAYS fixed bottom-left for BOTH mobile and desktop.
5. **Homepage Hero Banner 3D Carousel**: Premium full image wide carousel with interactive 3D. Full-width edge-to-edge hero section with interactive 3D carousel slider (minimum 4 images), modern 3D animation effect like 'open windows', and interactive animation on mouse hover. Smooth autoplay with controls. Must be highly responsive for mobile/desktop.
6. **Minimum 5 Interactive 3D Carousels**: Newly generated websites MUST feature at least 5 interactive 3D carousels (e.g. hero slide deck, category showcases, featured items, customer lookbook, testimonials/reviews) using 3D CSS transforms (`perspective`, `rotateX`/`rotateY`, `translateZ`, `scale`).
7. **3D GPU Card Hover & Animated Glows in ALL Cards**: EVERY single card component (e.g. product cards, features, categories, testimonials) must feature 3D perspective rotation on hover (`card-3d`) combined with radial mouse-tracking gradient glow borders.
8. **Custom 3D SweetAlert2 Dialogs**: All system alerts, confirmations, warnings, and prompt dialogs MUST use `sweetalert2` configured with 3D entrance transitions (`showClass`) and active theme gradient confirm buttons.
9. **Premium & Elegant Look**: The design must feel luxurious and state-of-the-art. Use modern premium typography (Google Fonts: Inter, Outfit, or Playfair Display for headings), generous whitespace, smooth glassmorphism (`backdrop-blur`), subtle shadows with depth layers, and polished border treatments.
10. **Custom Styled SVG/CSS Logo**: Premium inline SVG icon + gradient typography logo in header and footer, dynamically displaying the project name.
11. **Footer Watermark**: Must include small, elegant typography watermark: `Build by Konoha`.
12. **Custom Error Pages (4xx & 5xx)**: Create unique, premium, and visually delightful error pages for 400, 403, 404, 500, 502, and 503 status codes with cute 3D animated illustrations.
13. **Mobile Bottom Navigation**: Sticky bottom nav bar with real SVG icons (e.g. Lucide) for mobile, using gradient theme variables. DO NOT USE EMOJIS.
14. **Auto-open Browser**: Start dev server with `--open` flag (`pnpm run dev --open`).
Use high-quality visually appealing placeholder images (e.g., from Unsplash or picsum.photos) for any required media assets.

---

## PERFORMANCE DIRECTIVES

1. Lazy load all heavy components (3D, WebGL, carousels) with dynamic imports and `ssr: false`.
2. Use `next/image` (Next.js) or optimized image components for all images with proper `width`, `height`, `loading='lazy'`, and `sizes` attributes.
3. Split 3D bundles from main bundle using `optimizePackageImports` in framework config.
4. Respect `prefers-reduced-motion` with graceful fallbacks.
5. Minimize client-side JavaScript — default to Server Components (Next.js) or server-side rendering where possible.

---

## SEO DIRECTIVES

1. Implement proper `<title>` and `<meta name='description'>` on every page with unique, keyword-rich content.
2. Use a single `<h1>` per page with proper heading hierarchy (h1 > h2 > h3).
3. Use semantic HTML5 elements (`<nav>`, `<main>`, `<article>`, `<section>`, `<aside>`, `<footer>`).
4. Add Open Graph (`og:title`, `og:description`, `og:image`) and Twitter Card meta tags.
5. Generate `sitemap.xml` and `robots.txt`.
6. Add structured data (JSON-LD) for the primary content type.
7. Ensure all images have descriptive `alt` attributes.
8. Use canonical URLs to prevent duplicate content.

---

## SECURITY DIRECTIVES

1. Implement Content Security Policy (CSP) headers.
2. Add X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy headers.
3. Sanitize all user inputs. Never use `dangerouslySetInnerHTML` with user-provided content.
4. Use CSRF protection for all form submissions and server actions.
5. Never expose API keys, tokens, or secrets to the client/browser. All sensitive values MUST be server-side only.
6. Validate and sanitize server-side. Use parameterized queries for any database operations.

---

## QUALITY GUARANTEE

1. PACKAGE MANAGER DIRECTIVE: **NEVER use `npm` or `yarn` under any circumstances.** ALWAYS use `pnpm`.
2. Ensure no deprecated libraries/modules during `pnpm install`; update them to the latest version immediately if any warnings appear.
3. DO NOT hardcode ANY sensitive or environment-specific values. Extract ALL secrets, API keys, database URLs, and configuration values into `.env` files. Provide a `.env.example` file with placeholder values and comments documenting each variable.
4. Ensure ALL libraries and dependencies are safe from known CVEs (Common Vulnerabilities and Exposures). Run `pnpm audit` and `pnpm audit fix` to resolve ALL high/critical vulnerabilities.
5. The build result MUST have ZERO errors and ZERO warnings during both `pnpm lint` and `pnpm build`. No exceptions.
6. Ensure the final result is highly stable, specifically tailored for production-grade deployments.

---

## EXISTING PROJECT GUARDRAILS

1. If working in an existing project, NEVER touch or modify existing logic, components, or code that the user did not explicitly ask to change.
2. Only do exactly what the user requested. If you have improvement ideas, ASK the user first before implementing.
3. NEVER hallucinate, fabricate, or silently update/change design elements, colors, layouts, or functionality without the user's explicit knowledge and approval.
