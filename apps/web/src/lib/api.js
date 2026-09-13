// Client API helper with CSRF token support.
// Token delivery: HttpOnly cookie (server-set) + GET /api/v1/csrf (same-origin).
// Never read from HTML meta tags or document.cookie — the token must not be
// present in page source, and the cookie is HttpOnly by design.
let memoryToken = '';

function getToken() {
  return memoryToken;
}

export async function initToken() {
  if (typeof window === 'undefined') return '';
  try {
    const csrfRes = await fetch('/api/v1/csrf');
    if (csrfRes.ok) {
      const csrfData = await csrfRes.json();
      if (csrfData && csrfData.token) {
        memoryToken = csrfData.token;
        return memoryToken;
      }
    }
  } catch (_) {
    // CSRF fetch failed — leave token empty; request will fail with 403 and retry
  }
  return getToken();
}

export async function apiRequest(endpoint, options = {}) {
  let token = getToken();
  const method = (options.method || 'GET').toUpperCase();
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (!token && isMutating) {
    token = await initToken();
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Konoha-Web-Token': token } : {}),
    ...(options.headers)
  };

  let res = await fetch(endpoint, {
    ...options,
    headers
  });

  // Automatic retry with fresh CSRF token if 403 Forbidden received
  if (res.status === 403 && isMutating && !options._retried) {
    memoryToken = '';
    const freshToken = await initToken();
    if (freshToken) {
      const retryHeaders = {
        'Content-Type': 'application/json',
        'X-Konoha-Web-Token': freshToken,
        ...(options.headers)
      };
      res = await fetch(endpoint, {
        ...options,
        _retried: true,
        headers: retryHeaders
      });
    }
  }

  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const errorMsg = (data && data.error) ? data.error : ('Request failed with status ' + res.status);
    throw new Error(errorMsg);
  }

  return data;
}

export const api = {
  get: (url) => apiRequest(url, { method: 'GET' }),
  post: (url, body) => apiRequest(url, { method: 'POST', body: JSON.stringify(body) }),
  patch: (url, body) => apiRequest(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (url) => apiRequest(url, { method: 'DELETE' }),
  del: (url) => apiRequest(url, { method: 'DELETE' })
};
