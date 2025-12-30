(() => {
  if (window.__omconsoleLauncherLoaded) return;
  window.__omconsoleLauncherLoaded = true;

  const PIN_KEY = 'omconsole_pinned';
  const OVERLAY_ID = 'omconsole-overlay';
  const BTN_ID = 'omconsole-launch-btn';
  const WRAP_ID = 'omconsole-launch-wrap';
  const COFFEE_ID = 'omconsole-coffee-link';
  // Use an absolute URL so the iframe loads correctly from nested routes
  // (e.g., /live/) instead of resolving relative to the current page.
  const FRAME_URL = '/omconsole_render_single_games_ROUTING.html';
  const isConsolePage = location.pathname.includes('omconsole_render_single_games_ROUTING.html');

  let pinned = false;
  let overlay = null;
  let button = null;

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
    } else {
      removeOverlay();
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

    const coffee = document.createElement('a');
    coffee.id = COFFEE_ID;
    coffee.href = 'https://chaines.io';
    coffee.target = '_blank';
    coffee.rel = 'noopener noreferrer';
    coffee.title = 'Open chaines.io';
    coffee.setAttribute('aria-label', 'Open chaines.io');
    applyStyles(coffee, {
      width: '46px',
      height: '46px',
      borderRadius: '16px',
      border: '1px solid rgba(146,92,38,0.45)',
      background: 'linear-gradient(145deg, #f4d9b1, #c18c5b)',
      boxShadow: '0 12px 26px rgba(143,87,36,0.22), 0 0 18px rgba(244,217,177,0.4)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '6px',
      textDecoration: 'none'
    });

    coffee.innerHTML = `
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="coffee-cup" x1="16" y1="24" x2="44" y2="52" gradientUnits="userSpaceOnUse">
            <stop stop-color="#f7e3c6" />
            <stop offset="1" stop-color="#d19a63" />
          </linearGradient>
          <linearGradient id="coffee-liquid" x1="18" y1="30" x2="42" y2="40" gradientUnits="userSpaceOnUse">
            <stop stop-color="#6b3b16" />
            <stop offset="1" stop-color="#3c1f0b" />
          </linearGradient>
        </defs>
        <rect x="14" y="22" width="28" height="24" rx="6" fill="url(#coffee-cup)" stroke="#4b2a12" stroke-width="2" />
        <path d="M42 28h5c4 0 4 6 0 6h-3" stroke="#4b2a12" stroke-width="2.5" stroke-linecap="round" />
        <rect x="18" y="28" width="20" height="8" rx="3" fill="url(#coffee-liquid)" />
        <path d="M24 18c0 3-3 3-3 6 0 1 .5 1.5 1.5 2.5M32 16c0 3-3 3-3 6 0 1 .5 1.5 1.5 2.5M40 18c0 3-3 3-3 6 0 1 .5 1.5 1.5 2.5" stroke="#4b2a12" stroke-width="2" stroke-linecap="round" />
        <path d="M20 46h16" stroke="#4b2a12" stroke-width="2.5" stroke-linecap="round" />
      </svg>
    `;

    wrap.appendChild(btn);
    wrap.appendChild(coffee);
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

    window.omconsoleLauncher = {
      open: () => setPinned(true),
      close: () => setPinned(false),
      isActive: () => pinned
    };
  });
})();
