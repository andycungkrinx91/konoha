---
name: nuxt
description: Nuxt full-stack Vue framework with SSR, auto-imports, and file-based routing. Use when working with Nuxt apps, server routes, useFetch, middleware, or hybrid rendering.
metadata:
  author: Anthony Fu
  version: "2026.6.22"
  source: Generated from https://github.com/nuxt/nuxt, scripts located at https://github.com/antfu/skills
---

Nuxt is a full-stack Vue framework that provides server-side rendering, file-based routing, auto-imports, and a powerful module system. It uses Nitro as its server engine for universal deployment across Node.js, serverless, and edge platforms.

> The skill is based on Nuxt 4.x, generated at 2026-06-22.

> **Nuxt 4 note:** the default `srcDir` is `app/` — Vue app code (`app.vue`, `components/`, `composables/`, `pages/`, etc.) lives under `app/`, while `server/`, `shared/`, `public/`, `modules/`, `layers/` and `nuxt.config.ts` stay at the project root. The `~`/`@` aliases now point at `app/`; use `~~`/`@@` for the root.

## Core

| Topic | Description | Reference |
|-------|-------------|-----------|
| Directory Structure | Nuxt 4 `app/` srcDir, `shared/`, aliases, conventions | [core-directory-structure](references/nuxt-refs/core-directory-structure.md) |
| Configuration | nuxt.config.ts, app.config.ts, aliases, compatibilityVersion, experimental | [core-config](references/nuxt-refs/core-config.md) |
| CLI Commands | Dev server, build, generate, preview, and utility commands | [core-cli](references/nuxt-refs/core-cli.md) |
| Routing | File-based routing, dynamic routes, named views, layout props, middleware | [core-routing](references/nuxt-refs/core-routing.md) |
| Data Fetching | useFetch, useAsyncData, $fetch, createUseFetch factories, caching | [core-data-fetching](references/nuxt-refs/core-data-fetching.md) |
| Modules | Creating and using Nuxt modules, Nuxt Kit utilities | [core-modules](references/nuxt-refs/core-modules.md) |
| Deployment | Platform-agnostic deployment with Nitro, Vercel, Netlify, Cloudflare | [core-deployment](references/nuxt-refs/core-deployment.md) |

## Features

| Topic | Description | Reference |
|-------|-------------|-----------|
| Composables Auto-imports | Vue/Nuxt composables, custom composables, `shared/`, useAnnouncer | [features-composables](references/nuxt-refs/features-composables.md) |
| Components Auto-imports | Component naming, lazy loading, hydration strategies | [features-components-autoimport](references/nuxt-refs/features-components-autoimport.md) |
| Built-in Components | NuxtLink, NuxtPage, NuxtLayout, NuxtAnnouncer, ClientOnly, and more | [features-components](references/nuxt-refs/features-components.md) |
| State Management | useState composable, SSR-friendly state, Pinia integration | [features-state](references/nuxt-refs/features-state.md) |
| Server Routes | API routes, server middleware, Nitro server engine | [features-server](references/nuxt-refs/features-server.md) |

## Rendering

| Topic | Description | Reference |
|-------|-------------|-----------|
| Rendering Modes | Universal (SSR), client-side (SPA), hybrid rendering, route rules | [rendering-modes](references/nuxt-refs/rendering-modes.md) |

## Best Practices

| Topic | Description | Reference |
|-------|-------------|-----------|
| Data Fetching Patterns | Efficient fetching, caching, parallel requests, error handling | [best-practices-data-fetching](references/nuxt-refs/best-practices-data-fetching.md) |
| SSR & Hydration | Avoiding context leaks, hydration mismatches, composable patterns | [best-practices-ssr](references/nuxt-refs/best-practices-ssr.md) |

## Advanced

| Topic | Description | Reference |
|-------|-------------|-----------|
| Layers | Extending applications with reusable layers | [advanced-layers](references/nuxt-refs/advanced-layers.md) |
| Lifecycle Hooks | Build-time, runtime, and server hooks | [advanced-hooks](references/nuxt-refs/advanced-hooks.md) |
| Module Authoring | Publishable modules with Nuxt Kit, keyed composables, dependencies | [advanced-module-authoring](references/nuxt-refs/advanced-module-authoring.md) |
