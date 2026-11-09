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

  // Optional ?api=https://staging.example.com override — handy for testing
  // a staging backend from a local browser without editing this file.
  let apiOverride = null;
  try {
    const qs = new URLSearchParams(window.location.search);
    const fromQuery = qs.get('api');
    if (fromQuery && /^https?:\/\//i.test(fromQuery)) {
      apiOverride = fromQuery.replace(/\/+$/, '');
    }
  } catch (_) {
    // URLSearchParams unsupported or malformed URL — ignore.
  }

  const API_BASE = apiOverride
    ? apiOverride
    : (isLocal
        ? 'http://localhost:4001'
        : 'https://rosca-thrift.onrender.com');

  // ── localStorage keys ─────────────────────────────────────────
  // These MUST be stable across deploys so that users logged in on an
  // older build are still recognised after an upgrade. Renaming them
  // silently logs everyone out.
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
    // Environment
    API_BASE: API_BASE,
    IS_LOCAL: isLocal,
    IS_PROD: !isLocal && !apiOverride,
    DEBUG: isLocal, // verbose console logging in local only

    // Storage
    ACCESS_KEY: ACCESS_KEY,
    REFRESH_KEY: REFRESH_KEY,

    // Compliance
    CONSENT_VERSIONS: CONSENT_VERSIONS,

    // Versioning (used by "About" footers / diagnostics)
    VERSION: '1.0.0',
  });
})();