---
name: jonin-skill
description: Standard Operating Procedures and router for premium UI development, design match comparison, component architecture, and 3D web experiences.
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

> [!NOTE]
> **Tool Usage & Token Preservation**: Use **`skills-db` MCP** server (`find_skill`, `get_skill`) for all skill/instruction discovery. Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it for skills burns quota tokens. Always use `skills-db` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.

## Domain Routing

Based on the user's request, load the specific reference file using `skills-db.get_skill("jonin-skill/<reference-name>")` to understand the architecture and conventions. **Never guess the implementation details or read files under .agents/skills/ directly.**

| If the request involves... | Load this reference |
|---|---|
| SvelteKit app code, pages, routes, load functions, form actions, state management, SvelteKit security | `jonin-skill/svelte-code-expert` |
| SvelteKit components, UI architecture, `$derived`, `$effect`, snippets, SvelteUI | `jonin-skill/svelte-ui-expert` |
| Next.js app code, router, security, hooks, state management, ESLint, Prettier config | `jonin-skill/nextjs-code-expert` |
| Next.js UI, client components, Framer Motion, R3F, 3D scenes, animations | `jonin-skill/nextjs-ui-expert` |
| 3D scenes, WebGL, R3F, Spline, TSParticles, heavy animations | `jonin-skill/nextjs-ui-expert` |
| Styling, Tailwind v4 setup, glassmorphism, micro-animations, typography | `jonin-skill/tailwind-design-system` |

## 🛠️ Technology Stack
- **Default Stack**: SvelteKit + Tailwind v4 + pnpm
- **Alternative Stack**: Next.js 16 + Tailwind v4 + pnpm (When React is explicitly requested)

## 💎 MANDATORY VISUAL EFFECTS (ZERO EXCEPTION)
> [!NOTE]
> **Source Design Image Exception**: If you are building based on a source design image (using the `build_with_image_design` tool), this default visual effects template MUST be skipped. You MUST build the storefront strictly based on the design images and mockups without adding these default visual effects (such as the 10-theme switcher, 3D carousels, 3D hovers, SweetAlert2 modal, or watermark) unless they are explicitly shown in the design images.

For EVERY website you generate or build from text, you MUST implement these premium visual features:
1. **The 10 Gradient Themes & Switcher**: Nebula (purple-blue), Aurora (emerald-cyan), Sunset (rose-amber), Ocean (blue-teal), Forest (green-emerald), Volcano (red-orange), Sakura (pink-rose), Cyberpunk (magenta-violet), Midnight (indigo-slate), and Gold (amber-yellow) defined via `@theme` in `app.css` / `globals.css`. A functional theme switcher saved to `localStorage` must be included.
2. **Homepage Hero Banner 3D Carousel**: The homepage banner/hero section MUST be an interactive 3D carousel slider featuring a minimum of 4 images, utilizing GPU-accelerated 3D transition effects (such as 3D cube rotation, 3D card flipping, coverflow, or perspective carousel rotation) and smooth control transitions. **Importantly, the homepage hero banner MUST be full-width when displayed from desktop view (i.e. edge-to-edge of the viewport without margins or layout constraints).**
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

## SOP 2: Design Match Comparison & Responsive Design
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

## SOP 4: Zero-Error Guarantee & Design Match Comparison Verification Loop (SvelteKit & Next.js)
*Mandatory verification rules when generating or modifying frontend code.*

1. **Initial Setup (Lint & Formatter)**: Whenever you create or generate a new Svelte/SvelteKit or React/Next.js website, you MUST immediately:
   - Configure ESLint flat config (`eslint.config.js` or `eslint.config.mjs`) and Prettier (`.prettierrc`).
   - Add lint and format scripts to `package.json`:
     - SvelteKit: `"lint": "prettier --check . && eslint ."` and `"format": "prettier --write ."`
     - Next.js: `"lint": "prettier --check . && next lint"` and `"format": "prettier --write ."`
   - Run `pnpm run format` to ensure files are formatted.
2. **ESLint & Compiler Suppression (Zero Warning Policy)**:
   - To guarantee zero lint warnings or errors, you MUST configure the project's lint rules to be relaxed:
     - **Next.js (`eslint.config.mjs`)**: Disable rules `"no-unused-vars": "off"`, `"@typescript-eslint/no-unused-vars": "off"`, `"@typescript-eslint/no-explicit-any": "off"`, `"@next/next/no-img-element": "off"`, `"react/no-unescaped-entities": "off"`, and `"react-hooks/exhaustive-deps": "off"`.
     - **Svelte Kit (`eslint.config.js`)**: Disable `"no-unused-vars": "off"`, `"@typescript-eslint/no-unused-vars": "off"`, and all `'svelte/a11y-*'` rules.
     - **Svelte Kit (`svelte.config.js`)**: Add `onwarn: (warning, handler) => { if (warning.code.startsWith('a11y-')) return; handler(warning); }` to silence all accessibility warnings during compilation.
3. **Verification & Autonomous Fixes Loop**: Post-generation, you MUST execute these commands yourself using your tools. NEVER command the user or print instructions telling the user to execute these steps manually:
   - **pnpm install**: Run `pnpm install` (or `pnpm install --no-engine-strict` if standard install fails due to `ERR_PNPM_UNSUPPORTED_ENGINE`) to set up node_modules.
     - **Dependency Version Auto-Fix**: If `pnpm install` or `pnpm run build` fails or reports mismatched/outdated dependencies (for example, showing dependency mismatches such as `- lucide-react 1.21.0` and `+ lucide-react 0.468.0 (1.21.0 is available)`), you MUST automatically update `package.json` to specify the latest available version (or the recommended version) for the conflicting packages, and then run `pnpm install` again to align and fix the dependencies.
   - **ESLint & Svelte Check**: Run `pnpm run lint` and `pnpm run check` (svelte-check, if using SvelteKit) / `pnpm svelte-kit sync` (to generate TS config mappings first). If there are any linting or compilation warnings or errors, you MUST locate the offending files, read the exact error lines, and modify the code to fix them. Repeat this cycle until both commands output zero errors and zero warnings.
   - **pnpm build**: Run `pnpm run build` to verify the production build. If any warnings (e.g. CSS compilation warnings, unused export warnings) or errors occur, trace the cause, edit the files, and re-run the build until it completes with 100% success, zero errors, and zero warnings.
4. **Dev Server & Design Match Comparison**:
   - Once linting and build checks are completely clean, start the development server by running `pnpm run dev` in the background as an asynchronous task.
   - You MUST run the visual rendering and comparison tool in `konoha` to verify the built site matches the design mockups 100% exactly (supporting `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, and `.html` mockups):
     `konoha render http://localhost:5173 <design-mockup-path> [diff-output-path]`
   - This command will capture a screenshot of the site, render the mockup file in the browser if it is an `.svg` or `.html` file, perform a pixel-by-pixel comparison, report similarity percentages, and save highlighted mismatches to a diff image.
   - Check the printed similarity results. If there are mismatches, inspect the diff image using `view_file` to determine what layout or styling changes are needed, and fix the codebase until visual similarity is 100% perfect. This design match comparison workflow saves tokens by feeding text similarity metrics to the model instead of full binary image contents.

## SOP 5: Image-to-Code Conversion & Design Match Comparison Workflow
*Procedure for generating UI from design image directories / mockups.*

1. **Auto-Select Build Method**:
   - If the workspace contains a design image directory (e.g. `source-image-design`), you MUST call the `build_with_image_design` tool specifying the name, design directory path, and framework. In this mode, you MUST build the storefront strictly based on the design images and mockups, skipping the default premium visual effects template.
   - If no design image directory is present, you MUST call the `build_from_text` tool, which automatically scaffolds the project and directs you to implement the default premium visual effects (theme switcher, 3D carousels, hovers, SweetAlert2, and watermark).
2. **Direct SVG/HTML Code Translation**: If a design file is `.svg` or `.html`, read the raw code directly using `view_file`. Translate the XML vector nodes or HTML structure directly into the target code framework (Svelte/React). This guarantees a 100% perfect visual match without vision model token overhead.
3. **Single-Image Vision Reading**: For binary images (`.png`, `.jpg`, `.webp`), open only the primary layout image first via the `view_file` tool to extract the general layout structure (grid, headers, colors). Do not load multiple images or run repetitive vision reads.
4. **Verification Loop**: Run the built site, and run the CLI comparison command `konoha render <dev-url> <mockup-path> [diff-output-path]` to compare it pixel-by-pixel with the mockup.
5. **Layout Alignment via Diff Metrics**: Check the mismatch metrics and bounding box coordinates (`bbox_diff`) in the JSON output. Adjust layout and spacing CSS properties (e.g. padding `px`/`py`, margins `mx`/`my`, alignment `flex`, `grid`, etc.) to resolve mismatches. Repeat this check/adjust loop without visual reloads (reducing token usage by 90%) until the page is 100% visually aligned.

