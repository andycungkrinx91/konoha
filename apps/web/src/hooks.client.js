// SvelteKit client hook for handling unexpected client-side exceptions.

export function handleError({ error, status, message }) {
  const error_id = 'err_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const safeMsg = error?.message || message || 'An unexpected client error occurred.';
  const resolvedStatus = status || error?.status || (safeMsg.toLowerCase().includes('not found') ? 404 : 500);
  console.error(`[SvelteKit Client Error ${error_id}] status=${resolvedStatus}:`, safeMsg);

  return {
    message: safeMsg,
    error_id,
    status: resolvedStatus
  };
}
