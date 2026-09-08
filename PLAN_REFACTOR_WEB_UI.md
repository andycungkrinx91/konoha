# PLAN_REFACTOR_WEB_UI.md — Migrate Generated Frontend: Svelte+Vite (SPA) → SvelteKit + Runes + Tailwind

## 0. Relationship to other plans

- **This is a migration plan, not a greenfield build plan.** `apps/web/` already exists — scaffolded and generated as a plain Svelte 5 + Vite SPA per the original `PLAN_WEB_UI.md` architecture (`index.html` entry point, hash/manual client routing, `lib/stores/`). This plan moves that existing code onto the architecture described in the revised `PLAN_WEB_UI.md` (SvelteKit, Runes, Tailwind CSS v4, `konoha ui start/build/preview`).
- **Depends on `PLAN_RUNTIME_MIGRATE.md`** being complete, same as `PLAN_WEB_UI.md` does — no change to that dependency.
- **Supersedes nothing in the backend.** `src/web_server.ts` (Fastify API layer) is untouched by this plan — this is a frontend-only migration. The API contract in `PLAN_WEB_UI.md` §5 does not change; every endpoint keeps its exact path, method, and response shape.
- **Out of scope:** any new screen, any new API endpoint, any visual redesign beyond what's structurally required by the routing change (e.g. a sidebar link still points to the same screen, it just now resolves via a route file instead of a hash). Same "1:1 port, don't improve while porting" discipline as the other two plans.

---

## 1. What's being migrated and why

| Area | Current (generated) | Target | Why it must change |
|---|---|---|---|
| Entry point | `index.html` mounts a single root `App.svelte`, which does manual/hash-based view switching (`#/bridges`, `#/agents`, etc.) | `src/routes/**/+page.svelte`, file-based routing, `src/app.html` as a non-routing shell | This is the actual defect being fixed — see prior conversation. Hash routing means the URL bar, back/forward buttons, and deep links don't reflect real navigable state the way SvelteKit's router gives for free. |
| Shared state | `lib/stores/*.js` using `writable`/`readable` from `svelte/store` | `lib/state/*.svelte.ts` using `$state`/`$derived` (Runes) | Runes are the Svelte 5 idiom already mandated for every other framework build in `PLAN_RUNTIME_MIGRATE.md`'s `jonin-skill/svelte-*-expert` skills. Keeping the generated UI on the old store API means Konoha's own tooling doesn't follow its own build directives. |
| Styling | However the generator currently handles CSS (component-scoped `<style>` blocks, or ad hoc classes — confirm exact current state in Phase 0 below) | Tailwind CSS v4, `app.css` with `@import "tailwindcss";` | Matches `tailwind-design-system` skill used by every other framework's generated output — one design-token system across the codebase, not a one-off. |
| Adapter / production output | Vite's default static build (`dist/`) — just files, no server | `@sveltejs/adapter-node` → `apps/web/build/` (runnable Node server) | Needed for `konoha ui preview` to mean "run the real production artifact," not "serve static files via some other ad hoc server." |
| CLI commands | `konoha web` (single command, no dev/build split) | `konoha ui start` / `konoha ui build` / `konoha ui preview` | Per `PLAN_WEB_UI.md` §3.1 — already agreed in that plan; this row is here only so the CLI wiring is tracked as part of this migration's checklist, not forgotten. |

---

## 2. Non-negotiable ground rule for this migration

**Every screen must be independently swappable and independently verifiable — never a single big-bang cutover.** Because real, working screens already exist and are presumably wired to the real Fastify API (not mocked), the risk profile here is different from the original greenfield plan: a mistake means breaking something that currently works, not failing to build something that doesn't exist yet.

Concretely: the old `App.svelte` + hash-router and the new SvelteKit `src/routes/` tree **coexist in the same `apps/web/` package for the duration of the migration**, behind a single env/CLI flag (`KONOHA_UI_ROUTER=legacy|sveltekit`, defaulting to `legacy` until Phase 6). This is what makes rollback trivial at every step, and lets Phase-by-phase done criteria be "this one screen, diffed against the old one" rather than "hope the whole rewrite works."

---

## 3. Phases

### Phase 0 — Inventory & freeze
Before touching anything:
- Enumerate every file currently under `apps/web/src/` and classify each as: (a) pure UI component (portable as-is), (b) store (needs Runes conversion), (c) routing/shell glue (needs full replacement), (d) API client (`lib/api.ts` — portable as-is, since the API contract isn't changing).
- Confirm current CSS approach (component `<style>` blocks vs. a utility framework vs. none) — this determines how mechanical the Tailwind conversion is per component.
- Snapshot the current generated app's behavior: for each of the 6 screens (Bridges, Agents, Skills, Savings, Doctor, Clients), record what it currently renders and what mutating actions it currently supports, as a checklist to verify against later.
- **Done criteria:** a committed `docs/WEB_UI_MIGRATION_INVENTORY.md` listing every file's classification and the per-screen behavior checklist. No code changes yet.

### Phase 1 — SvelteKit skeleton alongside the existing app
- Add SvelteKit, `adapter-node`, and Tailwind CSS v4 as dependencies of `apps/web/` (do not remove Vite's existing plain-Svelte config yet).
- Create `src/routes/+layout.svelte` (new shell) and one placeholder route, gated behind `KONOHA_UI_ROUTER=sveltekit`.
- Wire `konoha ui start` to read the flag and boot either the legacy Vite dev server or the SvelteKit dev server accordingly; `konoha ui build`/`konoha ui preview` only exist under the `sveltekit` path (the legacy app has no build/preview split — that's part of what's being fixed).
- **Done criteria:** with the flag set to `sveltekit`, `konoha ui start` boots the new shell with zero real screens yet; with the flag unset/`legacy`, behavior is byte-identical to before this phase started.

### Phase 2 — Migrate `lib/stores/` → `lib/state/*.svelte.ts` (Runes)
- Convert each store file one at a time. A `writable(initialValue)` becomes a `$state(initialValue)` exported from a `.svelte.ts` module function (per Svelte 5 conventions — module-level runes need to be wrapped in a function or class since raw `$state` at module scope isn't reactive across imports the same way).
- Keep the *old* store files in place and unchanged during this phase — new Runes-based state lives alongside, imported only by new-route components as they're built in Phase 4+.
- **Done criteria:** a unit test per converted state module confirming identical derived-value behavior (e.g. a `$derived` computed the same way the old store's derived subscription did) for the same input sequence.

### Phase 3 — Tailwind conversion pass
- Convert component styling to Tailwind utility classes, screen by screen (same order as Phase 4 below, so styling and routing migration for a given screen land together and are reviewed together).
- **Done criteria:** visual diff (screenshot comparison) between old-styled and Tailwind-converted version of each component shows no unintended layout/spacing change — this is a style-system swap, not a redesign.

### Phase 4 — Migrate screens one at a time, in priority order
Same order as the original plan's priority (Bridges first, then Savings, then the rest), because Bridges is the highest-risk screen (mutating actions against live bridge config) and validating the migration pattern there first de-risks the remaining five.

For each screen — Bridges → Savings → Agents → Skills → Doctor → Clients:
1. Create `src/routes/<screen>/+page.svelte` using the Phase 2 Runes state and Phase 3 Tailwind styling.
2. Wire it to the *same* `lib/api.ts` client and the *same* `/api/v1/*` endpoints the legacy screen already uses — no backend changes.
3. Add the sidebar link in the new `+layout.svelte`.
4. **Done criteria (per screen, required before moving to the next):** every mutating action listed in that screen's Phase 0 behavior checklist is performed once via the legacy UI and once via the new SvelteKit UI, and the resulting DB row is diffed and confirmed identical. Read-only views are compared for data parity (same fields, same values) though not pixel parity.

### Phase 5 — Dev/prod command finalization
- Once all 6 screens pass Phase 4, `konoha ui build` produces a full `apps/web/build/` adapter-node output covering every screen; `konoha ui preview` runs it.
- Run the complete per-screen mutating-action checklist from Phase 4 a second time, this time against `konoha ui preview` (the real production build) rather than the SvelteKit dev server, to catch any dev-only behavior that doesn't survive the production build (SSR/hydration mismatches are the most likely category here — anything touching `localStorage`/`window` needs a mount guard, same requirement `PLAN_RUNTIME_MIGRATE.md`'s frontend build directives already call out for other frameworks).
- **Done criteria:** full checklist passes against `konoha ui preview` with zero deltas from the Phase 4 dev-mode results.

### Phase 6 — Cutover & legacy removal
- Flip the default of `KONOHA_UI_ROUTER` to `sveltekit`.
- Run the full checklist one final time with no flag set (confirming the new default path is what actually ships).
- Delete the legacy `App.svelte`, hash-router glue, `index.html`, old `lib/stores/*.js`, and the `KONOHA_UI_ROUTER` flag itself (it was scaffolding for this migration, not a permanent feature).
- **Done criteria:** `git grep` for `KONOHA_UI_ROUTER`, `hashchange`, and the legacy store files returns zero results in `apps/web/`. `konoha ui start` with no flags opens the SvelteKit app.

### Phase 7 — Docs & sign-off
- Update `docs/SETUP-WEB-UI.md` and the `README.md` CLI command table if either still references `konoha web` or the old architecture.
- Produce `docs/WEB_UI_REFACTOR_PARITY_REPORT.md`: one row per screen, linking to the Phase 4 and Phase 5 diff evidence, confirming the migration changed *how* each screen is built, not *what* it does.

---

## 4. Explicit non-goals
- No new screens, no new API endpoints, no visual redesign beyond the mechanical Tailwind conversion.
- No change to `src/web_server.ts` or any `/api/v1/*` contract.
- No change to the Fastify-vs-SvelteKit-server-routes architecture decision already made in `PLAN_WEB_UI.md` §3 (API server stays separate).