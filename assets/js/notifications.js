/* ROSCA Thrift notification centre — shared by saver and branch dashboards. */
(function () {
  'use strict';
  if (window.__ROSCA_NOTIFICATIONS_INITIALISED) return;
  window.__ROSCA_NOTIFICATIONS_INITIALISED = true;

  const api = window.ROSCA_API && window.ROSCA_API.api;
  const auth = window.ROSCA_API;
  if (!api || !auth) return;

  let unread = 0;
  let audioReady = false;
  let audioContext = null;
  let socket = null;
  let panelOpen = false;

  const style = document.createElement('style');
  style.textContent = `
    .rosca-notify-wrap{position:relative;display:flex;align-items:center}
    .rosca-notify-bell{width:40px;height:40px;border:1px solid var(--line,#e5e7eb);border-radius:12px;background:#fff;color:var(--ink,#17212b);display:grid;place-items:center;position:relative;cursor:pointer}
    .rosca-notify-bell svg{width:19px;height:19px}
    .rosca-notify-count{position:absolute;right:-5px;top:-5px;min-width:18px;height:18px;padding:0 4px;border-radius:10px;background:#dc2626;color:#fff;font:700 10px/18px system-ui;text-align:center;border:2px solid #fff}
    .rosca-notify-panel{position:absolute;right:0;top:48px;width:min(360px,calc(100vw - 28px));max-height: min(480px,70vh);overflow:auto;background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 18px 48px rgba(15,23,42,.18);z-index:1001;display:none;color:#17212b}
    .rosca-notify-panel.is-open{display:block}
    .rosca-notify-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eef0f2;font-weight:700}
    .rosca-notify-head button,.rosca-notify-enable{border:0;background:none;color:#087f5b;font:600 12px system-ui;cursor:pointer}
    .rosca-notify-enable{display:block;margin:10px 14px;padding:9px 12px;border:1px solid #cce8dc;border-radius:9px;background:#f1faf6}
    .rosca-notify-item{padding:13px 16px;border-bottom:1px solid #f0f2f4;cursor:pointer}
    .rosca-notify-item.unread{background:#f2faf6}
    .rosca-notify-item strong{display:block;font-size:13px;margin-bottom:4px}
    .rosca-notify-item p{font-size:12px;line-height:1.45;color:#586574;margin:0}
    .rosca-notify-item small,.rosca-notify-empty{display:block;color:#89939e;font-size:11px;margin-top:6px}
    .rosca-notify-empty{padding:24px;text-align:center}
    @media(max-width:600px){.rosca-notify-bell{width:36px;height:36px}}
  `;
  document.head.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'rosca-notify-wrap';
  wrap.innerHTML = `
    <button class="rosca-notify-bell" type="button" aria-label="Notifications" aria-expanded="false" title="Notifications">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
      <span class="rosca-notify-count" hidden>0</span>
    </button>
    <section class="rosca-notify-panel" aria-label="Notification centre">
      <div class="rosca-notify-head"><span>Notifications</span><button type="button" class="rosca-notify-readall">Mark all read</button></div>
      <button type="button" class="rosca-notify-enable">Enable device notifications</button>
      <div class="rosca-notify-list"><div class="rosca-notify-empty">Loading notifications…</div></div>
    </section>`;
  const topbar = document.querySelector('.topbar');
  const refresh = document.getElementById('manual-refresh-btn');
  if (topbar && refresh) topbar.insertBefore(wrap, refresh);
  else if (topbar) topbar.appendChild(wrap);

  const bell = wrap.querySelector('.rosca-notify-bell');
  const badge = wrap.querySelector('.rosca-notify-count');
  const panel = wrap.querySelector('.rosca-notify-panel');
  const list = wrap.querySelector('.rosca-notify-list');
  const enable = wrap.querySelector('.rosca-notify-enable');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function setUnread(count) {
    unread = Math.max(0, Number(count) || 0);
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    if (unread > 0 && 'setAppBadge' in navigator) navigator.setAppBadge(unread).catch(() => {});
    if (unread === 0 && 'clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
  }
  async function unlockAudio() {
    audioReady = true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioContext = audioContext || new Ctx();
      if (audioContext.state === 'suspended') await audioContext.resume();
    } catch (_) {}
  }
  async function playAlert() {
    if (!audioReady) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioContext = audioContext || new Ctx();
      if (audioContext.state === 'suspended') await audioContext.resume();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.28);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime + 0.3);
    } catch (err) { console.warn('[notifications] audible alert unavailable', err); }
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  function render(items) {
    if (!items.length) {
      list.innerHTML = '<div class="rosca-notify-empty">You are all caught up.</div>';
      return;
    }
    list.innerHTML = items.map(n => `
      <article class="rosca-notify-item ${n.readAt ? '' : 'unread'}" data-id="${escapeHtml(n.id)}">
        <strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.body)}</p>
        <small>${escapeHtml(new Date(n.createdAt).toLocaleString())}</small>
      </article>`).join('');
  }
  async function loadFeed() {
    try {
      const data = await api('/api/notifications?limit=20&offset=0');
      render(data.notifications || []);
      setUnread(data.unread || 0);
    } catch (err) {
      list.innerHTML = '<div class="rosca-notify-empty">Notifications are temporarily unavailable.</div>';
      console.warn('[notifications] feed load failed', err);
    }
  }
  async function refreshCount() {
    try {
      const data = await api('/api/notifications/unread-count');
      setUnread(data.count || 0);
    } catch (_) {}
  }
  async function markRead(id) {
    try {
      await api('/api/notifications/' + encodeURIComponent(id) + '/read', {method:'POST'});
      await loadFeed();
    } catch (err) { console.warn('[notifications] mark read failed', err); }
  }
  function showLiveNotification(n) {
    setUnread(unread + 1);
    toastLive(n.title || 'New notification', n.body || '');
    playAlert();
    if (panelOpen) loadFeed();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(n.title || 'ROSCA Thrift', {body:n.body || '', icon:'/icons/icon-192.png', tag:n.id}); } catch (_) {}
    }
  }
  function toastLive(title, body) {
    const el = document.createElement('div');
    el.className = 'toast show';
    el.style.borderLeftColor = 'var(--g,#008b61)';
    el.innerHTML = '<strong>' + escapeHtml(title) + '</strong><div style="font-size:12px;margin-top:4px">' + escapeHtml(body) + '</div>';
    document.getElementById('toast-container')?.appendChild(el);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 5500);
  }

  bell.addEventListener('click', async () => {
    panelOpen = !panelOpen;
    panel.classList.toggle('is-open', panelOpen);
    bell.setAttribute('aria-expanded', String(panelOpen));
    if (panelOpen) await loadFeed();
  });
  wrap.querySelector('.rosca-notify-readall').addEventListener('click', async () => {
    try { await api('/api/notifications/read-all', {method:'POST'}); await loadFeed(); }
    catch (err) { console.warn('[notifications] mark all read failed', err); }
  });
  list.addEventListener('click', event => {
    const item = event.target.closest('.rosca-notify-item');
    if (item && item.dataset.id) markRead(item.dataset.id);
  });
  document.addEventListener('click', event => {
    if (!wrap.contains(event.target)) { panelOpen = false; panel.classList.remove('is-open'); bell.setAttribute('aria-expanded','false'); }
  });

  function base64UrlToUint8Array(base64Url) {
    const padding = '='.repeat((4 - base64Url.length % 4) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      toastLive('Device notifications unavailable', 'This browser does not support web push.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toastLive('Notifications not enabled', 'Allow notifications in your browser or device settings.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const keyData = await api('/api/notifications/vapid-public-key');
      if (!keyData.publicKey) throw new Error('Push is not configured on the server.');
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(keyData.publicKey)
      });
      await api('/api/notifications/push/subscribe', {method:'POST', body:subscription.toJSON()});
      enable.textContent = 'Device notifications enabled';
      enable.disabled = true;
      toastLive('Notifications enabled', 'This device is registered for push alerts.');
    } catch (err) {
      console.error('[notifications] push setup failed', err);
      toastLive('Could not enable notifications', err.message || 'Please try again.');
    }
  }
  enable.addEventListener('click', enablePush);

  async function connectSocket() {
    const token = auth.getAccessToken();
    if (!token || !window.io) return;
    if (socket) socket.disconnect();
    socket = window.io(window.ROSCA_CONFIG.API_BASE, {
      auth: {token}, transports:['websocket','polling'], reconnection:true
    });
    socket.on('notification:new', showLiveNotification);
    socket.on('connect_error', err => console.warn('[notifications] socket connection failed', err.message));
  }
  // Called only after dashboard auth has succeeded; refresh may rotate the token.
  window.ROSCANotifications = {
    start: async function () {
      await refreshCount();
      await loadFeed();
      await connectSocket();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js?v=7').catch(err => console.warn('[notifications] service worker registration failed', err));
      }
    },
    refresh: refreshCount
  };
})();