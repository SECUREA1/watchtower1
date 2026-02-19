(function () {
  if (window.__rnLiveCounterLoaded) return;
  window.__rnLiveCounterLoaded = true;

  const usernameFromStorage = () => {
    try {
      const saved = localStorage.getItem("session_user");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.username) return parsed.username;
      }
    } catch {}
    try {
      const wallet = localStorage.getItem("mixer_current_wallet");
      if (wallet) return wallet;
    } catch {}
    return "guest";
  };

  const currentUser = () =>
    (window.APP_CONTEXT && window.APP_CONTEXT.username) ||
    usernameFromStorage() ||
    "guest";

  const style = document.createElement("style");
  style.textContent = `
    #rn-live-counter {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483646;
      background: rgba(10, 7, 4, 0.92);
      border: 1px solid rgba(245, 198, 90, 0.24);
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
      border-radius: 14px;
      padding: 12px 14px;
      max-width: min(360px, 92vw);
      color: #f9f3e6;
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
      backdrop-filter: blur(10px);
    }
    #rn-live-counter h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #f5c65a;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #rn-live-counter h4 span {
      font-size: 12px;
      color: #d2b98a;
      font-weight: 600;
    }
    #rn-live-counter .rn-live-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      margin-bottom: 8px;
    }
    #rn-live-counter .stat {
      padding: 8px 10px;
      border-radius: 10px;
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(245, 198, 90, 0.16);
      display: grid;
      gap: 2px;
    }
    #rn-live-counter .stat .label {
      font-size: 11px;
      color: #d2b98a;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    #rn-live-counter .stat .value {
      font-size: 16px;
      font-weight: 700;
      color: #f6e9c5;
    }
    #rn-live-counter .users {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-height: 120px;
      overflow-y: auto;
    }
    #rn-live-counter .user-pill {
      padding: 6px 8px;
      border-radius: 999px;
      background: rgba(245, 198, 90, 0.12);
      border: 1px solid rgba(245, 198, 90, 0.28);
      font-size: 12px;
      color: #f9f3e6;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    #rn-live-counter .user-pill.self {
      background: rgba(0, 180, 130, 0.22);
      border-color: rgba(0, 255, 190, 0.32);
      color: #d7ffe1;
      box-shadow: 0 0 0 1px rgba(0, 255, 190, 0.2);
    }
    #rn-live-counter .user-pill .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #21e39b;
      box-shadow: 0 0 8px rgba(33, 227, 155, 0.7);
    }
  `;
  document.head.appendChild(style);

  const widget = document.createElement("section");
  widget.id = "rn-live-counter";
  widget.innerHTML = `
    <h4>Live Presence <span id="rn-live-uptime">active</span></h4>
    <div class="rn-live-stats">
      <div class="stat">
        <div class="label">Online now</div>
        <div class="value" id="rn-live-total">0</div>
      </div>
      <div class="stat">
        <div class="label">Your views</div>
        <div class="value" id="rn-live-self">0</div>
      </div>
    </div>
    <div class="users" id="rn-live-users" aria-live="polite"></div>
  `;
  document.body.appendChild(widget);

  const totalEl = widget.querySelector("#rn-live-total");
  const selfEl = widget.querySelector("#rn-live-self");
  const usersEl = widget.querySelector("#rn-live-users");
  const uptimeEl = widget.querySelector("#rn-live-uptime");

  let ws;
  let retryDelay = 1200;
  const maxDelay = 15000;
  let retryTimer;

  const renderUsers = (users, count) => {
    totalEl.textContent = `${count}`;
    const me = currentUser();
    const tally = users.reduce((acc, u) => {
      const name = (u.name || "guest").trim() || "guest";
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {});
    const mine = tally[me] || 0;
    selfEl.textContent = `${mine}`;

    usersEl.innerHTML = "";
    const sorted = [...Object.entries(tally)].sort((a, b) => b[1] - a[1]);
    for (const [name, c] of sorted) {
      const pill = document.createElement("div");
      pill.className = "user-pill" + (name === me ? " self" : "");
      pill.innerHTML = `<span class="dot"></span><span>${name}</span><span>· ${c}</span>`;
      usersEl.appendChild(pill);
    }
  };

  const connect = () => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const fallback = `${protocol}//${location.host}/ws`;
    const url = window.rednodeWsConfig?.resolveWsUrl?.() || fallback;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      retryDelay = 1200;
      uptimeEl.textContent = "active";
      try {
        ws.send(
          JSON.stringify({
            type: "join",
            user: currentUser(),
          })
        );
      } catch {}
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === "users") {
          renderUsers(msg.users || [], msg.count || 0);
        }
      } catch {}
    };

    ws.onclose = scheduleReconnect;
    ws.onerror = scheduleReconnect;
  };

  const scheduleReconnect = () => {
    uptimeEl.textContent = "reconnecting…";
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryDelay = Math.min(maxDelay, Math.floor(retryDelay * 1.6));
      connect();
    }, retryDelay);
  };

  connect();
})();
