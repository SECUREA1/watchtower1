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

  const defaultWsUrl = () => {
    const url = normalizeWsUrl(CLOUD_HTTP_BASE);
    try {
      localStorage.setItem("watchtower_ws_url", url);
    } catch (_) {
      // ignore persistence errors
    }
    return url;
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
