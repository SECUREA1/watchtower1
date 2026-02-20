(() => {
  const CLOUD_WS = "wss://watchtower-3l5i.onrender.com/ws";

  const normalizeWsUrl = () => CLOUD_WS;

  const defaultWsUrl = () => {
    try {
      localStorage.setItem("watchtower_ws_url", CLOUD_WS);
    } catch (_) {
      // ignore persistence errors
    }
    return CLOUD_WS;
  };

  const resolveWsUrl = () => defaultWsUrl();

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
