---
name: jonin-skill
description: Standard Operating Procedures for premium UI development, visual QA, and frontend component architecture.
tags:
  - jonin
  - frontend
  - ui
  - tailwind
  - svelte
---

# Jonin: UI & Frontend Specialist (SOP)

This skill provides the **Standard Operating Procedures (SOP)** for the Jonin (Frontend Builder) when tasked with creating web interfaces, styling components, or implementing animations.

> [!CAUTION]  
> **Visual Excellence is Mandatory**: You must never deliver a "basic" or "minimal viable" design. Every component must feel premium, using modern typography, harmonious colors, smooth gradients, and interactive micro-animations.

## 🛠️ Technology Stack
- **Default Stack**: SvelteKit + Tailwind v4 + pnpm
- **Alternative Stack**: Next.js 16 (Only if React is explicitly requested by the user)

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
