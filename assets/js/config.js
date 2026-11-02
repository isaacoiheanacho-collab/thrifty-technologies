/**
 * ROSCA frontend — shared configuration.
 *
 * Single source of truth for:
 *   - API base URL (per environment)
 *   - localStorage key names (so tokens are found consistently)
 *   - Platform document versions (must match backend consent.constants.ts)
 *
 * Loaded by every page via <script src="/assets/js/config.js"></script>
 * before any other script. Attaches to window.ROSCA_CONFIG.
 */

(function () {
  'use strict';

  // ── Environment detection ─────────────────────────────────────
  // If the page is served from localhost / 127.0.0.1, we assume the
  // developer is running the backend locally on port 4001.
  // Anything else (production domain, staging, preview) points at the
  // deployed backend.
  const host = window.location.hostname;
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local');

  const API_BASE = isLocal
    ? 'http://localhost:4001'
    : 'https://rosca-thrift.onrender.com';

  // ── localStorage keys ─────────────────────────────────────────
  const ACCESS_KEY = 'rosca_access_token';
  const REFRESH_KEY = 'rosca_refresh_token';

  // ── Document versions ─────────────────────────────────────────
  // Must match packages on the backend:
  //   src/modules/consent/consent.constants.ts → CONSENT_VERSIONS
  // If the backend bumps these, the frontend MUST match, or registration
  // and onboarding will be rejected with CONSENT_VERSION_MISMATCH.
  const CONSENT_VERSIONS = {
    TERMS: '1.0.0',
    PRIVACY: '1.0.0',
  };

  // ── Public API ────────────────────────────────────────────────
  window.ROSCA_CONFIG = Object.freeze({
    API_BASE: API_BASE,
    ACCESS_KEY: ACCESS_KEY,
    REFRESH_KEY: REFRESH_KEY,
    CONSENT_VERSIONS: CONSENT_VERSIONS,
    IS_LOCAL: isLocal,
    DEBUG: isLocal, // verbose console logging in local only
  });
})();