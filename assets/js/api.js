/**
 * ROSCA frontend — shared API client.
 *
 * Loaded after config.js. Attaches to window.ROSCA_API.
 *
 * Responsibilities:
 *   - Attach Authorization: Bearer <accessToken> on every request
 *   - Parse JSON and unwrap the { ok, data } envelope
 *   - On 401: attempt ONE refresh via /api/auth/refresh using the
 *     refreshToken from localStorage, retry the original request once.
 *     If refresh fails → clear tokens, redirect to /auth/login.html.
 *   - Automatically attach branchSlug to login requests if present in URL
 *   - Expose helpers for token storage, logout, and role-based redirect.
 */

(function () {
  'use strict';

  const cfg = window.ROSCA_CONFIG;
  if (!cfg) {
    throw new Error('config.js must be loaded before api.js');
  }

  // ── Token storage ─────────────────────────────────────────────
  function getAccessToken() {
    return localStorage.getItem(cfg.ACCESS_KEY);
  }

  function getRefreshToken() {
    return localStorage.getItem(cfg.REFRESH_KEY);
  }

  function setTokens(accessToken, refreshToken) {
    localStorage.setItem(cfg.ACCESS_KEY, accessToken);
    localStorage.setItem(cfg.REFRESH_KEY, refreshToken);
  }

  function clearTokens() {
    localStorage.removeItem(cfg.ACCESS_KEY);
    localStorage.removeItem(cfg.REFRESH_KEY);
  }

  // ── Auth redirect ─────────────────────────────────────────────
  function redirectToLogin(reason) {
    clearTokens();
    const here = window.location.pathname + window.location.search;
    const next = encodeURIComponent(here);
    if (cfg.DEBUG) console.warn('[api] redirect to login:', reason || 'session expired');
    
    // Instead of a hard redirect to /auth/login.html (which no longer exists),
    // we send them to the platform landing page with the login dropdown open.
    // If they were on a branch page, we pass the branch slug so they land correctly.
    const params = new URLSearchParams(window.location.search);
    const branch = params.get('branch');
    let dest = '/?login=1';
    if (branch) {
      dest += '&branch=' + encodeURIComponent(branch);
    }
    dest += '&next=' + next;
    
    window.location.href = dest;
  }

  // ── Role-based home ───────────────────────────────────────────
  function homeForRole(role) {
    if (role === 'SUPER_ADMIN') return '/super-admin/dashboard.html';
    if (role === 'BRANCH_ADMIN') return '/branch/dashboard.html';
    return '/saver/dashboard.html';
  }

  // ── Error class ───────────────────────────────────────────────
  class ApiError extends Error {
    constructor(message, code, status, details) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'UNKNOWN';
      this.status = status || 0;
      this.details = details || null;
    }
  }

  // ── Refresh flow ──────────────────────────────────────────────
  let refreshInFlight = null;
  async function attemptRefresh() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;

      try {
        const res = await fetch(cfg.API_BASE + '/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.ok) return false;
        setTokens(json.data.tokens.accessToken, json.data.tokens.refreshToken);
        return true;
      } catch (err) {
        if (cfg.DEBUG) console.error('[api] refresh threw', err);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  // ── Core request ──────────────────────────────────────────────
  async function request(path, options) {
    options = options || {};
    const token = getAccessToken();

    // Build headers
    const headers = Object.assign({}, options.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // Serialise body: JSON unless FormData
    let body = options.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      
      // NEW: If we're logging in from a branch page (URL has ?branch=...),
      // automatically attach it to the login payload so the backend can
      // enforce that the user belongs to that branch.
      if (path.includes('/api/auth/login') && typeof body === 'object' && !body.branchSlug) {
        const params = new URLSearchParams(window.location.search);
        const branchSlug = params.get('branch');
        if (branchSlug) {
          body = Object.assign({}, body, { branchSlug });
        }
      }
      
      body = JSON.stringify(body);
    }

    // Build full URL
    const url = path.startsWith('http') ? path : cfg.API_BASE + path;

    // First attempt
    let res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body,
    });

    // Refresh once on 401
    if (res.status === 401 && !options._retried) {
      const refreshed = await attemptRefresh();
      if (refreshed) {
        return request(path, Object.assign({}, options, { _retried: true }));
      }
      redirectToLogin('refresh failed');
      throw new ApiError('Session expired', 'AUTH_TOKEN_INVALID', 401);
    }

    // Parse response
    let json = {};
    try {
      json = await res.json();
    } catch (_) {
      json = {};
    }

    // Success
    if (res.ok && json.ok) {
      return json.data;
    }

    // Error
    const errCode = (json.error && json.error.code) || 'HTTP_' + res.status;
    const errMsg = (json.error && json.error.message) || 'Request failed';
    const errDetails = json.error && json.error.details;

    if (cfg.DEBUG) {
      console.error('[api] error', { path, status: res.status, code: errCode, message: errMsg });
    }

    throw new ApiError(errMsg, errCode, res.status, errDetails);
  }

  // ── Convenience wrappers ──────────────────────────────────────
  const api = {
    get: (path, opts) => request(path, Object.assign({}, opts, { method: 'GET' })),
    post: (path, body, opts) => request(path, Object.assign({}, opts, { method: 'POST', body })),
    patch: (path, body, opts) => request(path, Object.assign({}, opts, { method: 'PATCH', body })),
    put: (path, body, opts) => request(path, Object.assign({}, opts, { method: 'PUT', body })),
    del: (path, opts) => request(path, Object.assign({}, opts, { method: 'DELETE' })),
    request,
  };

  // ── Public API ────────────────────────────────────────────────
  window.ROSCA_API = Object.freeze({
    api: request, 
    getAccessToken,
    getRefreshToken,
    setTokens,
    clearTokens,
    redirectToLogin,
    homeForRole,
    ApiError,
  });

  window.api = request;
})();