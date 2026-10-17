// SvelteKit server hook.
// The CSRF session token is delivered exclusively via the HttpOnly cookie set by
// the Node web server (src/web_server.js). It must NEVER be rendered into HTML
// (no meta tag injection) so it stays out of page source, caches, and DOM dumps.
// The SPA obtains it for mutating requests via GET /api/v1/csrf (same-origin).

export async function handle({ event, resolve }) {
  return resolve(event);
}

export function handleError({ error, event, status, message }) {
  const error_id = 'err_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  // Sanitized server error logging — never expose secrets or credentials
  const safeMsg = error?.message || message || 'Internal Server Error';
  const resolvedStatus = status || error?.status || (safeMsg.toLowerCase().includes('not found') ? 404 : 500);
  console.error(`[SvelteKit Server Error ${error_id}] status=${resolvedStatus} url=${event.url.pathname}: ${safeMsg}`);

  return {
    message: resolvedStatus === 404 ? 'The requested resource was not found.' : safeMsg,
    error_id,
    status: resolvedStatus
  };
}
