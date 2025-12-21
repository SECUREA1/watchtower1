# OmConsole Background Runtime (Pinned Mode)

This folder provides a SharedWorker + iframe fallback runtime that keeps OmConsole cursor/control logic active even after the visible console UI is hidden. It includes a client helper library that pages can load to display a site-wide overlay cursor and post messages to the background runtime.

## Files

- `omconsole/shared-worker.js` — SharedWorker background runtime.
- `omconsole/background.html` — iframe fallback runtime for browsers without SharedWorker (Safari).
- `static/js/omconsole-client.js` — client library used by pages to connect, pin/unpin, and render the cursor overlay.

## Integration

1. Serve the files at the following URLs:
   - `/omconsole/shared-worker.js`
   - `/omconsole/background.html`
   - `/static/js/omconsole-client.js`
2. Include the client script on any page that needs the overlay cursor or pin/unpin behavior.

```html
<button id="pin-btn">Pin</button>
<button id="close-ui-btn">Close UI</button>

<script src="/static/js/omconsole-client.js"></script>
<script>
  document.getElementById('pin-btn').addEventListener('click', () => {
    // Optional WS URL to a device/backend providing cursor updates.
    OmConsoleClient.pinOmConsole('wss://example.com/omconsole-ws');
  });

  document.getElementById('close-ui-btn').addEventListener('click', () => {
    // Hide the console UI while keeping background pinned.
    document.getElementById('console-panel').style.display = 'none';
  });

  // Auto connect if pinned on load.
  OmConsoleClient.autoInit();
</script>
```

### CSS Snippet (Cursor Overlay)

The client injects a default cursor overlay style, but you can override it by targeting `#omconsole-cursor-overlay`:

```css
#omconsole-cursor-overlay {
  width: 16px;
  height: 16px;
  background: rgba(0, 200, 255, 0.8);
  box-shadow: 0 0 8px rgba(0, 200, 255, 0.6);
  border-radius: 50%;
  pointer-events: none;
  z-index: 2147483647;
}
```

## Manual Test Plan

1. Open a page with OmConsole, click **Pin**, verify that the SharedWorker connects (or iframe fallback is created in Safari).
2. Hide the console UI (e.g., set the console panel `display: none`). The overlay cursor should continue updating.
3. Open a second tab on the site: the cursor overlay should be visible and synchronized.
4. Reload a pinned page: the overlay should reconnect and request the last cursor state.
5. Send cursor updates from a WebSocket server (payload `{ "cursor": { "x": 100, "y": 200, "visible": true } }`) and confirm updates.
6. Click **Unpin** and confirm the pinned state is cleared and the background runtime closes the WebSocket.
7. Safari-only: confirm the iframe fallback is used and behaves the same.

## Limitations & Persistence Note

The background runtime only lives as long as at least one tab is open. Closing all tabs/windows stops the runtime and any WebSocket connection. If you need persistence beyond tab closure, consider a server-side session that maintains cursor/device state, or a native/desktop companion app to keep the background process alive.
