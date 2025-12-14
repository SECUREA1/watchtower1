(() => {
  if (window.__omconsoleLauncherLoaded) return;
  window.__omconsoleLauncherLoaded = true;

  const PIN_KEY = 'omconsole_pinned';
  const OVERLAY_ID = 'omconsole-overlay';
  const BTN_ID = 'omconsole-launch-btn';
  const SOCIAL_ID = 'omconsole-social-btn';
  const WRAP_ID = 'omconsole-launch-wrap';
  const SOCIAL_URL = 'https://www.chaines.io';
  // Use an absolute URL so the iframe loads correctly from nested routes
  // (e.g., /live/) instead of resolving relative to the current page.
  const FRAME_URL = '/omconsole_render_single_games_ROUTING.html';
  const isConsolePage = location.pathname.includes('omconsole_render_single_games_ROUTING.html');

  let pinned = false;
  let overlay = null;
  let consoleButton = null;
  let consoleIcon = null;
  let consoleLabel = null;
  let socialButton = null;
  let socialIcon = null;
  let socialLabel = null;

  const applyStyles = (el, styles) => Object.assign(el.style, styles);

  function updateButton() {
    if (!consoleButton) return;
    consoleButton.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    if (consoleLabel) {
      consoleLabel.textContent = pinned ? 'OMConsole (open)' : 'Open OMConsole';
    }

    const activeStyles = pinned
      ? {
          background: 'linear-gradient(135deg, #14ffe9 0%, #ffeb3b 50%, #ff00e0 100%)',
          boxShadow: '0 18px 50px rgba(255, 0, 224, 0.35), 0 0 22px rgba(20, 255, 233, 0.45)',
          borderColor: 'rgba(255,255,255,0.65)',
          color: '#040712'
        }
      : {
          background: 'linear-gradient(135deg, #0a1e3a 0%, #162c58 45%, #531bc7 100%)',
          boxShadow: '0 16px 40px rgba(0,0,0,0.4), 0 0 30px rgba(83, 27, 199, 0.35)',
          borderColor: 'rgba(255,255,255,0.22)',
          color: '#f8fbff'
        };

    applyStyles(consoleButton, activeStyles);

    if (consoleIcon) {
      consoleIcon.style.filter = pinned ? 'drop-shadow(0 0 12px rgba(255, 0, 224, 0.7))' : 'drop-shadow(0 0 10px rgba(83, 27, 199, 0.55))';
    }
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
    if (consoleButton && socialButton) return consoleButton;
    const wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    applyStyles(wrap, {
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      zIndex: '99997',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
      flexWrap: 'wrap',
      gap: '10px',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    });

    const consoleBtn = document.createElement('button');
    consoleBtn.id = BTN_ID;
    consoleBtn.type = 'button';
    consoleBtn.title = 'Open the OMConsole overlay';
    applyStyles(consoleBtn, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      borderRadius: '14px',
      border: '1px solid rgba(212,175,55,0.35)',
      padding: '12px 16px',
      cursor: 'pointer',
      boxShadow: '0 18px 40px rgba(0,0,0,0.3)',
      fontWeight: '800',
      letterSpacing: '.3px',
      fontSize: '13px',
      textTransform: 'uppercase',
      background: 'linear-gradient(135deg, #0a1e3a 0%, #162c58 45%, #531bc7 100%)',
      color: '#f8fbff',
      borderColor: 'rgba(255,255,255,0.22)',
      transition: 'transform 160ms ease, box-shadow 200ms ease'
    });

    const consoleIconEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    consoleIconEl.setAttribute('aria-hidden', 'true');
    consoleIconEl.setAttribute('focusable', 'false');
    consoleIconEl.setAttribute('width', '22');
    consoleIconEl.setAttribute('height', '22');
    consoleIconEl.setAttribute('viewBox', '0 0 64 64');
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.id = 'console-glow';
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%');
    gradient.setAttribute('y2', '100%');

    const stops = [
      { offset: '0%', color: '#14ffe9' },
      { offset: '50%', color: '#ffeb3b' },
      { offset: '100%', color: '#ff00e0' }
    ];

    stops.forEach(({ offset, color }) => {
      const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', color);
      gradient.appendChild(stop);
    });

    defs.appendChild(gradient);
    consoleIconEl.appendChild(defs);

    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('cx', '32');
    ring.setAttribute('cy', '32');
    ring.setAttribute('r', '28');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'url(#console-glow)');
    ring.setAttribute('stroke-width', '4');
    ring.setAttribute('opacity', '0.85');
    consoleIconEl.appendChild(ring);

    const bolt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bolt.setAttribute('d', 'M30 6 L18 34 H30 L26 58 L46 26 H34 L40 6 Z');
    bolt.setAttribute('fill', 'url(#console-glow)');
    bolt.setAttribute('stroke', '#050910');
    bolt.setAttribute('stroke-width', '2');
    bolt.setAttribute('stroke-linejoin', 'round');
    consoleIconEl.appendChild(bolt);

    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    spark.setAttribute('cx', '48');
    spark.setAttribute('cy', '16');
    spark.setAttribute('r', '4');
    spark.setAttribute('fill', '#fff4a3');
    spark.setAttribute('opacity', '0.9');
    consoleIconEl.appendChild(spark);

    const label = document.createElement('span');
    label.textContent = 'Open OMConsole';
    applyStyles(label, { fontSize: '13px', fontWeight: '900', letterSpacing: '.4px' });

    consoleBtn.append(consoleIconEl, label);

    consoleIcon = consoleIconEl;
    consoleLabel = label;

    consoleBtn.addEventListener('mouseenter', () => {
      applyStyles(consoleBtn, { transform: 'translateY(-2px) scale(1.01)' });
    });

    consoleBtn.addEventListener('mouseleave', () => {
      applyStyles(consoleBtn, { transform: 'translateY(0) scale(1)' });
    });

    consoleBtn.addEventListener('click', () => {
      setPinned(!pinned);
    });

    const socialBtn = document.createElement('button');
    socialBtn.id = SOCIAL_ID;
    socialBtn.type = 'button';
    socialBtn.title = 'Open Chaines.io (new tab)';
    applyStyles(socialBtn, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      borderRadius: '14px',
      border: '1px solid rgba(212,175,55,0.35)',
      padding: '12px 16px',
      cursor: 'pointer',
      boxShadow: '0 18px 40px rgba(0,0,0,0.3)',
      fontWeight: '800',
      letterSpacing: '.3px',
      fontSize: '13px',
      textTransform: 'uppercase',
      background: 'linear-gradient(135deg, #0a1e3a 0%, #162c58 45%, #531bc7 100%)',
      color: '#f8fbff',
      borderColor: 'rgba(255,255,255,0.22)',
      transition: 'transform 160ms ease, box-shadow 200ms ease'
    });

    const martini = document.createElement('img');
    martini.src = '/static/icons/martini.svg';
    martini.alt = '';
    applyStyles(martini, { width: '22px', height: '22px' });

    const socialLabelEl = document.createElement('span');
    socialLabelEl.textContent = 'Chaines.io';
    applyStyles(socialLabelEl, { fontSize: '13px', fontWeight: '900', letterSpacing: '.4px' });

    socialBtn.append(martini, socialLabelEl);

    socialIcon = martini;
    socialLabel = socialLabelEl;

    socialBtn.addEventListener('mouseenter', () => {
      applyStyles(socialBtn, { transform: 'translateY(-2px) scale(1.01)' });
    });

    socialBtn.addEventListener('mouseleave', () => {
      applyStyles(socialBtn, { transform: 'translateY(0) scale(1)' });
    });

    socialBtn.addEventListener('click', () => {
      window.open(SOCIAL_URL, '_blank', 'noopener,noreferrer');
    });

    wrap.append(consoleBtn, socialBtn);
    document.body.appendChild(wrap);

    consoleButton = consoleBtn;
    socialButton = socialBtn;
    updateButton();
    return consoleBtn;
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
