(function () {
  if (window.__rnLiveCloudBridgeLoaded) return;
  window.__rnLiveCloudBridgeLoaded = true;

  const state = {
    ws: null,
    retryTimer: null,
    retryDelay: 1200,
    isBroadcaster: false,
    joined: false,
  };

  const username = () => {
    try {
      const saved = localStorage.getItem("session_user");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.username) return parsed.username;
      }
    } catch {}
    return (window.APP_CONTEXT && window.APP_CONTEXT.username) || "guest";
  };

  const wsUrl = () => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/ws`;
  };

  const send = (payload) => {
    try {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(payload));
      }
    } catch {}
  };

  const setBroadcaster = () => {
    if (state.isBroadcaster) return;
    state.isBroadcaster = true;
    send({ type: "broadcaster" });
  };

  const looksLikeLivePage = () => {
    if (document.querySelector("video, canvas")) return true;
    const html = document.documentElement?.innerHTML || "";
    return /(getUserMedia|mediaDevices|RTCPeerConnection|broadcast|webcam|camera)/i.test(html);
  };

  const connect = () => {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let ws;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      scheduleReconnect();
      return;
    }

    state.ws = ws;

    ws.onopen = () => {
      state.retryDelay = 1200;
      state.joined = true;
      send({ type: "join", user: username() });
      if (looksLikeLivePage()) setBroadcaster();
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg?.type === "live-peers" && state.isBroadcaster) {
        for (const peer of msg.peers || []) {
          if (peer?.id) send({ type: "watcher", id: peer.id });
        }
      }

      if (msg?.type === "id") {
        window.__rnSocketId = msg.id;
      }
    };

    ws.onclose = scheduleReconnect;
    ws.onerror = scheduleReconnect;
  };

  const scheduleReconnect = () => {
    if (state.retryTimer) return;
    state.retryTimer = setTimeout(() => {
      state.retryTimer = null;
      state.retryDelay = Math.min(15000, Math.floor(state.retryDelay * 1.5));
      connect();
    }, state.retryDelay);
  };

  const patchGetUserMedia = () => {
    const media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== "function") return;

    const original = media.getUserMedia.bind(media);
    media.getUserMedia = function (...args) {
      setBroadcaster();
      return original(...args);
    };
  };

  patchGetUserMedia();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect, { once: true });
  } else {
    connect();
  }

  window.addEventListener("beforeunload", () => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.isBroadcaster) {
      send({ type: "end-broadcast" });
    }
  });
})();
