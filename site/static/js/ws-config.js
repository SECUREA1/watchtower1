(() => {
  const CLOUD_HTTP_BASE = "https://watchtower-3l5i.onrender.com";
  const CLOUD_WS = `${CLOUD_HTTP_BASE.replace(/^http/i, "ws")}/ws`;

  const normalizeWsUrl = (value) => {
    const raw = (value || "").trim();
    if (!raw) return CLOUD_WS;

    if (/^wss?:\/\//i.test(raw)) {
      return raw.toLowerCase().endsWith("/ws") ? raw : `${raw.replace(/\/+$/, "")}/ws`;
    }

    if (/^https?:\/\//i.test(raw)) {
      const wsBase = raw.replace(/^http/i, "ws").replace(/\/+$/, "");
      return wsBase.toLowerCase().endsWith("/ws") ? wsBase : `${wsBase}/ws`;
    }

    const inferredProto = location.protocol === "https:" ? "wss" : "ws";
    const normalizedHost = raw.replace(/^\/+/, "").replace(/\/+$/, "");
    return `${inferredProto}://${normalizedHost}/ws`;
  };

  const params = new URLSearchParams(location.search);

  const resolveFromQueryOrStorage = () => {
    const wsFromQuery = params.get("ws");
    if (wsFromQuery) {
      const normalized = normalizeWsUrl(wsFromQuery);
      try { localStorage.setItem("watchtower_ws_url", normalized); } catch (_) {}
      return normalized;
    }

    try {
      const wsFromStorage = localStorage.getItem("watchtower_ws_url");
      if (wsFromStorage) return normalizeWsUrl(wsFromStorage);
    } catch (_) {
      // ignore storage errors
    }

    return "";
  };

  const defaultWsUrl = () => {
    const resolved = resolveFromQueryOrStorage() || normalizeWsUrl(CLOUD_HTTP_BASE);
    try {
      localStorage.setItem("watchtower_ws_url", resolved);
    } catch (_) {
      // ignore persistence errors
    }
    return resolved;
  };

  const resolveWsUrl = (preferredBase) => {
    if (preferredBase) return normalizeWsUrl(preferredBase);
    return defaultWsUrl();
  };

  const wsConfig = {
    cloudHttpBase: CLOUD_HTTP_BASE,
    cloudWs: CLOUD_WS,
    normalizeWsUrl,
    defaultWsUrl,
    resolveWsUrl,
  };

  window.watchtowerWsConfig = wsConfig;
  // Backward compatibility for pages still referencing the old RedNode name.
  window.rednodeWsConfig = wsConfig;
})();
