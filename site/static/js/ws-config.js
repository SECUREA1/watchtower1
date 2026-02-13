(() => {
  const RUNTIME_WS = window.__WATCHTOWER_WS_URL || "";

  const ensureWsPath = (value) => {
    const trimmed = value.replace(/\/+$/, "");
    return trimmed.toLowerCase().endsWith("/ws") ? trimmed : `${trimmed}/ws`;
  };

  const normalizeWsUrl = (input) => {
    const raw = (input || "").trim();
    if (!raw) return "";
    if (/^wss?:\/\//i.test(raw)) {
      return ensureWsPath(raw);
    }
    if (/^https?:\/\//i.test(raw)) {
      const proto = raw.toLowerCase().startsWith("https:") ? "wss" : "ws";
      const hostAndPath = raw.replace(/^https?:\/\//i, "");
      return ensureWsPath(`${proto}://${hostAndPath}`);
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return ensureWsPath(`${proto}://${raw}`);
  };

  const defaultWsUrl = () => {
    const stored = normalizeWsUrl(localStorage.getItem("rednode_ws_url"));
    if (stored) return stored;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sameOrigin = ensureWsPath(`${proto}://${location.host}`);
    const host = location.hostname;

    const runtime = normalizeWsUrl(RUNTIME_WS);
    if (location.protocol === "file:") return runtime || "ws://localhost:10000/ws";
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      return runtime || sameOrigin;
    }
    return runtime || sameOrigin;
  };

  const resolveWsUrl = (override) => normalizeWsUrl(override) || defaultWsUrl();

  window.rednodeWsConfig = {
    cloudWs: normalizeWsUrl(RUNTIME_WS),
    normalizeWsUrl,
    defaultWsUrl,
    resolveWsUrl,
  };
})();
