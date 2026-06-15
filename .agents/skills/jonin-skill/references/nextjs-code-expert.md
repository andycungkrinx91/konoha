# Next.js Code Writer

> Read when: building Next.js pages, routes, Server vs Client components, Server Actions, state management, ESLint/Prettier configs, or React app-level architecture and security.

## Next.js Component conventions

| Concept | Purpose | Details |
|---|---|---|
| **Server Components** | Default; fetch data, render static layout | No `"use client"`. Runs only on server. |
| **Client Components** | Interactive UI, state, hooks, browser APIs | Add `"use client"` at the top. |
| **Server Actions** | Handle form submissions/mutations | Add `"use server"` at the top of file or action. |
| **lucide-react** | SVG icon usage | Styled using theme variables and tailwind. |

```tsx
// app/shop/page.tsx (Server Component)
import { ThreeDCarousel } from '@/components/ThreeDCarousel'
import { getFeaturedProducts } from '@/lib/api'

export default async function ShopPage() {
  const products = await getFeaturedProducts();
  return (
    <main className="p-8">
      <h1 className="text-3xl font-bold tracking-tight mb-8">Premium Showroom</h1>
      <ThreeDCarousel items={products} autoplay={true} />
    </main>
  )
}
```

## Critical Anti-Patterns

```
✗  Making all components client components  → default to Server Components
✗  Running canvas/WebGL outside of useEffect → Server Side Rendering will crash (disable SSR or lazy load)
✗  Mutating state directly                   → use standard React useState/useReducer or Zustand
✗  Missing cleanup functions in useEffect     → revert GSAP timelines, clear setIntervals
✗  Template-built Tailwind classes (text-${color}-500)
✗  Using npm or yarn                         → always use pnpm
✗  Missing lint/format scripts               → set up ESLint + Prettier on every project
✗  Leaving unused imports / variables         → typescript-eslint rules will fail the build
```

## CLI Tools

**Always use pnpm.** Never use npm or yarn.

*Tip: If installation fails with ERR_PNPM_UNSUPPORTED_ENGINE, run pnpm install --no-engine-strict to bypass version constraints.*

```bash
pnpm run lint                      # Run ESLint + Prettier checks
pnpm run format                    # Auto-fix formatting
npx next lint                      # Run Next.js built-in lint checks
pnpm run build                     # Verify compilation and production build
```

> [!IMPORTANT]
> When creating a new React/Next.js app non-interactively or in the background, you must pass all command-line arguments to skip interactive prompts entirely:
> `pnpm dlx create-next-app@latest <path> --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm`

## Node.js Requirement

Minimum **Node.js 22**. Specify inside `package.json`:

```json
{
  "engines": {
    "node": ">=22"
  }
}
```

## Lint & Formatter Setup (Required for Fresh Projects)

Fresh Next.js projects need prettier and flat ESLint setups. Always set up lint and formatting on new projects:

```bash
pnpm add -D eslint prettier eslint-config-prettier eslint-plugin-prettier prettier-plugin-tailwindcss
```

Create `eslint.config.mjs` (for Next.js 15+ flat config style):

```javascript
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  prettier,
  {
    rules: {
      "no-unused-vars": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "react/react-in-jsx-scope": "off",
    }
  }
];

export default eslintConfig;
```

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "prettier --check . && next lint",
    "format": "prettier --write ."
  }
}
```

## JSX Accessibility (a11y) & Compiler Compliance

React builds will output warnings or fail if tags are semantically incorrect or accessibility tags are missing. Follow these rules for all client/interactive JSX components:

1. **Click/Interaction Handlers on Non-interactive Elements**:
   Any element like a `div` or `span` that handles clicks, keydowns, or mouse movements (e.g. for card perspective effect glows) must explicitly declare an ARIA role:
   - For visual effects only: `role="presentation"`
   - For actual custom controls: `role="button"` or `role="dialog"`
   ```tsx
   <div 
     onMouseMove={handleMouseMove}
     className="card-glow"
     role="presentation"
   >
     {children}
   </div>
   ```

2. **Keyboard Events and Tabindex**:
   When using roles like `role="dialog"` or `role="button"` on custom overlay structures (e.g. custom product zoom modals, filter drawers):
   - Add `tabIndex={-1}` (for dialogs/overlays) or `tabIndex={0}` (for focusable buttons).
   - Add an `onKeyDown` handler to handle accessibility clicks or closing with Escape.
   ```tsx
   <div
     className="modal-backdrop"
     onClick={closeModal}
     onKeyDown={(e) => e.key === 'Escape' && closeModal()}
     role="button"
     tabIndex={0}
     aria-label="Close modal background"
   >
     <div 
       className="modal-panel"
       role="dialog"
       aria-modal="true"
       aria-labelledby="modal-title"
       tabIndex={-1}
     >
       <h2 id="modal-title">Product Details</h2>
     </div>
   </div>
   ```

3. **Hidden Interactive Elements**:
   Form hidden controls (like `<button type="submit" className="hidden">` inside custom forms) must have an `aria-label="..."` or `title="..."` attribute to ensure accessibility sweeps pass.

4. **Unused Imports & Variables**:
   Clean up any unused imports and variables before running `next build` or `pnpm run lint`, as typescript-eslint configurations in Next.js will treat unused imports as fatal build errors.

## Verification Pipeline

Whenever generating or modifying Next.js frontend code, execute this pipeline to ensure zero errors and zero warnings:

1. **Format Check & Clean**: Run `pnpm run format` to auto-format files.
2. **Interactive A11y Verification**: Ensure all custom modal divs, slide decks, drawers, and cards have proper `role`, `tabIndex`, and keyboard handlers.
3. **Run Linting**: Execute `pnpm run lint` and verify there are no ESLint issues.
4. **Compile Production Build**: Run `pnpm run build` and ensure the next build completes successfully with no warnings or type errors.
