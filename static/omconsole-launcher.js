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
  let clientReady = false;

  function loadClient() {
    if (clientReady || window.OmConsoleClient) {
      clientReady = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = '/static/js/omconsole-client.js';
      script.async = true;
      script.onload = () => {
        clientReady = true;
        resolve();
      };
      document.head.appendChild(script);
    });
  }

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
      loadClient().then(() => {
        if (window.OmConsoleClient) {
          window.OmConsoleClient.pinOmConsole();
        }
      });
    } else {
      removeOverlay();
      if (window.OmConsoleClient) {
        window.OmConsoleClient.unpinOmConsole();
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
    loadClient().then(() => {
      if (window.OmConsoleClient) {
        window.OmConsoleClient.autoInit();
      }
    });

    window.addEventListener('storage', (e) => {
      if (e.key === PIN_KEY) {
        syncFromStorage();
      }
    });

    window.omconsoleLauncher = {
      open: () => setPinned(true),
      close: () => setPinned(false),
      isActive: () => pinned
    };
  });
})();
