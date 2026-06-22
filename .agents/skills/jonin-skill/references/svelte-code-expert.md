# SvelteKit Code Writer

> Read when: building SvelteKit pages, routes, load functions, form actions, API routes, hooks, state management, app-level architecture, or SvelteKit security (auth, CSRF, XSS, CSP, cookies, uploads).

## Svelte 5 Runes Cheatsheet

| Rune | Purpose | Replaces |
|------|---------|---------| 
| `$state(value)` | Mutable reactive state | `writable()` |
| `$derived(expr)` | Computed from state | `$:` label |
| `$effect(() => {})` | Side effects only | `$:` with side effects |
| `$props()` | Component inputs | `export let` |
| `$bindable()` | Two-way bindable prop | `export let` + `bind:` |

```svelte
<script lang="ts">
  let { title, count = 0 }: { title: string; count?: number } = $props()
  let doubled = $derived(count * 2)
  let items = $state<string[]>([])
</script>
```

## Critical Anti-Patterns

```
✗  $: reactive labels          → use $derived / $effect
✗  export let for props        → use $props()
✗  $effect for derived state   → use $derived
✗  writable stores if $state suffices
✗  Importing $lib/server/ in client code
✗  Skipping server-side validation
✗  Forgetting use:enhance on forms
✗  Template-built Tailwind classes (text-${color}-500)
✗  Legacy @tailwind directives with v4   → use @import "tailwindcss"
✗  animation cleanup missing in onDestroy / use: destroy()
✗  Running GSAP/Canvas/PixiJS outside onMount (SSR will break)
✗  Blocking main thread with heavy 3D compute → use Web Workers
✗  Using npm or yarn             → always use pnpm
✗  Missing lint/format scripts   → set up ESLint + Prettier on every project
```

## CLI Tools

**Always use pnpm.** Never use npm or yarn.

*Tip: If installation fails with ERR_PNPM_UNSUPPORTED_ENGINE, run pnpm install --no-engine-strict to bypass version constraints.*

```bash
pnpm exec svelte-check             # Type-check Svelte + TS
pnpm exec svelte-check --watch     # Watch mode during larger edits
pnpm dlx sv create                 # Scaffold new SvelteKit project
pnpm lint                          # Run ESLint + Prettier check
pnpm format                        # Auto-fix formatting
```

> [!IMPORTANT]
> When running `sv create` non-interactively or in the background (e.g., via subagents), you must explicitly specify the template, types, add-ons (or lack thereof), and install preference to skip interactive prompts entirely.
> - **Without add-ons**:
>   `pnpm dlx sv create <path> --template minimal --types ts --no-add-ons --no-install`
> - **With add-ons (e.g., Tailwind CSS, Prettier, ESLint)**:
>   `pnpm dlx sv create <path> --template minimal --types ts --add prettier eslint tailwindcss="plugins:none" --no-install`
> 
> *Note: `--add` and `--no-add-ons` cannot be used together. To skip prompts when using `--add`, you must explicitly set options for all included multi-option add-ons (e.g., `tailwindcss="plugins:none"`).*

Run `pnpm lint` and `pnpm exec svelte-check` before finalizing.

### Node.js Requirement

Minimum **Node.js 22**. Set in `package.json`:

```json
{
  "engines": {
    "node": ">=22"
  }
}
```

Configure `.nvmrc` or `.node-version` with `22` for team consistency.

### Lint Setup (Required for Fresh Projects)

Fresh SvelteKit projects don't include ESLint. Always set up lint on new projects:

- **For standard JavaScript projects**:
  ```bash
  pnpm add -D eslint prettier eslint-plugin-svelte eslint-config-prettier prettier-plugin-svelte globals @eslint/js
  ```
- **For TypeScript projects (Standard)**:
  ```bash
  pnpm add -D eslint prettier eslint-plugin-svelte eslint-config-prettier prettier-plugin-svelte globals @eslint/js typescript-eslint
  ```

Create `eslint.config.js` (for TypeScript projects):

```js
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  prettier,
  ...svelte.configs['flat/prettier'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser
      }
    }
  },
  {
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'svelte/a11y-click-events-have-key-events': 'off',
      'svelte/a11y-no-noninteractive-element-interactions': 'off',
      'svelte/a11y-missing-attribute': 'off',
      'svelte/a11y-role-has-required-aria-props': 'off',
      'svelte/a11y-no-static-element-interactions': 'off',
      'svelte/a11y-interactive-supports-focus': 'off',
      'svelte/a11y-no-redundant-roles': 'off',
      'svelte/a11y-autofocus': 'off'
    }
  },
  {
    ignores: ['build/', '.svelte-kit/', 'dist/']
  }
);
```

Create `.prettierrc`:

```json
{
  "useTabs": true,
  "tabWidth": 2,
  "singleQuote": true,
  "trailingComma": "none",
  "printWidth": 100,
  "plugins": ["prettier-plugin-svelte"],
  "overrides": [
    { "files": "*.svelte", "options": { "parser": "svelte" } }
  ]
}
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "vite dev --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview --host 0.0.0.0",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
    "lint": "prettier --check . && eslint .",
    "format": "prettier --write ."
  }
}
```

Rules:
- Always bind dev and preview servers to `0.0.0.0` (`--host 0.0.0.0`) to support SaaS multi-domain routing.
- Every new SvelteKit project **must** have `lint` and `format` scripts configured and run before finalizing.
- Run `pnpm lint` before every commit or PR.
- CI must include `pnpm lint && pnpm check` as a gate.
- Fix all Svelte compiler accessibility (a11y) diagnostics (e.g. elements with interaction handlers like click/mousemove must have roles and tabindex, hidden submit buttons must have `aria-label`).

---

## Load Functions

### Server load (`+page.server.ts`)

Runs server-only. Use for DB queries, secret access, auth-gated data.

```ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const item = await db.getItem(params.id)
  if (!item) throw error(404, 'Not found')
  return { item }
}
```

### Universal load (`+page.ts`)

Runs server (SSR) and client (navigation). Use for public API calls.

```ts
export const load: PageLoad = async ({ fetch, params }) => {
  const res = await fetch(`/api/items/${params.id}`)
  return { item: await res.json() }
}
```

Rules:
- Prefer server load for secrets or DB access.
- Always type: `PageServerLoad`, `PageLoad`, `LayoutServerLoad`.
- Return plain objects — serialized automatically.

---

## Form Actions

```ts
// +page.server.ts
export const actions = {
  create: async ({ request, locals }) => {
    const data = await request.formData()
    const name = data.get('name') as string
    if (!name) return fail(400, { name, error: 'Name required' })
    await db.createItem({ name, userId: locals.user.id })
    throw redirect(303, '/items')
  },
} satisfies Actions
```

```svelte
<script lang="ts">
  import { enhance } from '$app/forms'
  let submitting = $state(false)
</script>

<form method="POST" action="?/create" use:enhance={() => {
  submitting = true
  return async ({ update }) => { await update(); submitting = false }
}}>
  <input name="name" value={form?.name ?? ''} />
  {#if form?.error}<p class="text-red-500">{form.error}</p>{/if}
  <button disabled={submitting}>{submitting ? 'Saving...' : 'Create'}</button>
</form>
```

Rules:
- `fail()` for validation errors with form data preserved.
- `redirect()` after successful mutations.
- `use:enhance` for progressive enhancement (works without JS).
- Always validate server-side before processing.

---

## Validation (Zod / Valibot)

```ts
// Zod
const ItemSchema = z.object({
  name: z.string().min(1).max(255),
  price: z.coerce.number().positive(),
})
const result = ItemSchema.safeParse(Object.fromEntries(data))
if (!result.success) return fail(400, { errors: result.error.flatten().fieldErrors })

// Valibot
import * as v from 'valibot'
const Schema = v.object({ email: v.pipe(v.string(), v.email()) })
const result = v.safeParse(Schema, Object.fromEntries(data))
if (!result.success) return fail(400, { errors: v.flatten(result.issues) })
```

---

## Hooks (`hooks.server.ts`)

```ts
export const handle: Handle = async ({ event, resolve }) => {
  const session = await getSession(event.cookies)
  event.locals.user = session?.user ?? null
  return resolve(event)
}
```

- Runs on every server request.
- Chain multiple handlers with `sequence()`.
- Set `event.locals` for data available in load functions and actions.

---

## API Routes (`+server.ts`)

```ts
export const GET: RequestHandler = async ({ locals }) => {
  const items = await db.getItems(locals.user.id)
  return json(items)
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json()
  // validate + process
  return json({ ok: true }, { status: 201 })
}
```

---

## SPA Category Routing (Zero-Reload Page Filters)

Instead of relying on server-side search params (e.g., `?category=outerwear`) which trigger unnecessary refetches/reload states, SvelteKit applications should use SPA routing parameters inside optional dynamic segments: `src/routes/shop/[[category]]/+page.svelte`.

1. **State Derivation**: Derive the active filter directly from SvelteKit's page params. This keeps selection states in sync with URLs automatically:
```typescript
import { page } from '$app/state';
let selectedCategory = $derived(page.params.category || 'all');
```
2. **Anchor Navigation**: Use native `<a>` elements for category buttons to leverage SvelteKit's client-side prefetching and navigation:
```html
<a href={category === 'all' ? '/shop' : `/shop/${category}`} class={selectedCategory === category ? 'text-active font-bold' : ''}>
  {category}
</a>
```
3. **Reset Filters**: To clear navigation-based filters, use SvelteKit's `goto` router:
```typescript
import { goto } from '$app/navigation';
function resetFilters() {
  goto('/shop');
}
```

---

## State Management

- `$state` in components + context for tree-local state.
- `getContext` / `setContext` for DI within component trees.
- Stores only for app-wide state across truly unrelated components.
- Avoid writable stores when `$state` suffices.

```ts
// Context pattern
import { setContext, getContext } from 'svelte'
const KEY = Symbol('auth')

// Parent
setContext(KEY, { user: $state(null) })

// Child
const { user } = getContext<{ user: ReturnType<typeof $state> }>(KEY)
```

---

## Server-Only Code

- Place in `$lib/server/` — SvelteKit prevents client import.
- Use for: DB clients, auth utilities, secret access, server services.

---

## Progressive Enhancement

- Forms work without JS: `<form method="POST">` + form actions.
- Add `use:enhance` for JS-enhanced UX.
- Keep critical flows (auth, data creation) functional without JS.

---

## SSR / SSG / SPA Mode (per-route)

```ts
// +page.ts — SSG (prerender)
export const prerender = true

// +page.ts — SPA (no SSR)
export const ssr = false

// +page.server.ts — hybrid (default, SSR on first load)
// No export needed, it's the default
```

Choose per route based on data freshness needs.

---

## Testing

```bash
pnpm add -D vitest @testing-library/svelte @sveltejs/kit playwright
```

- Vitest for unit tests.
- `@testing-library/svelte` for component tests.
- Playwright for E2E.
- Test load functions and form actions by calling directly.
- Test error paths and validation failures.

## Security

### Auth Enforcement (`hooks.server.ts`)

Enforce auth at the hook level — never rely on UI-only guards:

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks'
import { redirect } from '@sveltejs/kit'

const authGuard: Handle = async ({ event, resolve }) => {
  const session = await getSession(event.cookies)
  event.locals.user = session?.user ?? null

  const protectedPaths = ['/dashboard', '/settings', '/api/']
  const isProtected = protectedPaths.some(p => event.url.pathname.startsWith(p))

  if (isProtected && !event.locals.user) {
    throw redirect(303, `/login?redirect=${encodeURIComponent(event.url.pathname)}`)
  }

  return resolve(event)
}

const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event)
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return response
}

export const handle = sequence(authGuard, securityHeaders)
```

Rules:
- Check auth in hooks, not in individual load functions.
- Use `sequence()` to compose auth + headers + logging hooks.
- Redirect to login with return URL for UX.
- Always set security headers on every response.

### CSRF Protection

SvelteKit provides built-in CSRF protection for form actions:

- `POST`/`PUT`/`PATCH`/`DELETE` requests check the `Origin` header automatically.
- Form actions (`use:enhance`) are protected by default.
- For custom API routes (`+server.ts`), validate the `Origin` header manually:

```ts
// +server.ts
export const POST: RequestHandler = async ({ request, url }) => {
  const origin = request.headers.get('origin')
  if (origin !== url.origin) {
    return new Response('Forbidden', { status: 403 })
  }
  // process request
}
```

- Configure allowed origins in `svelte.config.js`:

```js
export default {
  kit: {
    csrf: {
      checkOrigin: true, // default: true — never disable
    },
  },
}
```

### XSS Prevention

```
✗  {@html userInput}         — NEVER render untrusted HTML
✗  {@html modelOutput}       — AI/LLM output is untrusted
✗  innerHTML = userValue     — same as {@html}
✓  {userInput}               — auto-escaped by Svelte
✓  {@html sanitize(html)}    — sanitize first with DOMPurify
```

```ts
// Safe HTML rendering (when @html is required)
import DOMPurify from 'isomorphic-dompurify'

const clean = DOMPurify.sanitize(untrustedHTML, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
})
```

```svelte
<!-- Safe -->
<p>{userComment}</p>

<!-- Dangerous — only with sanitization -->
{@html sanitizedContent}
```

Rules:
- Svelte auto-escapes `{expressions}` — this is your primary defense.
- `{@html}` bypasses escaping — treat every usage as a security boundary.
- AI/LLM output, user content, and API responses are **always untrusted**.
- Use `isomorphic-dompurify` for SSR-safe sanitization.

### Environment Variable Safety

```
$env/static/private    → server-only, inlined at build (secrets, DB URLs)
$env/dynamic/private   → server-only, read at runtime (rotating keys)
$env/static/public     → exposed to client bundle (safe public values only)
$env/dynamic/public    → exposed to client at runtime
```

```ts
// ✓ Server-only (safe)
import { DATABASE_URL, API_SECRET } from '$env/static/private'

// ✓ Public (intentionally exposed)
import { PUBLIC_APP_URL } from '$env/static/public'

// ✗ NEVER import private env in +page.ts or components
// SvelteKit will throw a build error if you try
```

Rules:
- Never put secrets in `PUBLIC_*` env vars.
- Use `$env/static/private` for secrets known at build.
- Use `$env/dynamic/private` for secrets that change at runtime.
- SvelteKit enforces server-only imports at build time — don't bypass.
- **Always generate a `.env.example`** file with placeholder values so team members know which variables are required.
- **Agent Guardrail**: ALWAYS ask the user for permission before reading or modifying any `.env` file.

### Content Security Policy (CSP)

```js
// svelte.config.js
export default {
  // Suppress all a11y compiler warnings to prevent build blocks
  onwarn: (warning, handler) => {
    if (warning.code.startsWith('a11y-')) return;
    handler(warning);
  },
  kit: {
    csp: {
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'], // required for Svelte scoped styles
        'img-src': ['self', 'data:', 'https:'],
        'connect-src': ['self'],
        'font-src': ['self'],
        'frame-ancestors': ['none'],
      },
    },
  },
}
```

- SvelteKit auto-generates nonces for inline scripts when CSP is configured.
- Use `'strict-dynamic'` for trusted script chains.
- Test CSP with browser DevTools console for violations.

### Cookie Security

```ts
// Setting secure cookies
event.cookies.set('session', token, {
  path: '/',
  httpOnly: true,       // no JS access
  secure: true,         // mandatory with sameSite: 'none'
  sameSite: 'none',     // allows cross-site requests (requires secure: true)
  maxAge: 60 * 60 * 24, // 24 hours
})

// Reading cookies
const session = event.cookies.get('session')

// Deleting cookies
event.cookies.delete('session', { path: '/' })
```

Rules:
- Always set `httpOnly: true` for session cookies.
- Always set `secure: true` in production.
- Use `sameSite: 'none'` — required for cross-site/embedded contexts. Always pair with `secure: true`.
- Set `path: '/'` explicitly to avoid scope issues.

### Rate Limiting

```ts
// src/lib/server/rate-limit.ts
const requests = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(ip: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now()
  const entry = requests.get(ip)

  if (!entry || now > entry.resetAt) {
    requests.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= limit) return false
  entry.count++
  return true
}

// Clean expired entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of requests) {
    if (now > entry.resetAt) requests.delete(ip)
  }
}, 60_000)
```

```ts
// hooks.server.ts — apply to sensitive routes
import { rateLimit } from '$lib/server/rate-limit'

const rateLimitHook: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith('/api/')) {
    const ip = event.getClientAddress()
    if (!rateLimit(ip)) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      })
    }
  }
  return resolve(event)
}
```

For production, use Redis-backed rate limiting or Cloudflare/Vercel edge rate limits.

### File Upload Safety

```ts
// +page.server.ts
export const actions = {
  upload: async ({ request, locals }) => {
    if (!locals.user) throw error(401)

    const data = await request.formData()
    const file = data.get('file') as File

    // Validate type (allowlist, not blocklist)
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(file.type)) return fail(400, { error: 'Invalid file type' })

    // Validate size (5MB max)
    if (file.size > 5 * 1024 * 1024) return fail(400, { error: 'File too large' })

    // Generate safe filename (never use user-provided name directly)
    const ext = file.name.split('.').pop()?.toLowerCase()
    const safeName = `${crypto.randomUUID()}.${ext}`

    // Store to safe location (outside web root)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(`/storage/uploads/${safeName}`, buffer)

    return { success: true, filename: safeName }
  },
} satisfies Actions
```

Rules:
- Allowlist MIME types — never blocklist.
- Limit file size server-side.
- Generate random filenames — never trust user-provided names.
- Store uploads outside the web root.
- Scan for malware in production (ClamAV or cloud service).

### Authorization in Load/Actions

```ts
// Always check ownership, not just authentication
export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(303, '/login')

  const item = await db.getItem(params.id)
  if (!item) throw error(404)

  // Authorization: check ownership
  if (item.userId !== locals.user.id) throw error(403, 'Forbidden')

  return { item }
}
```

- Authenticate in hooks, authorize in load/actions.
- Always check resource ownership, not just logged-in status.
- Return 403 for authorization failures, 401 for authentication failures.

### Security Checklist

- [ ] Auth enforced in `hooks.server.ts` (not UI-only)
- [ ] Security headers set on every response
- [ ] CSRF `checkOrigin: true` (default, never disabled)
- [ ] No `{@html}` with unsanitized user/AI content
- [ ] Secrets in `$env/static/private` or `$env/dynamic/private` only
- [ ] No secrets in `PUBLIC_*` env vars
- [ ] CSP configured in `svelte.config.js`
- [ ] Cookies: `httpOnly`, `secure`, `sameSite: 'none'`
- [ ] Rate limiting on API routes and auth endpoints
- [ ] File uploads: allowlisted types, size limit, random filenames
- [ ] Authorization checks on every load/action (ownership, not just auth)
- [ ] Input validated with Zod/Valibot in every form action
- [ ] Server-only code in `$lib/server/` (never imported client-side)
- [ ] `Origin` header validated in custom `+server.ts` endpoints
- [ ] No sensitive data in universal load functions (`+page.ts`)

---

For Tailwind v4 conventions, see `tailwind-design-system.md`.
For UI components, see `svelte-ui-expert.md`.

## Premium Visual Standards & 3D Interactivity Guidelines

All generated Svelte code must conform to the following baseline visual standards:
1. **10 Gradient Themes**: Nebula, Aurora, Sunset, Ocean, Matrix, Crimson, Cyber, Gold, Nordic, Amethyst defined via Tailwind CSS `@theme` variables.
2. **Theme Switcher**: Floating interactive chat-like bubble in bottom-right corner utilizing a 3D entrance transition (perspective transform) with 10 options, saving to `localStorage`.
3. **3D Hero Banner Carousel**: Autoplaying 3D interactive layout containing at least 4 images, perspective rotation, 3D card layout, and touch/mouse interaction.
4. **5 Interactive 3D Carousels**: Minimum of 5 interactive 3D carousels per website (hero banner, category showcases, reviews, featured items, customer lookbooks) using GPU-accelerated CSS transforms.
5. **3D GPU Card Hover & Glows**: Radial mouse-tracking glows and 3D tilts applied to all cards with `will-change: transform`.
6. **3D SweetAlert2 Dialogs**: Entrance animation using custom 3D CSS scale and tilt transforms, styled with the active theme gradient on buttons.
7. **Custom Styled SVG/CSS Logo**: Active inline SVG utilizing the active theme gradient (`stroke="url(#theme-gradient)"`) paired with gradient typography matching the actual project name.
8. **Footer Watermark**: Muted text: "Build with Antigravity and Konoha agentic AI" at the bottom of the page.

## Development Guidelines

- **Image-to-Code Generation**: Agents can and should generate user interfaces from design images/mockups (such as png, jpg, webp, svg) present in the workspace. The agent must search the directory for design assets, analyze them, and translate the visual mockups into Svelte components.

  ### Svelte-Specific Image-to-Code Design Match Comparison Workflow:
  1. **Select Build Method**: If a design mockup folder is present, call the `build_with_image_design` tool. Otherwise, call `build_from_text` to utilize the default premium visual effects template.
  2. **Direct SVG/HTML Translation**: If a design mockup file is `.svg` or `.html`, view the file's raw content. Translate XML vectors or HTML structures directly into Svelte markup. This yields a 100% accurate visual representation without vision model token overhead.
  3. **Single-Image Vision Reading**: For binary images (`.png`, `.jpg`, `.webp`), open only the primary layout image first using `view_file` to capture page structure.
  4. **Start Development Server**: Bind the SvelteKit development server using `pnpm run dev`.
  5. **Visual Verification Loop**: Run `konoha render http://localhost:5173 <design-mockup-path> [diff-output-path]` to compare the built page pixel-by-pixel with the design mockup.
  6. **Layout Refinement via Diff Metrics**: Inspect the JSON similarity metrics and bounding box coordinates (`bbox_diff`) in the render output. Adjust Svelte component styles (Tailwind padding `px`/`py`, margins `mx`/`my`, layout `flex`, `grid`, etc.) to resolve visual mismatches. Repeat the check without visual re-reads (saving 90% of visual token usage) until the visual similarity is clean and 100% matched.
- **Preserving Existing Codebase (Flow, Logic, and Style)**: When working inside an existing Svelte or Next.js project directory/workdir, the agent is strictly prohibited from altering the existing flow, core logic, or style guidelines of the project. It must respect and follow the current architecture, styling systems (like specific CSS setups or custom Tailwind configs), and logic flows without introducing breaking changes or refactoring existing styles.
