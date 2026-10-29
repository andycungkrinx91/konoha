// Client API helper with CSRF token support and centralized error/notification mapping.
import { toast } from '#lib/state/toast.svelte.ts';

let memoryToken = '';
let isOnlineListenerAttached = false;

function attachOnlineRecoveryListener() {
  if (typeof window === 'undefined' || isOnlineListenerAttached) return;
  isOnlineListenerAttached = true;
  window.addEventListener('online', () => {
    toast.success('Network connection restored. Village gateway online.');
  });
}

function getToken() {
  return memoryToken;
}

export async function initToken() {
  if (typeof window === 'undefined') return '';
  try {
    const csrfRes = await fetch('/api/v1/csrf');
    if (!csrfRes.ok) return getToken();
    const csrfData = await csrfRes.json();
    if (csrfData?.token) {
      memoryToken = csrfData.token;
      return memoryToken;
    }
  } catch (_) {
    // CSRF fetch failed — leave token empty; request will fail with 403 and retry
  }
  return getToken();
}

export class ApiError extends Error {
  constructor(message, status, data, errorId) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.errorId = errorId || data?.error_id || 'err_' + Date.now().toString(36);
  }
}

async function retryWithFreshToken(endpoint, options) {
  memoryToken = '';
  const freshToken = await initToken();
  if (!freshToken) return null;
  const retryHeaders = {
    'Content-Type': 'application/json',
    'X-Konoha-Web-Token': freshToken,
    ...(options.headers)
  };
  try {
    return await fetch(endpoint, {
      ...options,
      _retried: true,
      headers: retryHeaders
    });
  } catch (retryErr) {
    const safeRetryMsg = retryErr?.message || 'Network connection failed during retry';
    toast.error('Network connection failed during retry.');
    throw new ApiError(safeRetryMsg, 0, null, 'err_offline');
  }
}

function handleApiError(res, data, endpoint) {
  const errorMsg = (data && (data.message || data.error))
    ? (data.message || data.error)
    : ('Request failed with status ' + res.status);
  const errorId = (data && data.error_id) ? data.error_id : ('err_' + Date.now().toString(36));

  if (res.status === 401 && !endpoint.includes('/api/v1/auth/status') && !endpoint.includes('/api/v1/auth/login')) {
    toast.warning('Session expired. Please log in again.');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('konoha:session-expired'));
    }
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || data?.retry_after || 'a few';
    toast.warning(`Rate limit exceeded. Gateway cooling down — retry in ${retryAfter}s.`);
  }
  if (res.status >= 500) {
    toast.error(`Gateway error (${res.status}): ${errorMsg} [${errorId}]`);
  }

  throw new ApiError(errorMsg, res.status, data, errorId);
}

async function parseResponseBody(res) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return await res.text();
  }
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

export async function apiRequest(endpoint, options = {}) {
  attachOnlineRecoveryListener();

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

  let res;
  try {
    res = await fetch(endpoint, {
      ...options,
      headers
    });
  } catch (networkErr) {
    const safeMsg = networkErr?.message || 'Network connection failed';
    toast.error('Network connection failed. Unable to reach gateway.');
    throw new ApiError(safeMsg, 0, null, 'err_offline');
  }

  // Automatic retry with fresh CSRF token if 403 Forbidden received
  if (res.status === 403 && isMutating && !options._retried) {
    const retriedRes = await retryWithFreshToken(endpoint, options);
    if (retriedRes) res = retriedRes;
  }

  const data = await parseResponseBody(res);
  if (!res.ok) {
    handleApiError(res, data, endpoint);
  }

  return data;
}

export const api = {
  get: (url) => apiRequest(url, { method: 'GET' }),
  post: (url, body) => apiRequest(url, { method: 'POST', body: JSON.stringify(body) }),
  put: (url, body) => apiRequest(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (url, body) => apiRequest(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (url, body) => apiRequest(url, { method: 'DELETE', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  del: (url, body) => apiRequest(url, { method: 'DELETE', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
};

async function readJson(res) {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
}

export async function login(password) {
  let res;
  try {
    res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
  } catch (_) {
    throw new ApiError('Gateway server is unreachable or offline', 0, null, 'err_offline');
  }

  const data = await readJson(res);
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || 'Invalid passphrase';
    throw new ApiError(msg, res.status, data, data?.error_id);
  }
  if (!data) {
    throw new ApiError('Unexpected response from the authentication gateway', res.status, null);
  }
  if (data.token) {
    memoryToken = data.token;
  }
  return data;
}

export async function getAuthStatus() {
  try {
    const res = await fetch('/api/v1/auth/status', { cache: 'no-store' });
    if (!res.ok) {
      return { authenticated: false, is_bootstrap: false, requires_password_change: false };
    }
    const data = await readJson(res);
    if (!data) {
      return { authenticated: false, is_bootstrap: false, requires_password_change: false };
    }
    return data;
  } catch (_) {
    return { authenticated: false, is_bootstrap: false, requires_password_change: false };
  }
}

async function csrfHeaders() {
  let token = getToken();
  if (!token) token = await initToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Konoha-Web-Token': token } : {})
  };
}

export async function changePassword(currentPassword, newPassword) {
  let res;
  try {
    res = await fetch('/api/v1/auth/change-password', {
      method: 'POST',
      headers: await csrfHeaders(),
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });
  } catch (_) {
    throw new ApiError('Gateway server is unreachable or offline', 0, null, 'err_offline');
  }

  const data = await readJson(res);
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || 'Password change failed';
    throw new ApiError(msg, res.status, data, data?.error_id);
  }
  return data;
}

export async function resetPassword(currentPassword) {
  let res;
  try {
    res = await fetch('/api/v1/auth/reset-password', {
      method: 'POST',
      headers: await csrfHeaders(),
      body: JSON.stringify({ current_password: currentPassword })
    });
  } catch (_) {
    throw new ApiError('Gateway server is unreachable or offline', 0, null, 'err_offline');
  }

  const data = await readJson(res);
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || 'Password reset failed';
    throw new ApiError(msg, res.status, data, data?.error_id);
  }
  return data;
}

export async function logout() {
  memoryToken = '';
  try {
    const headers = await csrfHeaders();
    await fetch('/api/v1/auth/logout', { method: 'POST', headers });
  } catch (_) {
    // Network or CSRF-bootstrap failure must still return the UI to the login surface.
  }
  memoryToken = '';
  return { ok: true };
}
