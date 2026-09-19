# Frontend Review

> Load when: reviewing frontend code — React, TypeScript, Tailwind CSS, state management, or React Query.

## Security (frontend)

| Check | What to verify | Severity |
|-------|---------------|----------|
| XSS via `dangerouslySetInnerHTML` | Must sanitize with DOMPurify or equivalent | Critical |
| Unsanitized URL params | Validate before use in `href`, `src`, or navigation | High |
| Sensitive data in localStorage | Tokens/secrets must use httpOnly cookies, not localStorage | High |

## React architecture

| Check | What to verify | Severity |
|-------|---------------|----------|
| God components (>300 lines) | Split into focused components with single responsibility | Medium |
| Array index as key | Use stable, unique IDs for keys in dynamic lists | Medium |
| Prop drilling (3+ levels) | Use context, composition, or state management | Low |
| Untyped prop spreading `{...props}` | Verify spread is intentional and typed | Medium |

## State management

| Check | What to verify | Severity |
|-------|---------------|----------|
| `let`/`var` instead of `useState` | Persistent values must use hooks | High |
| Direct state mutation (`.push`, `.splice`) | Create new references for state updates | High |
| Props copied to state | Use props directly unless intentional "initial value" pattern | Medium |
| Derived state stored | Use `useMemo` instead of storing computed values | Medium |
| `useEffect` missing deps | All referenced variables must be in dependency array | High |
| Data fetching in `useEffect` | Use React Query / TanStack Query instead | Medium |

## TypeScript quality

| Check | What to verify | Severity |
|-------|---------------|----------|
| `any` type | Must be justified with comment or removed | High |
| Unsafe type assertions `as Type` | Minimize; verify each is necessary and safe | Medium |
| Missing component prop types | All components need explicit prop interfaces | Medium |
| Untyped event handlers `(e: any)` | Use proper React event types | Low |
| Untyped API responses | Define types for all API response shapes | High |
| `@ts-ignore` / `@ts-nocheck` | Must have justifying comment or be removed | High |

## React Query

| Check | What to verify | Severity |
|-------|---------------|----------|
| Missing `QueryClientProvider` | Must exist at app root | Critical |
| Query keys missing dynamic params | All variables used in queryFn must be in queryKey | High |
| Query data synced to Redux/Context | Use query data directly, don't duplicate state | Medium |
| Missing `enabled` flag | Conditional queries must use `enabled` | Medium |
| Missing invalidation after mutation | `onSuccess`/`onSettled` must invalidate related queries | High |

## Tailwind CSS

| Check | What to verify | Severity |
|-------|---------------|----------|
| Arbitrary values (`w-[347px]`) | Use design tokens from config | Medium |
| Missing responsive variants | Key layouts need `sm:`, `md:`, `lg:` breakpoints | Medium |
| Missing focus states | Interactive elements need `focus:` indicators | High |
| `!important` overuse | Minimize or eliminate | Low |
| Conflicting classes | No contradictory utilities in same className | Low |

## Performance

| Check | What to verify | Severity |
|-------|---------------|----------|
| Expensive computations in render | Use `useMemo` for `.filter()`, `.sort()`, `.reduce()` | Medium |
| Inline functions as props | Use `useCallback` when passed to memoized children | Low |
| Large lists without virtualization | Lists >100 items need virtual scrolling | Medium |
| Missing error boundaries | Critical sections need `ErrorBoundary` | Medium |
| Missing loading/error states | Async operations must handle loading, error, empty | Medium |
