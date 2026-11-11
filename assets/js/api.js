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
 *     Only redirect to login if the server explicitly declares the
 *     refresh token dead. Network errors and 5xx errors PRESERVE the
 *     session so a mobile app wake-up race doesn't log the user out.
 *   - Automatically attach branchSlug to login requests if present in URL
 *   - Expose helpers for token storage, logout, and role-based redirect.
 *
 * PERSISTENCE:
 *   Tokens live in localStorage (NOT sessionStorage) so that mobile app
 *   switches, screen swipes, and browser restarts keep the session alive
 *   until the user explicitly logs out.
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
    if (accessToken) localStorage.setItem(cfg.ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(cfg.REFRESH_KEY, refreshToken);
  }

  function setAccessToken(token) {
    if (token) localStorage.setItem(cfg.ACCESS_KEY, token);
    else localStorage.removeItem(cfg.ACCESS_KEY);
  }

  function clearTokens() {
    try { localStorage.removeItem(cfg.ACCESS_KEY); } catch (_) {}
    try { localStorage.removeItem(cfg.REFRESH_KEY); } catch (_) {}

    // Sweep any ROSCA-prefixed leftovers, without touching unrelated origins.
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (
          k === cfg.ACCESS_KEY ||
          k === cfg.REFRESH_KEY ||
          k.indexOf('rosca_') === 0 ||
          k.indexOf('ROSCA_') === 0
        ) {
          toRemove.push(k);
        }
      }
      toRemove.forEach(k => localStorage.removeItem(k));
    } catch (_) {}
  }

  // ── Auth redirect ─────────────────────────────────────────────
  function redirectToLogin(reason) {
    clearTokens();
    const here = window.location.pathname + window.location.search;
    const next = encodeURIComponent(here);
    if (cfg.DEBUG) console.warn('[api] redirect to login:', reason || 'session expired');

    const params = new URLSearchParams(window.location.search);
    const branch = params.get('branch');
    const path = window.location.pathname;
    const isCoSaverContext = !!branch &&
      (path.indexOf('/join/') === 0 || path.indexOf('/saver/') === 0);

    // Keep an expired co-saver session inside its own community instead of
    // sending the user to the platform/admin landing page.
    let dest = isCoSaverContext
      ? '/join/index.html?branch=' + encodeURIComponent(branch)
      : '/?login=1';
    if (!isCoSaverContext && branch) dest += '&branch=' + encodeURIComponent(branch);
    if (!isCoSaverContext) dest += '&next=' + next;

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

  // ── Refresh flow (network-resilient) ──────────────────────────
  //
  // Return values:
  //   true            → tokens refreshed successfully; retry the request
  //   'EXPIRED'       → server said the refresh token is dead; log the user out
  //   'NO_TOKEN'      → there's no refresh token in storage; log the user out
  //   'NETWORK_ERROR' → fetch threw (offline / wake-up race); PRESERVE session
  //   'SERVER_ERROR'  → 5xx or unexpected failure; PRESERVE session
  //
  let refreshInFlight = null;
  async function attemptRefresh() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return 'NO_TOKEN';

      try {
        const res = await fetch(cfg.API_BASE + '/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.ok) {
          // Definitive server-side rejection of the refresh token.
          if (
            res.status === 401 ||
            res.status === 403 ||
            (json.error && json.error.code === 'AUTH_REFRESH_INVALID')
          ) {
            return 'EXPIRED';
          }
          // Any other 4xx / 5xx is a transient server problem — do NOT
          // destroy the session over it.
          return 'SERVER_ERROR';
        }

        setTokens(json.data.tokens.accessToken, json.data.tokens.refreshToken);
        return true;
      } catch (err) {
        // Network throw = offline, or the app was just woken from a
        // swipe-close and the network stack isn't ready yet.
        if (cfg.DEBUG) console.warn('[api] refresh network error (preserving session):', err);
        return 'NETWORK_ERROR';
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

    const headers = Object.assign({}, options.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let body = options.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';

      if (path.includes('/api/auth/login') && typeof body === 'object' && !body.branchSlug) {
        const params = new URLSearchParams(window.location.search);
        const branchSlug = params.get('branch');
        if (branchSlug) body = Object.assign({}, body, { branchSlug });
      }

      body = JSON.stringify(body);
    }

    const url = path.startsWith('http') ? path : cfg.API_BASE + path;

    let res;
    try {
      res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body,
      });
    } catch (netErr) {
      // The initial request itself failed to reach the network.
      // Treat it as transient: never wipe tokens over this.
      if (cfg.DEBUG) console.warn('[api] request network error:', path, netErr);
      throw new ApiError(
        'Network connection issue. Please check your connection.',
        'NETWORK_ERROR',
        0,
        netErr
      );
    }

    // Refresh once on 401
    if (res.status === 401 && !options._retried) {
      const refreshResult = await attemptRefresh();

      if (refreshResult === true) {
        return request(path, Object.assign({}, options, { _retried: true }));
      }

      if (refreshResult === 'EXPIRED' || refreshResult === 'NO_TOKEN') {
        redirectToLogin('session expired');
        throw new ApiError('Session expired', 'AUTH_TOKEN_INVALID', 401);
      }

      // NETWORK_ERROR / SERVER_ERROR — preserve session, surface a
      // soft error the caller can decide to handle (retry, show toast).
      throw new ApiError(
        'Network connection issue. Please check your connection.',
        'NETWORK_ERROR',
        503
      );
    }

    let json = {};
    try { json = await res.json(); } catch (_) { json = {}; }

    if (res.ok && json.ok) {
      return json.data;
    }

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

  window.ROSCA_API = Object.freeze({
    api: request,
    request,
    getAccessToken,
    getRefreshToken,
    setTokens,
    setAccessToken,
    clearTokens,
    redirectToLogin,
    homeForRole,
    ApiError,
  });

  window.api = request;
})();