(() => {
  if (window.__omconsoleLauncherLoaded) return;
  window.__omconsoleLauncherLoaded = true;

  const PIN_KEY = 'omconsole_pinned';
  const OVERLAY_ID = 'omconsole-overlay';
  const BTN_ID = 'omconsole-launch-btn';
  const WRAP_ID = 'omconsole-launch-wrap';
  const MARTINI_ID = 'omconsole-martini-link';
  // Use an absolute URL so the iframe loads correctly from nested routes
  // (e.g., /live/) instead of resolving relative to the current page.
  const FRAME_URL = '/omconsole_render_single_games_ROUTING.html';
  const isConsolePage = location.pathname.includes('omconsole_render_single_games_ROUTING.html');

  let pinned = false;
  let overlay = null;
  let button = null;
  let hostCursor = null;
  let toggleButton = null;

  const applyStyles = (el, styles) => Object.assign(el.style, styles);

  function updateButton() {
    if (!button) return;
    button.textContent = pinned ? 'OMConsole Active' : 'Open OMConsole';
    button.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    applyStyles(button, pinned
      ? { background: 'linear-gradient(135deg, #d4af37, #f2d57a)', color: '#061022', borderColor: 'rgba(255,255,255,0.35)' }
      : { background: 'linear-gradient(180deg, #0b2a66, #0a1e3a)', color: '#eaf2ff', borderColor: 'rgba(212,175,55,0.35)' }
    );
  }

  function removeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function ensureHostCursor() {
    if (hostCursor) return hostCursor;
    const cursor = document.createElement('div');
    applyStyles(cursor, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      border: '2px solid rgba(255,255,255,0.95)',
      boxShadow: '0 0 0 4px rgba(255,159,10,0.35), 0 10px 24px rgba(0,0,0,0.45)',
      transform: 'translate(-9999px, -9999px)',
      pointerEvents: 'none',
      zIndex: '99999',
      transition: 'transform 0.04s linear'
    });
    document.body.appendChild(cursor);
    hostCursor = cursor;
    return cursor;
  }

  function updateHostCursor(payload) {
    if (!pinned) return;
    if (!payload || typeof payload.x !== 'number' || typeof payload.y !== 'number') return;

    const srcW = payload.width || window.innerWidth;
    const srcH = payload.height || window.innerHeight;
    const scaleX = window.innerWidth / srcW;
    const scaleY = window.innerHeight / srcH;
    const x = payload.x * scaleX;
    const y = payload.y * scaleY;

    const cursor = ensureHostCursor();
    cursor.style.transform = `translate(${x - 12}px, ${y - 12}px)`;
    cursor.style.boxShadow = payload.click
      ? '0 0 0 6px rgba(255,255,255,0.35), 0 0 0 12px rgba(255,159,10,0.22)'
      : '0 0 0 4px rgba(255,159,10,0.35), 0 10px 24px rgba(0,0,0,0.45)';

    if (payload.clickEdge) {
      const target = document.elementFromPoint(x, y);
      if (!target) return;
      if (overlay && overlay.contains(target)) return;
      if (cursor.contains(target)) return;
      try {
        target.click();
      } catch (err) {
        // ignore click errors
      }
    }
  }

  function applyOverlayLayout() {
    if (!overlay) return;
    const compact = window.innerWidth < 980 || window.innerHeight < 720;
    if (compact) {
      applyStyles(overlay, {
        top: '0',
        left: '0',
        right: '0',
        bottom: '0',
        width: '100vw',
        height: '100vh',
        borderRadius: '0'
      });
      overlay.dataset.mode = 'full';
    } else {
      applyStyles(overlay, {
        top: 'auto',
        left: 'auto',
        right: '16px',
        bottom: '16px',
        width: '420px',
        height: '720px',
        borderRadius: '18px'
      });
      overlay.dataset.mode = 'dock';
    }
    if (toggleButton) {
      toggleButton.textContent = overlay.dataset.mode === 'dock' ? 'Full' : 'Dock';
    }
  }

  function buildOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    applyStyles(overlay, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      backdropFilter: 'blur(12px)',
      background: 'rgba(7,20,40,0.9)',
      borderRadius: '0',
      border: '1px solid rgba(212,175,55,0.35)',
      boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
      overflow: 'hidden',
      zIndex: '99998'
    });
    applyOverlayLayout();

    const bar = document.createElement('div');
    applyStyles(bar, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px 12px',
      background: 'linear-gradient(180deg, rgba(13,31,60,0.82), rgba(7,20,40,0.68))',
      color: '#eaf2ff',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      fontWeight: '700',
      letterSpacing: '.22px',
      borderBottom: '1px solid rgba(212,175,55,0.28)'
    });
    const title = document.createElement('div');
    title.textContent = 'OMConsole — Cursor + Control (active)';
    bar.appendChild(title);

    const actions = document.createElement('div');
    applyStyles(actions, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    });

    const toggleSize = document.createElement('button');
    toggleSize.type = 'button';
    toggleSize.textContent = overlay.dataset.mode === 'dock' ? 'Full' : 'Dock';
    applyStyles(toggleSize, {
      background: 'rgba(255,255,255,0.1)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.22)',
      borderRadius: '10px',
      padding: '8px 10px',
      fontSize: '12px',
      fontWeight: '600',
      letterSpacing: '.2px',
      cursor: 'pointer'
    });
    toggleSize.addEventListener('click', () => {
      if (!overlay) return;
      if (overlay.dataset.mode === 'dock') {
        applyStyles(overlay, {
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
          width: '100vw',
          height: '100vh',
          borderRadius: '0'
        });
        overlay.dataset.mode = 'full';
        toggleSize.textContent = 'Dock';
      } else {
        applyStyles(overlay, {
          top: 'auto',
          left: 'auto',
          right: '16px',
          bottom: '16px',
          width: '420px',
          height: '720px',
          borderRadius: '18px'
        });
        overlay.dataset.mode = 'dock';
        toggleSize.textContent = 'Full';
      }
    });
    actions.appendChild(toggleSize);
    toggleButton = toggleSize;

    const openFull = document.createElement('a');
    openFull.href = FRAME_URL;
    openFull.target = '_blank';
    openFull.rel = 'noopener noreferrer';
    openFull.textContent = 'Open full page';
    applyStyles(openFull, {
      textDecoration: 'none',
      background: 'rgba(255,255,255,0.1)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.22)',
      borderRadius: '10px',
      padding: '8px 10px',
      fontSize: '12px',
      fontWeight: '600',
      letterSpacing: '.2px'
    });
    actions.appendChild(openFull);

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    applyStyles(close, {
      marginLeft: '12px',
      background: 'rgba(255,255,255,0.08)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.18)',
      borderRadius: '10px',
      width: '32px',
      height: '32px',
      cursor: 'pointer',
      fontSize: '18px',
      lineHeight: '24px'
    });
    close.addEventListener('click', () => setPinned(false));
    actions.appendChild(close);

    bar.appendChild(actions);

    const iframe = document.createElement('iframe');
    iframe.src = FRAME_URL;
    iframe.title = 'OMConsole';
    iframe.allow = 'camera; microphone; fullscreen; clipboard-read; clipboard-write';
    iframe.loading = 'lazy';
    applyStyles(iframe, {
      flex: '1 1 auto',
      border: '0',
      width: '100%',
      height: '100%',
      background: '#050b16'
    });

    overlay.append(bar, iframe);
    document.body.appendChild(overlay);
    return overlay;
  }

  function setPinned(next, skipSave = false) {
    pinned = !!next;
    if (!skipSave) {
      localStorage.setItem(PIN_KEY, pinned ? '1' : '0');
    }
    if (pinned) {
      if (!isConsolePage) {
        buildOverlay();
      }
    } else {
      removeOverlay();
      if (hostCursor) {
        hostCursor.remove();
        hostCursor = null;
      }
    }
    updateButton();
  }

  function syncFromStorage() {
    const next = localStorage.getItem(PIN_KEY) === '1';
    setPinned(next, true);
  }

  function buildButton() {
    if (button) return button;
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    applyStyles(wrap, {
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      zIndex: '99997',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '10px',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    });

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Open OMConsole';
    btn.title = 'Launch the OMConsole cursor/control overlay';
    applyStyles(btn, {
      borderRadius: '14px',
      border: '1px solid rgba(212,175,55,0.35)',
      padding: '10px 14px',
      cursor: 'pointer',
      boxShadow: '0 18px 40px rgba(0,0,0,0.3)',
      fontWeight: '800',
      letterSpacing: '.2px',
      fontSize: '13px'
    });
    btn.addEventListener('click', () => setPinned(!pinned));

    const martini = document.createElement('a');
    martini.id = MARTINI_ID;
    martini.href = 'https://chaines.io';
    martini.target = '_blank';
    martini.rel = 'noopener noreferrer';
    martini.title = 'Open Martini Lounge on chaines.io';
    martini.setAttribute('aria-label', 'Open Martini Lounge on chaines.io');
    applyStyles(martini, {
      width: '46px',
      height: '46px',
      borderRadius: '16px',
      border: '1px solid rgba(111,123,247,0.45)',
      background: 'linear-gradient(145deg, #9bf8f4, #6f7bf7)',
      boxShadow: '0 12px 26px rgba(111,123,247,0.32), 0 0 18px rgba(155,248,244,0.28)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '6px',
      textDecoration: 'none'
    });

    martini.innerHTML = `
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="martini-stem-mini" x1="32" y1="28" x2="32" y2="56" gradientUnits="userSpaceOnUse">
            <stop stop-color="#9bf8f4" />
            <stop offset="1" stop-color="#5d6cf6" />
          </linearGradient>
          <linearGradient id="martini-bowl-mini" x1="12" y1="10" x2="52" y2="34" gradientUnits="userSpaceOnUse">
            <stop stop-color="#e6fff6" />
            <stop offset="1" stop-color="#8be1ff" />
          </linearGradient>
        </defs>
        <path d="M14 10h36L32 32Z" fill="url(#martini-bowl-mini)" stroke="#0f1b2b" stroke-width="2" stroke-linejoin="round" />
        <path d="M22 22c6 4 14 4 20 0" stroke="#0f1b2b" stroke-width="2" stroke-linecap="round" />
        <path d="m40 14 6 6" stroke="#ff6f61" stroke-width="2" stroke-linecap="round" />
        <circle cx="44" cy="18" r="3" fill="#ff6f61" stroke="#0f1b2b" stroke-width="1.5" />
        <path d="M32 32v16" stroke="url(#martini-stem-mini)" stroke-width="4" stroke-linecap="round" />
        <path d="M26 50h12" stroke="#0f1b2b" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    `;

    wrap.appendChild(btn);
    wrap.appendChild(martini);
    document.body.appendChild(wrap);

    button = btn;
    updateButton();
    return btn;
  }

  document.addEventListener('DOMContentLoaded', () => {
    buildButton();
    syncFromStorage();

    window.addEventListener('storage', (e) => {
      if (e.key === PIN_KEY) {
        syncFromStorage();
      }
    });

    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'omconsole:cursor') return;
      updateHostCursor(event.data);
    });

    window.addEventListener('resize', () => {
      applyOverlayLayout();
    });

    window.omconsoleLauncher = {
      open: () => setPinned(true),
      close: () => setPinned(false),
      isActive: () => pinned
    };
  });
})();
