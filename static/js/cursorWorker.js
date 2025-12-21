'use strict';

let ports = [];
let running = false;
let settings = {};

self.onconnect = (event) => {
  const port = event.ports[0];
  ports.push(port);

  port.onmessage = (messageEvent) => {
    const { type, payload } = messageEvent.data || {};
    switch (type) {
      case 'start':
        settings = { ...settings, ...(payload || {}) };
        startCursors();
        break;
      case 'stop':
        stopCursors();
        break;
      case 'updateSettings':
        settings = { ...settings, ...(payload || {}) };
        broadcast({ type: 'settingsUpdated', payload: settings });
        break;
      case 'getSettings':
        port.postMessage({ type: 'settings', payload: settings });
        break;
      case 'status':
        port.postMessage({ type: 'status', payload: { running } });
        break;
      default:
        break;
    }
  };

  port.start();
  port.postMessage({ type: 'connected', payload: { running, settings } });
};

function broadcast(message) {
  ports = ports.filter((port) => {
    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      return false;
    }
  });
}

function startCursors() {
  if (running) return;
  running = true;
  tickLoop();
  broadcast({ type: 'started' });
}

function stopCursors() {
  running = false;
  broadcast({ type: 'stopped' });
}

async function tickLoop() {
  while (running) {
    broadcast({ type: 'cursorTick', payload: { time: Date.now(), settings } });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}
