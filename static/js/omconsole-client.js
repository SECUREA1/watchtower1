/* global SharedWorker */
// OmConsole client library: connects to SharedWorker or iframe fallback,
// renders overlay cursor, and exposes pin/unpin helpers.

(function () {
  const SHARED_WORKER_URL = '/omconsole/shared-worker.js';
  const IFRAME_URL = '/omconsole/background.html';
  const CURSOR_HOST_URL = '/static/cursor-host.html';
  const PINNED_KEY = 'omconsole_pinned';
  const STORAGE_SETTINGS_KEY = 'omconsole.web.settings.v1';
  const DEFAULT_CURSOR_SIZE = 14;

  let workerPort = null;
  let iframeEl = null;
  let iframeReady = false;
  let backgroundType = null;
  let connectionPromise = null;
  let latestCursor = { x: 0, y: 0, visible: true };
  let overlayEl = null;
  let rafScheduled = false;

  function isPinned() {
    const value = localStorage.getItem(PINNED_KEY);
    return value === '1' || value === 'true';
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      return {};
    }
  }

  function supportsSharedWorker() {
    return typeof SharedWorker !== 'undefined';
  }

  function ensureOverlay() {
    if (overlayEl) {
      return overlayEl;
    }
    overlayEl = document.createElement('div');
    overlayEl.id = 'omconsole-cursor-overlay';
    overlayEl.style.position = 'fixed';
    overlayEl.style.top = '0';
    overlayEl.style.left = '0';
    overlayEl.style.width = `${DEFAULT_CURSOR_SIZE}px`;
    overlayEl.style.height = `${DEFAULT_CURSOR_SIZE}px`;
    overlayEl.style.borderRadius = '50%';
    overlayEl.style.background = 'rgba(0, 200, 255, 0.8)';
    overlayEl.style.boxShadow = '0 0 8px rgba(0, 200, 255, 0.6)';
    overlayEl.style.transform = 'translate(-9999px, -9999px)';
    overlayEl.style.pointerEvents = 'none';
    overlayEl.style.zIndex = '2147483647';
    overlayEl.style.transition = 'opacity 120ms ease';
    overlayEl.style.opacity = '0';

    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function drawCursor() {
    rafScheduled = false;
    const el = ensureOverlay();
    if (!latestCursor.visible) {
      el.style.opacity = '0';
      return;
    }
    el.style.opacity = '1';
    el.style.transform = `translate(${latestCursor.x - DEFAULT_CURSOR_SIZE / 2}px, ${latestCursor.y - DEFAULT_CURSOR_SIZE / 2}px)`;
  }

  function scheduleDraw() {
    if (rafScheduled) {
      return;
    }
    rafScheduled = true;
    requestAnimationFrame(drawCursor);
  }

  function updateOverlayCursor(cursor) {
    latestCursor = { ...latestCursor, ...cursor };
    scheduleDraw();
  }

  function handleBackgroundMessage(message) {
    if (!message || !message.type) {
      return;
    }
    if (message.type === 'cursor' || message.type === 'cursorTick') {
      updateOverlayCursor(message.payload || {});
    }
  }

  function handleIframeMessage(event) {
    if (event.origin !== window.location.origin) {
      return;
    }
    if (!iframeEl || event.source !== iframeEl.contentWindow) {
      return;
    }
    const message = event.data || {};
    if (message.type === 'bg_ready') {
      iframeReady = true;
      return;
    }
    handleBackgroundMessage(message);
  }

  function connectSharedWorker() {
    return new Promise((resolve, reject) => {
      try {
        const worker = new SharedWorker(SHARED_WORKER_URL);
        workerPort = worker.port;
        workerPort.start();
        workerPort.onmessage = (event) => handleBackgroundMessage(event.data || {});
        workerPort.onmessageerror = () => {
          workerPort = null;
          connectionPromise = null;
        };
        backgroundType = 'sharedworker';
        resolve('sharedworker');
      } catch (error) {
        reject(error);
      }
    });
  }

  function connectIframeFallback() {
    return new Promise((resolve) => {
      if (iframeEl && iframeReady) {
        backgroundType = 'iframe';
        resolve('iframe');
        return;
      }

      iframeEl = document.createElement('iframe');
      iframeEl.src = IFRAME_URL;
      iframeEl.setAttribute('aria-hidden', 'true');
      iframeEl.style.position = 'fixed';
      iframeEl.style.left = '-9999px';
      iframeEl.style.top = '0';
      iframeEl.style.width = '1px';
      iframeEl.style.height = '1px';
      iframeEl.style.border = '0';
      iframeEl.style.opacity = '0';
      iframeEl.style.pointerEvents = 'none';
      document.body.appendChild(iframeEl);

      iframeReady = false;
      window.addEventListener('message', handleIframeMessage);

      const readyCheck = setInterval(() => {
        if (iframeReady) {
          clearInterval(readyCheck);
          backgroundType = 'iframe';
          resolve('iframe');
        }
      }, 50);
    });
  }

  function ensureCursorHost() {
    if (document.getElementById('omconsole-cursor-host')) {
      return;
    }
    const host = document.createElement('iframe');
    host.id = 'omconsole-cursor-host';
    host.src = CURSOR_HOST_URL;
    host.setAttribute('aria-hidden', 'true');
    host.style.position = 'fixed';
    host.style.left = '-9999px';
    host.style.top = '0';
    host.style.width = '1px';
    host.style.height = '1px';
    host.style.border = '0';
    host.style.opacity = '0';
    host.style.pointerEvents = 'none';
    document.body.appendChild(host);

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const message = event.data || {};
      if (message.type === 'cursorTick' || message.type === 'cursor') {
        handleBackgroundMessage(message);
      }
    });
  }

  function connectBackground(options = {}) {
    if (connectionPromise) {
      return connectionPromise;
    }
    if (options.forceIframe) {
      connectionPromise = connectIframeFallback();
      return connectionPromise;
    }
    if (supportsSharedWorker()) {
      connectionPromise = connectSharedWorker().catch(() => connectIframeFallback());
      return connectionPromise;
    }
    connectionPromise = connectIframeFallback();
    return connectionPromise;
  }

  function postToBackground(message) {
    if (!message || typeof message !== 'object') {
      return;
    }
    if (backgroundType === 'sharedworker' && workerPort) {
      workerPort.postMessage(message);
      return;
    }
    if (backgroundType === 'iframe' && iframeEl && iframeEl.contentWindow) {
      iframeEl.contentWindow.postMessage(message, window.location.origin);
      return;
    }
    const host = document.getElementById('omconsole-cursor-host');
    if (host && host.contentWindow) {
      host.contentWindow.postMessage(message, window.location.origin);
    }
  }

  function pinOmConsole(wsUrl, options = {}) {
    localStorage.setItem(PINNED_KEY, '1');
    const connectOptions = { forceIframe: !!(options.forceIframe || options.keepCamera) };
    return connectBackground(connectOptions).then(() => {
      postToBackground({ type: 'pin', payload: { wsUrl } });
      if (options.keepCamera) {
        postToBackground({
          type: 'start_camera',
          payload: options.cameraConstraints || { video: true, audio: false },
        });
      }
    });
  }

  function unpinOmConsole() {
    localStorage.setItem(PINNED_KEY, '0');
    postToBackground({ type: 'unpin' });
    postToBackground({ type: 'stop_camera' });
  }

  function updateCursor(x, y, visible) {
    postToBackground({
      type: 'cursor_update',
      payload: { x, y, visible },
    });
    updateOverlayCursor({ x, y, visible });
  }

  function autoInit() {
    try {
      if (isPinned()) {
        ensureCursorHost();
        connectBackground().then(() => {
          postToBackground({ type: 'request_state' });
        });
        const settings = loadSettings();
        if (settings) {
          postToBackground({ type: 'updateSettings', payload: settings });
        }
      } else {
        ensureOverlay();
      }
    } catch (error) {
      console.warn('OmConsoleClient.autoInit error', error);
    }
  }

  window.OmConsoleClient = {
    pinOmConsole,
    unpinOmConsole,
    connectBackground,
    postToBackground,
    updateCursor,
    autoInit,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureOverlay);
  } else {
    ensureOverlay();
  }
})();
