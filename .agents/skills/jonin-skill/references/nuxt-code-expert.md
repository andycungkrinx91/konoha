# Nuxt Code Expert & Architectural Guidelines

Comprehensive implementation standards for **Nuxt 3** projects using `pnpm` exclusively.

## 🏗️ Technical Directives
- **Package Manager**: `pnpm` exclusively (`pnpm create nuxt`, `pnpm install`, `pnpm dev --open`).
- **State Management**: Pinia stores with reactive filters and live search.
- **Routing**: File-based routing in `pages/` with layout inheritance in `layouts/`.
- **Theme Engine**: Reactive CSS gradient variables driven by `ThemeSwitcher.vue`.
- **Watermark**: `Build by Konoha` footer watermark required on all pages.
