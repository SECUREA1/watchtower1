// OmConsole SharedWorker background runtime.
// Keeps cursor state and optional WebSocket connection alive across tabs.

const ports = new Set();
let cursorState = { x: 0, y: 0, visible: true };
let ws = null;
let wsUrl = null;
let reconnectTimer = null;
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY_MS = 10000;

function broadcast(message) {
  ports.forEach((port) => {
    try {
      port.postMessage(message);
    } catch (error) {
      // Ignore transient port errors.
    }
  });
}

function updateCursorState(newState) {
  cursorState = { ...cursorState, ...newState };
  broadcast({ type: 'cursor', payload: cursorState });
}

function scheduleReconnect() {
  if (!wsUrl) {
    return;
  }
  if (reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    ensureWebSocket(wsUrl);
  }, reconnectDelayMs);
}

function resetReconnectDelay() {
  reconnectDelayMs = 1000;
}

function closeWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
  }
  wsUrl = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  resetReconnectDelay();
}

function ensureWebSocket(url) {
  if (!url) {
    return;
  }
  if (ws && wsUrl === url && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  closeWebSocket();
  wsUrl = url;
  try {
    ws = new WebSocket(url);
  } catch (error) {
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    resetReconnectDelay();
  });

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data && data.cursor) {
        updateCursorState(data.cursor);
      }
    } catch (error) {
      // Ignore malformed WebSocket payloads.
    }
  });

  ws.addEventListener('close', () => {
    scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    scheduleReconnect();
  });
}

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.add(port);
  port.start();

  port.onmessage = (messageEvent) => {
    const message = messageEvent.data || {};
    switch (message.type) {
      case 'pin': {
        const payload = message.payload || {};
        if (payload.wsUrl) {
          ensureWebSocket(payload.wsUrl);
        }
        broadcast({ type: 'pinned', payload: { pinned: true } });
        break;
      }
      case 'unpin': {
        closeWebSocket();
        broadcast({ type: 'pinned', payload: { pinned: false } });
        break;
      }
      case 'cursor_update': {
        if (message.payload) {
          updateCursorState(message.payload);
        }
        break;
      }
      case 'request_state': {
        port.postMessage({ type: 'cursor', payload: cursorState });
        break;
      }
      case 'settings': {
        // Reserved for future settings updates.
        break;
      }
      default:
        break;
    }
  };

  port.onmessageerror = () => {
    ports.delete(port);
  };

  port.onclose = () => {
    ports.delete(port);
  };

  port.postMessage({ type: 'cursor', payload: cursorState });
};
