---
name: jonin-skill
description: Standard Operating Procedures and router for premium UI development, visual QA, component architecture, and 3D web experiences.
tags:
  - jonin
  - frontend
  - ui
  - tailwind
  - svelte
  - nextjs
  - svelteui
---

# Jonin: UI & Frontend Specialist (Router)

This skill provides the **Standard Operating Procedures (SOP)** and routing logic for the Jonin (Frontend Builder) when tasked with creating web interfaces, styling components, or implementing animations.

> [!CAUTION]  
> **Visual Excellence is Mandatory**: You must never deliver a "basic" or "minimal viable" design. Every component must feel premium, using modern typography, harmonious colors, smooth gradients, and interactive micro-animations.

## Domain Routing

Based on the user's request, load the specific reference file to understand the architecture and conventions. **Never guess the implementation details.**

| If the request involves... | Load this reference |
|---|---|
| SvelteKit app code, pages, routes, load functions, form actions, state management, SvelteKit security | `references/svelte-code-expert.md` |
| SvelteKit components, UI architecture, `$derived`, `$effect`, snippets, SvelteUI | `references/svelte-ui-expert.md` |
| Next.js app code, router, security, hooks, state management, ESLint, Prettier config | `references/nextjs-code-expert.md` |
| Next.js UI, client components, Framer Motion, R3F, 3D scenes, animations | `references/nextjs-ui-expert.md` |
| 3D scenes, WebGL, R3F, Spline, TSParticles, heavy animations | `references/nextjs-ui-expert.md` |
| Styling, Tailwind v4 setup, glassmorphism, micro-animations, typography | `references/tailwind-design-system.md` |

## 🛠️ Technology Stack
- **Default Stack**: SvelteKit + Tailwind v4 + pnpm
- **Alternative Stack**: Next.js 16 + Tailwind v4 + pnpm (When React is explicitly requested)

## 💎 MANDATORY VISUAL EFFECTS (ZERO EXCEPTION)
For EVERY website you generate or build, you MUST implement these premium visual features:
1. **The 10 Gradient Themes & Switcher**: Nebula (purple-blue), Aurora (emerald-cyan), Sunset (rose-amber), Ocean (blue-teal), Forest (green-emerald), Volcano (red-orange), Sakura (pink-rose), Cyberpunk (magenta-violet), Midnight (indigo-slate), and Gold (amber-yellow) defined via `@theme` in `app.css` / `globals.css`. A functional theme switcher saved to `localStorage` must be included.
2. **Homepage Hero Banner 3D Carousel**: The homepage banner/hero section MUST be an interactive 3D carousel slider featuring a minimum of 4 images, utilizing GPU-accelerated 3D transition effects (such as 3D cube rotation, 3D card flipping, coverflow, or perspective carousel rotation) and smooth control transitions.
3. **Standard Minimum 5 Interactive 3D Carousels**: Newly generated websites MUST feature at least **5 interactive 3D carousels** (e.g. hero slide deck, category showcases, featured items, customer lookbook, testimonials/reviews). These carousels must utilize GPU-accelerated 3D CSS transforms (using `perspective`, `rotateX`/`rotateY`, `translateZ`, and `scale`) with full transition handles and navigation control elements.
4. **3D GPU Card Hover & Animated Glows in ALL Cards**: EVERY single card component (e.g. product cards, features, categories, testimonials) must feature a 3D perspective rotation on hover (using CSS card-3d styles) combined with a dynamic GPU-accelerated animated glow border or radial mouse-tracking gradient glow.
5. **Custom 3D SweetAlert2 Dialogs**: All system alerts, success/error confirmations, warnings, and prompt dialogs MUST use `sweetalert2` configured with a 3D entrance transition (via `showClass` and custom CSS transforms) and confirm buttons styled with the active theme's gradient.
6. **Custom Styled SVG/CSS Logo**: Newly generated websites MUST feature a custom, premium logo in both the header and footer consisting of a styled inline SVG icon combined with custom CSS gradient typography (or a fully custom visual SVG mark) dynamically displaying the project's name as specified in the user's prompt (instead of static default placeholders like VIBELAB). Never leave the logo empty/missing.
7. **Footer Watermark**: The footer of all newly generated websites MUST feature the watermark text: `Build with Antigravity and Konoha agentic AI` in small, muted typography.

---

## SOP 1: New Component Building
*When asked to build a new UI element (e.g., a dashboard card, a navigation bar).*

1. **Design System Adherence**: 
   - Check `app.css` or `index.css` for existing CSS variables, theme colors, and custom Tailwind utilities.
   - Use established design tokens instead of hardcoding random hex colors.
2. **Structure & Layout**:
   - Use Semantic HTML (`<nav>`, `<main>`, `<article>`, `<aside>`).
   - Use CSS Grid for complex layouts, and Flexbox for linear alignment.
3. **Premium Styling Checklist**:
   - [ ] Are backgrounds using subtle gradients or glassmorphism (`backdrop-blur`) instead of flat colors?
   - [ ] Is typography distinct? (Use font weights, tracking-tight for headings, leading-relaxed for body).
   - [ ] Are there subtle borders/shadows? (e.g., `border border-white/10 shadow-xl shadow-black/50`).
4. **Interactivity**:
   - Add hover states with smooth transitions (`transition-all duration-300`).
   - Add active/focus states for accessibility.
   - Implement micro-animations for interactions (e.g., scaling up a button on hover `hover:scale-105`).

## SOP 2: Visual QA & Responsive Design
*When updating an existing page or finishing a new component.*

1. **Responsive Verification**:
   - Ensure the component uses mobile-first Tailwind classes.
   - Check behavior at `sm:`, `md:`, `lg:`, and `xl:` breakpoints.
   - Never let text overflow its container on small screens (use `break-words` or `truncate`).
2. **Browser Testing**:
   - If UI visual changes are significant, use the `agent-browser` tool to render the page and verify the layout visually.
3. **Contrast & Accessibility**:
   - Ensure text contrast is readable in both Light and Dark modes.

## SOP 3: Refactoring Legacy CSS to Tailwind v4
*When tasked with modernizing old stylesheets.*

1. **Map the Values**: Identify exact pixel values and map them to standard Tailwind spacing/sizing utilities.
2. **Extract Components**: If a pattern is repeated >3 times, extract it into a dedicated Svelte/React component rather than using massive `@apply` blocks.
3. **Clean Up**: Remove the old CSS file and update the imports.

## SOP 4: Zero-Error Guarantee & Verification Loop (SvelteKit & Next.js)
*Mandatory verification rules when generating or modifying frontend code.*

1. **Initial Setup (Lint & Formatter)**: Whenever you create or generate a new Svelte/SvelteKit or React/Next.js website, you MUST immediately:
   - Configure ESLint flat config (`eslint.config.js` or `eslint.config.mjs`) and Prettier (`.prettierrc`).
   - Add lint and format scripts to `package.json`:
     - SvelteKit: `"lint": "prettier --check . && eslint ."` and `"format": "prettier --write ."`
     - Next.js: `"lint": "prettier --check . && next lint"` and `"format": "prettier --write ."`
   - Run `pnpm run format` to ensure files are formatted.
2. **A11y & Compiler Compliance (Svelte / React JSX)**:
   - **Click/Interaction Handlers**: Any element with interaction handlers (like `onclick`/`onClick`, `onkeydown`/`onKeyDown`, `onmousemove`/`onMouseMove`, etc.) must have an appropriate ARIA role (e.g., `role="presentation"` for purely presentational visual hover animations, `role="dialog"` for modals/drawers).
   - **Dialogs & Modals**: Interactive container roles like `role="dialog"` must have a `tabindex`/`tabIndex` value (typically `tabindex="-1"` / `tabIndex={-1}` for modals/drawers to allow focus management), keyboard event handlers (`onkeydown`/`onKeyDown` to stop propagation/close the modal), and appropriate labels (`aria-modal="true"`, `aria-labelledby="..."`).
   - **Hidden Buttons**: Hidden buttons (e.g. `<button type="submit" class="hidden">` inside forms) must have an `aria-label="..."` or `title="..."` attribute.
   - **Imports & Variables**: Ensure there are no unused imports or variables, as these will trigger typescript-eslint errors.
3. **Verification & Autonomous Fixes Loop**: Post-generation, you MUST execute these commands yourself using your tools. NEVER command the user or print instructions telling the user to execute these steps manually:
   - **pnpm install**: Run `pnpm install` (or `pnpm install --no-engine-strict` if standard install fails due to `ERR_PNPM_UNSUPPORTED_ENGINE`) to set up node_modules.
   - **ESLint & Svelte Check**: Run `pnpm run lint` and `pnpm run check` (svelte-check, if using SvelteKit) / `pnpm svelte-kit sync` (to generate TS config mappings first). If there are any linting or compilation warnings or errors, you MUST locate the offending files, read the exact error lines, and modify the code to fix them. Repeat this cycle until both commands output zero errors and zero warnings.
   - **pnpm build**: Run `pnpm run build` to verify the production build. If any warnings (e.g. CSS compilation warnings, unused export warnings) or errors occur, trace the cause, edit the files, and re-run the build until it completes with 100% success, zero errors, and zero warnings.
4. **Dev Server & Autonomous Preview**:
   - Once linting and build checks are completely clean, start the development server by running `pnpm run dev` in the background as an asynchronous task.
   - You MUST auto-open the browser to the local dev URL (e.g. `http://localhost:5173`) using `agent-browser` or by launching the preview tool to visually QA the layout. Do not ask the user for permission; perform this QA step completely autonomously.
