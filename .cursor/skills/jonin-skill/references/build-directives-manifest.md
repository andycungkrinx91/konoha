# Jonin Build Directives Manifest

This manifest is required by `build_from_text` and `build_from_source` for Angular, Next.js, Nuxt, and SvelteKit.

## Shared requirements

- Use `pnpm` exclusively. Do not use `npm`, `yarn`, or standalone `npx`.
- Use framework-native routing; never use hash routing or a fake `activePage` router.
- Implement the official ten light-mode themes and semantic CSS variables from `design-token-manifest.md`.
- Add bounded 3D perspective interactions, entrance motion, glass surfaces, and responsive behavior without harming readability.
- Respect `prefers-reduced-motion`; disable tilt/parallax and use opacity-only transitions when requested.
- Clean up event listeners, timers, animation frames, and observers on component teardown.
- Add `pnpm run lint` and `pnpm run build`; SvelteKit also requires `pnpm run check`.
- Completion requires zero errors and zero warnings from all configured validation commands.

## Framework routing

| Framework | Required routing | Required validation |
|---|---|---|
| Angular | Standalone Angular Router with `app.routes.ts` | `pnpm run lint && pnpm run build` |
| Next.js | App Router under `app/` | `pnpm run lint && pnpm run build` |
| Nuxt | File-based `pages/` and `layouts/` | `pnpm run lint && pnpm run build` |
| SvelteKit | File-based `src/routes/` | `pnpm run lint && pnpm run check && pnpm run build` |

## Build-mode boundary

`build_from_text` applies the default premium theme and 3D system. `build_from_source` preserves source layout, content hierarchy, and visual language; it may add only non-structural, reduced-motion-safe enhancement. Do not inject generic themes, carousels, dialogs, or watermarks into source builds unless the source explicitly contains them.
