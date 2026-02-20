(() => {
  const getEl = (id) => document.getElementById(id);

  const MAX_BACKOFF = 60000;
  const INITIAL_BACKOFF = 1000;

  const state = {
    socket: null,
    reconnectTimer: null,
    backoff: INITIAL_BACKOFF,
    skipReconnect: false,
  };

  const getStatusEls = () => ({
    container: getEl('wsStatus'),
    dot: getEl('wsStatusDot'),
    text: getEl('wsStatusText'),
  });

  function setWsStatus(label, variant) {
    const { container, dot, text } = getStatusEls();
    if (text) text.textContent = label;
    if (dot) dot.className = 'status-dot';
    if (container) {
      container.classList.remove('ws-connected', 'ws-connecting', 'ws-disconnected', 'ws-error');
      if (variant) container.classList.add(variant);
    }
  }

  function buildWsUrl() {
    const configuredResolver = window.watchtowerWsConfig?.resolveWsUrl;
    if (typeof configuredResolver === 'function') {
      const resolved = configuredResolver();
      if (resolved) return resolved;
    }
    return 'wss://watchtower-3l5i.onrender.com/ws';
  }

  function clearSocket() {
    if (state.socket) {
      state.skipReconnect = true;
      try {
        state.socket.close();
      } catch (_) {
        // ignore
      }
      state.socket = null;
    }
  }

  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    const delay = state.backoff;
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
    state.backoff = Math.min(MAX_BACKOFF, state.backoff * 2);
  }

  function handleOpen() {
    state.backoff = INITIAL_BACKOFF;
    setWsStatus('Connected', 'ws-connected');
    const username = (getEl('username')?.value || '').trim() || 'web-client';
    try {
      state.socket?.send(JSON.stringify({ type: 'join', user: username }));
    } catch (_) {
      // ignore send errors
    }
  }

  function handleMessage(event) {
    if (!event?.data) return;
    try {
      const payload = JSON.parse(event.data);
      if (payload?.type === 'system' && payload.text) {
        console.info('[ws] system:', payload.text);
      }
    } catch (err) {
      console.debug('[ws] non-JSON message', event.data);
    }
  }

  function handleClose() {
    setWsStatus('Disconnected — reconnecting…', 'ws-disconnected');
    if (state.skipReconnect) {
      state.skipReconnect = false;
      return;
    }
    scheduleReconnect();
  }

  function handleError(event) {
    console.error('[ws] error', event);
    setWsStatus('Error — retrying…', 'ws-error');
    try {
      state.socket?.close();
    } catch (_) {
      // ignore
    }
  }

  function connect() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    clearSocket();

    const url = buildWsUrl();
    setWsStatus('Connecting…', 'ws-connecting');

    try {
      state.socket = new WebSocket(url);
    } catch (error) {
      console.error('[ws] failed to create socket', error);
      setWsStatus('Error — retrying…', 'ws-error');
      scheduleReconnect();
      return;
    }

    state.socket.addEventListener('open', handleOpen);
    state.socket.addEventListener('message', handleMessage);
    state.socket.addEventListener('close', handleClose);
    state.socket.addEventListener('error', handleError);
  }

  function resetAndReconnect() {
    state.backoff = INITIAL_BACKOFF;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    clearSocket();
    connect();
  }

  function init() {
    connect();
    const overrideInput = getEl('serverUrl');
    if (overrideInput) {
      overrideInput.addEventListener('change', () => {
        resetAndReconnect();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.watchtowerWS = {
    connect,
    close: clearSocket,
    wsRef: () => state.socket,
  };
})();
