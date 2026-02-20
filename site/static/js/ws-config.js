(() => {
  const CLOUD_WS = "wss://watchtower-3l5i.onrender.com/ws";
  const LEGACY_CLOUD_HOSTS = new Set(["watchtower-kw2o.onrender.com"]);

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

  const migrateLegacyWsUrl = (value) => {
    const normalized = normalizeWsUrl(value);
    if (!normalized) return "";
    try {
      const parsed = new URL(normalized);
      if (!LEGACY_CLOUD_HOSTS.has(parsed.host)) return normalized;
      return CLOUD_WS;
    } catch (_) {
      return normalized;
    }
  };

  const defaultWsUrl = () => {
    const stored = migrateLegacyWsUrl(localStorage.getItem("watchtower_ws_url"));
    if (stored) {
      if (stored === CLOUD_WS) {
        localStorage.setItem("watchtower_ws_url", CLOUD_WS);
      }
      return stored;
    }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sameOrigin = ensureWsPath(`${proto}://${location.host}`);
    const host = location.hostname;

    if (location.protocol === "file:") return CLOUD_WS;
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      return sameOrigin;
    }
    if (location.host === new URL(CLOUD_WS).host) return CLOUD_WS;
    return CLOUD_WS;
  };

  const resolveWsUrl = (override) => normalizeWsUrl(override) || defaultWsUrl();

  const wsConfig = {
    cloudWs: CLOUD_WS,
    normalizeWsUrl,
    defaultWsUrl,
    resolveWsUrl,
  };

  window.watchtowerWsConfig = wsConfig;
  // Backward compatibility for pages still referencing the old RedNode name.
  window.rednodeWsConfig = wsConfig;
})();
