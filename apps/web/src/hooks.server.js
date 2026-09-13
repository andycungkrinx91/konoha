// SvelteKit server hook — pass-through.
// The CSRF session token is delivered exclusively via the HttpOnly cookie set by
// the Node web server (src/web_server.js). It must NEVER be rendered into HTML
// (no meta tag injection) so it stays out of page source, caches, and DOM dumps.
// The SPA obtains it for mutating requests via GET /api/v1/csrf (same-origin).
export async function handle({ event, resolve }) {
  return resolve(event);
}
