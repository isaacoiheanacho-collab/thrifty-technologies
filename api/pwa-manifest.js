/**
 * Generate an install manifest scoped to one community's public join URL.
 * The branch slug is an identifier only; authentication and membership are
 * still enforced by the existing backend login/session checks.
 */
module.exports = function handler(req, res) {
  const branch = typeof req.query.branch === 'string' ? req.query.branch : '';

  // Slugs are URL identifiers, never HTML or executable content.
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(branch)) {
    return res.status(400).json({ error: 'A valid community branch is required.' });
  }

  const encodedBranch = encodeURIComponent(branch);
  const launchUrl = '/join/index.html?branch=' + encodedBranch;
  const readableBranch = branch
    .split('-')
    .filter(Boolean)
    .map(function (part) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ') || 'Community';
  const shortName = readableBranch.length > 16
    ? readableBranch.slice(0, 16)
    : readableBranch;

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  return res.status(200).json({
    id: launchUrl,
    name: 'ROSCA · ' + readableBranch,
    short_name: shortName,
    description: 'Your community savings circle on ROSCA Thrift.',
    start_url: launchUrl,
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#0b0e11',
    theme_color: '#073F32',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      {
        name: 'Open community',
        short_name: 'Community',
        url: launchUrl,
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
      }
    ]
  });
};
