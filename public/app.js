(() => {
  const loginEl = document.getElementById("login");
  const desktopEl = document.getElementById("desktop");
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const connectBtn = document.getElementById("connect-btn");
  const usernameEl = document.getElementById("username");
  const passwordEl = document.getElementById("password");
  const gateRow = document.getElementById("gate-row");
  const gateEl = document.getElementById("gate-password");
  const displayEl = document.getElementById("display");
  const viewportEl = document.getElementById("viewport");
  const clipboardEl = document.getElementById("clipboard");
  const statusDot = document.getElementById("status-dot");
  const sessionState = document.getElementById("session-state");
  const sessionTitle = document.getElementById("session-title");
  const connectLabel = document.getElementById("connect-label");
  const veilEl = document.getElementById("veil");
  const fitBtn = document.getElementById("fit-btn");
  const togglePass = document.getElementById("toggle-pass");
  const desktopListEl = document.getElementById("desktop-list");
  const desktopIdEl = document.getElementById("desktop-id");
  const searchEl = document.getElementById("desktop-search");
  const showMoreBtn = document.getElementById("show-more");
  const filterBtn = document.getElementById("filter-btn");
  const filterMenu = document.getElementById("filter-menu");
  const connectNameEl = document.getElementById("connect-name");
  const connectModal = document.getElementById("connect-modal");
  const gateAuth = document.getElementById("gate-auth");
  const pickerWrap = document.getElementById("picker-wrap");
  const gateUserbar = document.getElementById("gate-userbar");
  const gateWho = document.getElementById("gate-who");
  const gateAuthError = document.getElementById("gate-auth-error");

  let client = null;
  let keyboard = null;
  let mouse = null;
  let touch = null;
  let pasteHandler = null;
  let displayHandler = null;
  let fitMode = true;
  let selectedDesktop = null;
  let allDesktops = [];
  let desktopFilter = "all";
  let desktopQuery = "";
  let loggedIn = false;
  let showAllDesktops = false;
  let minimized = false;
  let sessionLive = false;
  let leaveHandled = false;
  let sawContent = false;
  let connectStartedAt = 0;
  let sessionWatch = null;
  const PAGE_SIZE = 8;
  const sessionId = new URLSearchParams(location.search).get("id") || "";
  const isSessionTab = location.pathname.replace(/\/+$/, "") === "/session";
  if (isSessionTab) document.body.classList.add("session-tab");
  if (isSessionTab && !sessionId) location.replace("/");

  function setError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function setState(label, kind) {
    sessionState.textContent = label;
    statusDot.classList.remove("ok", "bad");
    if (kind) statusDot.classList.add(kind);
    if (veilEl) veilEl.hidden = kind === "ok" || kind === "bad";
  }

  function wsUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/guac`;
  }

  function clearDisplay() {
    while (displayEl.firstChild) displayEl.removeChild(displayEl.firstChild);
  }

  function fitDisplay() {
    if (!client || !fitMode) return;
    const display = client.getDisplay();
    const width = display.getWidth();
    const height = display.getHeight();
    if (!width || !height) return;
    const scale = Math.min(
      viewportEl.clientWidth / width,
      viewportEl.clientHeight / height
    );
    display.scale(scale || 1);
  }

  function sendCtrlAltDel() {
    if (!client) return;
    const keys = [0xffe3, 0xffe9, 0xffff];
    keys.forEach((key) => client.sendKeyEvent(1, key));
    keys.slice().reverse().forEach((key) => client.sendKeyEvent(0, key));
  }

  function sendLocalClipboard() {
    if (!client) return;
    const text = clipboardEl.value;
    if (!text) return;
    const stream = client.createClipboardStream("text/plain");
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(text);
    writer.sendEnd();
  }

  function stopSessionWatch() {
    if (sessionWatch) {
      clearInterval(sessionWatch);
      sessionWatch = null;
    }
  }

  function markSessionLive() {
    if (leaveHandled) return;
    sessionLive = true;
    setState("Connected", "ok");
  }

  function sampleDisplayBlack() {
    try {
      const canvases = displayEl.querySelectorAll("canvas");
      let canvas = null;
      let best = 0;
      for (const node of canvases) {
        const area = (node.width || 0) * (node.height || 0);
        if (area > best) {
          best = area;
          canvas = node;
        }
      }
      if (!canvas || canvas.width < 16 || canvas.height < 16) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      let sum = 0;
      let sum2 = 0;
      let maxL = 0;
      const steps = 8;
      const n = steps * steps;
      for (let y = 0; y < steps; y += 1) {
        for (let x = 0; x < steps; x += 1) {
          const px = Math.min(canvas.width - 1, Math.floor((x + 0.5) * canvas.width / steps));
          const py = Math.min(canvas.height - 1, Math.floor((y + 0.5) * canvas.height / steps));
          const d = ctx.getImageData(px, py, 1, 1).data;
          const l = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];
          sum += l;
          sum2 += l * l;
          if (l > maxL) maxL = l;
        }
      }
      const mean = sum / n;
      const variance = sum2 / n - mean * mean;
      return { mean, variance, maxL };
    } catch (_) {
      return null;
    }
  }

  function startSessionWatch(protocol) {
    stopSessionWatch();
    sawContent = false;
    let blackTicks = 0;
    const watchBlack = protocol !== "ssh";
    sessionWatch = setInterval(() => {
      if (leaveHandled || !client) return;
      const display = client.getDisplay();
      if (display.getWidth() > 0 && display.getHeight() > 0) markSessionLive();
      if (!watchBlack) return;
      const sample = sampleDisplayBlack();
      if (!sample) return;
      const dead = sample.maxL < 14 && sample.mean < 8 && sample.variance < 12;
      if (!dead) {
        sawContent = true;
        blackTicks = 0;
        return;
      }
      if (!sawContent) return;
      blackTicks += 1;
      if (blackTicks >= 2) handleRemoteDisconnect();
    }, 800);
  }

  function cleanup() {
    stopSessionWatch();
    if (pasteHandler) {
      window.removeEventListener("paste", pasteHandler);
      pasteHandler = null;
    }
    if (displayHandler) {
      window.removeEventListener("resize", displayHandler);
      displayHandler = null;
    }
    if (keyboard) {
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
      try { keyboard.reset(); } catch (_) { /* ignore */ }
      keyboard = null;
    }
    mouse = null;
    touch = null;
    if (client) {
      try { client.disconnect(); } catch (_) { /* ignore */ }
      client = null;
    }
    clearDisplay();
  }

  function showLogin() {
    cleanup();
    document.body.classList.remove("in-session");
    document.body.classList.remove("is-ssh");
    desktopEl.classList.add("hidden");
    loginEl.classList.remove("hidden");
    passwordEl.value = "";
    closeConnect();
    if (veilEl) veilEl.hidden = true;
    setState("Disconnected", "bad");
    document.getElementById("hud")?.classList.remove("is-open");
    setMinimized(false);
    desktopEl.classList.remove("is-fill");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }

  function connectSession(token, protocol) {
    cleanup();
    sessionLive = false;
    leaveHandled = false;
    sawContent = false;
    connectStartedAt = Date.now();
    document.body.classList.add("in-session");
    document.body.classList.toggle("is-ssh", protocol === "ssh");
    loginEl.classList.add("hidden");
    desktopEl.classList.remove("hidden");
    setMinimized(false);
    if (veilEl) veilEl.hidden = false;
    setState("Connecting…");

    const tunnel = new Guacamole.WebSocketTunnel(wsUrl());
    client = new Guacamole.Client(tunnel);
    displayEl.appendChild(client.getDisplay().getElement());

    const onTransportClosed = (status) => {
      if (leaveHandled) return;
      setState("Disconnected", "bad");
      handleRemoteDisconnect(status);
    };

    client.onerror = (status) => onTransportClosed(status);

    client.onstatechange = (state) => {
      if (state === 3) {
        markSessionLive();
        return;
      }
      if (state === 4 || state === 5) onTransportClosed();
    };

    tunnel.onerror = (status) => onTransportClosed(status);
    tunnel.onstatechange = (state) => {
      if (state === 2) onTransportClosed();
    };

    client.onclipboard = (stream, mimetype) => {
      if (!mimetype || !mimetype.startsWith("text/")) return;
      let data = "";
      const reader = new Guacamole.StringReader(stream);
      reader.ontext = (text) => { data += text; };
      reader.onend = async () => {
        clipboardEl.value = data;
        try { await navigator.clipboard.writeText(data); } catch (_) { /* ignore */ }
      };
    };

    const display = client.getDisplay();
    display.onresize = () => {
      if (display.getWidth() > 0 && display.getHeight() > 0) markSessionLive();
      fitDisplay();
    };
    client.onsync = () => {
      sawContent = true;
      markSessionLive();
    };

    mouse = new Guacamole.Mouse(display.getElement());
    mouse.onEach(["mousedown", "mouseup", "mousemove"], (event) => {
      client.sendMouseState(event.state);
    });

    if (Guacamole.Mouse.Touchscreen) {
      touch = new Guacamole.Mouse.Touchscreen(display.getElement());
      touch.onEach(["mousedown", "mouseup", "mousemove"], (event) => {
        client.sendMouseState(event.state);
      });
    }

    keyboard = new Guacamole.Keyboard(window);
    keyboard.onkeydown = (keysym) => {
      if (minimized) return;
      client.sendKeyEvent(1, keysym);
    };
    keyboard.onkeyup = (keysym) => {
      if (minimized) return;
      client.sendKeyEvent(0, keysym);
    };

    pasteHandler = (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text || !client) return;
      clipboardEl.value = text;
      sendLocalClipboard();
    };
    window.addEventListener("paste", pasteHandler);

    displayHandler = () => {
      if (!client || minimized) return;
      try {
        client.sendSize(Math.floor(viewportEl.clientWidth), Math.floor(viewportEl.clientHeight));
      } catch (_) { /* older guacamole-common-js */ }
      fitDisplay();
    };
    window.addEventListener("resize", displayHandler);

    const width = Math.max(1024, Math.floor(viewportEl.clientWidth) || window.innerWidth);
    const height = Math.max(768, Math.floor(viewportEl.clientHeight) || window.innerHeight);
    const query = [
      `token=${encodeURIComponent(token)}`,
      `width=${width}`,
      `height=${height}`,
      "dpi=96",
    ];
    if (protocol !== "ssh") query.push("GUAC_AUDIO=audio/L16");
    client.connect(query.join("&"));
    startSessionWatch(protocol);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (client) {
      setMinimized(false);
      closeConnect();
      return;
    }
    setError("");
    connectBtn.disabled = true;
    if (connectLabel) connectLabel.textContent = "Connecting…";
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          desktopId: desktopIdEl.value,
          username: usernameEl.value.trim(),
          password: passwordEl.value,
          gatePassword: gateEl.value,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        showSignedOut();
        throw new Error(payload.error || "Sign in to the gateway first.");
      }
      if (!response.ok) {
        throw new Error(payload.error || "Could not start a desktop session.");
      }
      connectSession(payload.token, payload.protocol || selectedDesktop?.protocol);
      closeConnect();
      if (payload.desktopName) {
        sessionTitle.textContent = payload.desktopName;
        hudHub?.setAttribute("title", payload.desktopName);
      }
    } catch (err) {
      setError(err.message || "Could not start a desktop session.");
    } finally {
      connectBtn.disabled = false;
      if (connectLabel) connectLabel.textContent = "Connect";
    }
  });

  document.getElementById("disconnect-btn").addEventListener("click", () => {
    finishSession({ notice: true });
  });
  document.getElementById("cad-btn").addEventListener("click", sendCtrlAltDel);
  fitBtn.addEventListener("click", () => {
    if (minimized) setMinimized(false);
    fitMode = !fitMode;
    fitBtn.classList.toggle("is-on", fitMode);
    fitBtn.setAttribute("aria-pressed", String(fitMode));
    if (!client) return;
    if (fitMode) fitDisplay();
    else client.getDisplay().scale(1);
  });

  const hud = document.getElementById("hud");
  const hudHub = document.getElementById("hud-hub");
  const fsBtn = document.getElementById("fs-btn");
  const minBtn = document.getElementById("min-btn");
  const petals = [...hud.querySelectorAll(".hud-petal")];
  const HUD_POS_KEY = "cd-hud-pos";
  const PETAL_RADIUS = 82;
  const PETAL_ANGLES = [-100, -40, 20, 80, 140];

  function isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement || desktopEl.classList.contains("is-fill"));
  }

  function scheduleRefit() {
    window.setTimeout(() => {
      if (!client) return;
      try {
        client.sendSize(Math.floor(viewportEl.clientWidth), Math.floor(viewportEl.clientHeight));
      } catch (_) { /* ignore */ }
      fitDisplay();
    }, 80);
  }

  function syncFullscreenButton() {
    const on = isFullscreen();
    fsBtn.classList.toggle("is-on", on);
    fsBtn.textContent = on ? "Exit" : "Full";
    fsBtn.title = on ? "Exit fullscreen" : "Fullscreen";
  }

  async function toggleFullscreen() {
    if (minimized) setMinimized(false);
    const webkitEl = document.webkitFullscreenElement;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (webkitEl) {
        document.webkitExitFullscreen();
      } else if (desktopEl.requestFullscreen) {
        await desktopEl.requestFullscreen();
      } else if (desktopEl.webkitRequestFullscreen) {
        desktopEl.webkitRequestFullscreen();
      } else {
        desktopEl.classList.toggle("is-fill");
      }
    } catch (_) {
      desktopEl.classList.toggle("is-fill");
    }
    syncFullscreenButton();
    scheduleRefit();
  }

  function layoutPetals() {
    const rect = hud.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const flipY = cy < 110 ? 1 : -1;
    const flipX = cx > window.innerWidth - 110 ? -1 : 1;
    petals.forEach((petal, index) => {
      const rad = (PETAL_ANGLES[index] * Math.PI) / 180;
      const x = Math.cos(rad) * PETAL_RADIUS * flipX;
      const y = Math.sin(rad) * PETAL_RADIUS * flipY;
      petal.style.setProperty("--x", `${x}px`);
      petal.style.setProperty("--y", `${y}px`);
    });
  }

  function clampHud(x, y) {
    const pad = 12;
    const size = hud.offsetWidth || 58;
    const maxX = Math.max(pad, window.innerWidth - size - pad);
    const maxY = Math.max(pad, window.innerHeight - size - pad);
    return [Math.min(maxX, Math.max(pad, x)), Math.min(maxY, Math.max(pad, y))];
  }

  function placeHud(x, y) {
    const [left, top] = clampHud(x, y);
    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
    hud.style.right = "auto";
    hud.style.bottom = "auto";
    try { sessionStorage.setItem(HUD_POS_KEY, JSON.stringify({ left, top })); } catch (_) { /* ignore */ }
    if (hud.classList.contains("is-open")) layoutPetals();
  }

  function restoreHud() {
    const mobile = window.innerWidth <= 720;
    try {
      const saved = JSON.parse(sessionStorage.getItem(HUD_POS_KEY) || "null");
      if (!mobile && saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        placeHud(saved.left, saved.top);
        return;
      }
    } catch (_) { /* ignore */ }
    if (mobile) placeHud(window.innerWidth - 76, window.innerHeight - 96);
    else placeHud(window.innerWidth - 76, 18);
  }

  function setHudOpen(open) {
    hud.classList.toggle("is-open", open);
    hudHub.setAttribute("aria-expanded", String(open));
    if (open) layoutPetals();
  }

  let hudDrag = null;

  hudHub.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = hud.getBoundingClientRect();
    hudDrag = {
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: rect.left,
      origY: rect.top,
      moved: false,
    };
    hudHub.setPointerCapture(event.pointerId);
  });

  hudHub.addEventListener("pointermove", (event) => {
    if (!hudDrag || event.pointerId !== hudDrag.pointer) return;
    const dx = event.clientX - hudDrag.startX;
    const dy = event.clientY - hudDrag.startY;
    if (!hudDrag.moved && (dx * dx + dy * dy) < 36) return;
    hudDrag.moved = true;
    setHudOpen(false);
    placeHud(hudDrag.origX + dx, hudDrag.origY + dy);
  });

  function endHudDrag(event) {
    if (!hudDrag || event.pointerId !== hudDrag.pointer) return;
    const wasMove = hudDrag.moved;
    hudDrag = null;
    if (!wasMove) setHudOpen(!hud.classList.contains("is-open"));
  }

  hudHub.addEventListener("pointerup", endHudDrag);
  hudHub.addEventListener("pointercancel", endHudDrag);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setHudOpen(false);
  });

  function setMinimized(on) {
    minimized = Boolean(on && client);
    document.body.classList.toggle("session-min", minimized);
    hud.classList.toggle("is-min", minimized);
    desktopEl.classList.toggle("is-min", minimized);
    if (minimized) {
      if (!isSessionTab) loginEl.classList.remove("hidden");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      desktopEl.classList.remove("is-fill");
    } else if (client) {
      loginEl.classList.add("hidden");
      desktopEl.classList.remove("hidden");
      scheduleRefit();
    }
    minBtn.textContent = minimized ? "Show" : "Min";
    minBtn.title = minimized ? "Show desktop" : "Hide desktop, keep session";
  }

  minBtn.addEventListener("click", () => {
    setMinimized(!minimized);
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) desktopEl.classList.remove("is-fill");
    syncFullscreenButton();
    scheduleRefit();
  });
  document.addEventListener("webkitfullscreenchange", () => {
    syncFullscreenButton();
    scheduleRefit();
  });
  window.addEventListener("resize", () => {
    const rect = hud.getBoundingClientRect();
    placeHud(rect.left, rect.top);
  });

  ["fit-btn", "cad-btn", "fs-btn", "min-btn", "disconnect-btn"].forEach((id) => {
    document.getElementById(id).addEventListener("click", () => {
      if (id !== "fit-btn") setHudOpen(false);
    });
  });

  restoreHud();
  window.addEventListener("beforeunload", (event) => {
    if (!client) return;
    event.preventDefault();
    event.returnValue = "";
  });

  if (togglePass) {
    togglePass.addEventListener("click", () => {
      const hidden = passwordEl.type === "password";
      passwordEl.type = hidden ? "text" : "password";
      togglePass.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
      togglePass.title = hidden ? "Hide password" : "Show password";
    });
  }

  const gateTogglePass = document.getElementById("gate-toggle-pass");
  const gatePassEl = document.getElementById("gate-pass");
  if (gateTogglePass && gatePassEl) {
    gateTogglePass.addEventListener("click", () => {
      const hidden = gatePassEl.type === "password";
      gatePassEl.type = hidden ? "text" : "password";
      gateTogglePass.setAttribute("aria-label", hidden ? "Hide password" : "Show password");
      gateTogglePass.title = hidden ? "Hide password" : "Show password";
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function osIcon(desktop) {
    if (desktop?.logo) {
      return `<img class="pc-icon" src="${escapeHtml(desktop.logo)}" alt="">`;
    }
    const letter = String(desktop?.osLabel || desktop?.os || "?").slice(0, 1).toUpperCase();
    return `<span class="pc-fallback">${escapeHtml(letter)}</span>`;
  }

  function filteredDesktops() {
    const q = desktopQuery.trim().toLowerCase();
    return allDesktops.filter((d) => {
      if (desktopFilter === "linux" && d.family === "windows") return false;
      if (desktopFilter === "windows" && d.family !== "windows") return false;
      if (desktopFilter === "rdp" && d.protocol === "ssh") return false;
      if (desktopFilter === "ssh" && d.protocol !== "ssh") return false;
      if (["available", "in-use", "unavailable"].includes(desktopFilter) && d.state !== desktopFilter) return false;
      if (q && !`${d.name} ${d.os} ${d.osLabel || ""} ${d.protocol || ""} ${d.label || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function selectDesktop(desktop) {
    selectedDesktop = desktop;
    desktopIdEl.value = desktop?.id || "";
    sessionTitle.textContent = desktop?.name || "Cloud Desktop";
    hudHub?.setAttribute("title", desktop?.name || "Session controls");
    if (connectNameEl) connectNameEl.textContent = desktop?.name || "a desktop";
    const kicker = document.getElementById("connect-kicker");
    if (kicker) kicker.textContent = desktop?.protocol === "ssh" ? "SSH session" : "RDP session";
    if (isSessionTab && desktop?.name) document.title = `${desktop.name} · Cloud Desktop`;
    if (!desktopListEl) return;
    for (const button of desktopListEl.querySelectorAll(".desktop-item")) {
      button.classList.toggle("is-selected", button.dataset.id === desktop?.id);
    }
  }

  function launchSessionTab(desktop) {
    const url = `/session?id=${encodeURIComponent(desktop.id)}`;
    const win = window.open(url, `cd-session-${desktop.id}`);
    if (!win) location.assign(url);
  }

  function openConnect(desktop) {
    if (client) {
      setMinimized(false);
      return;
    }
    selectDesktop(desktop);
    if (!connectModal.classList.contains("hidden")) return;
    setError("");
    passwordEl.value = "";
    connectModal.classList.remove("hidden");
    window.setTimeout(() => usernameEl.focus(), 30);
  }

  function closeConnect() {
    connectModal.classList.add("hidden");
  }

  const sessionNotice = document.getElementById("session-notice");
  const sessionNoticeTitle = document.getElementById("session-notice-title");
  const sessionNoticeBody = document.getElementById("session-notice-body");

  function closeSessionWindow() {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) location.replace("/");
    }, 120);
  }

  function closeSessionNotice() {
    sessionNotice?.classList.add("hidden");
    if (isSessionTab) closeSessionWindow();
  }

  function showSessionNotice(taken) {
    if (!sessionNotice) return;
    sessionNoticeTitle.textContent = taken ? "Session terminated" : "Session disconnected";
    sessionNoticeBody.textContent = taken
      ? "Someone else connected to this PC. This session has been terminated."
      : "This session has been disconnected.";
    sessionNotice.classList.remove("hidden");
  }

  function isSessionTaken(status) {
    const code = Number(status?.code);
    if (code === 517 || code === 521 || code === 523 || code === 525) return true;
    return /conflict|replaced|another (user|session|connection)|taken over|logged in from/i.test(String(status?.message || ""));
  }

  function finishSession({ notice = false, taken = false } = {}) {
    leaveHandled = true;
    sessionLive = false;
    cleanup();
    document.body.classList.remove("in-session", "is-ssh");
    desktopEl.classList.add("hidden");
    if (veilEl) veilEl.hidden = true;
    setState("Disconnected", "bad");
    document.getElementById("hud")?.classList.remove("is-open");
    setMinimized(false);
    desktopEl.classList.remove("is-fill");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    closeConnect();
    if (isSessionTab) {
      loginEl.classList.add("hidden");
      if (notice) showSessionNotice(taken);
      else closeSessionWindow();
      return;
    }
    loginEl.classList.remove("hidden");
    showLogin();
    if (notice) showSessionNotice(taken);
  }

  function sessionHadStarted() {
    if (sessionLive || sawContent) return true;
    return connectStartedAt > 0 && (Date.now() - connectStartedAt) > 2500;
  }

  function handleRemoteDisconnect(status) {
    if (leaveHandled) return;
    const ended = sessionHadStarted();
    const taken = isSessionTaken(status);
    if (!ended) {
      const message = status?.message || (document.body.classList.contains("is-ssh")
        ? "SSH connection failed."
        : "Remote desktop connection failed.");
      cleanup();
      document.body.classList.remove("in-session", "is-ssh");
      desktopEl.classList.add("hidden");
      loginEl.classList.remove("hidden");
      if (veilEl) veilEl.hidden = true;
      setState("Disconnected", "bad");
      setError(message);
      if (selectedDesktop) openConnect(selectedDesktop);
      return;
    }
    finishSession({ notice: true, taken });
  }

  function enterSessionDesktop() {
    if (!isSessionTab || !loggedIn || client) return;
    if (sessionNotice && !sessionNotice.classList.contains("hidden")) return;
    if (leaveHandled) return;
    const desktop = allDesktops.find((d) => d.id === sessionId);
    if (!desktop) {
      if (!allDesktops.length) return;
      sessionNoticeTitle.textContent = "Session terminated";
      sessionNoticeBody.textContent = "That desktop is not available for this account.";
      loginEl.classList.add("hidden");
      sessionNotice.classList.remove("hidden");
      return;
    }
    openConnect(desktop);
  }

  function renderDesktopCard(d) {
    return `
      <button type="button" class="desktop-item" data-id="${escapeHtml(d.id)}" data-state="${escapeHtml(d.state)}" title="${escapeHtml(d.label || "")}${d.reason ? " · " + escapeHtml(d.reason) : ""}">
        <i class="bubble" aria-hidden="true"></i>
        ${osIcon(d)}
        <strong>${escapeHtml(d.name)}</strong>
        <small>${escapeHtml(d.osLabel || d.os || "")} · ${d.protocol === "ssh" ? "SSH" : "RDP"}</small>
      </button>
    `;
  }

  function renderGroup(title, items) {
    if (!items.length) return "";
    const visible = showAllDesktops ? items : items.slice(0, PAGE_SIZE);
    return `
      <section class="desktop-group">
        <h2>${escapeHtml(title)}</h2>
        <div class="desktop-grid">${visible.map(renderDesktopCard).join("")}</div>
      </section>
    `;
  }

  function renderDesktops() {
    if (isSessionTab) {
      enterSessionDesktop();
      return;
    }
    if (!desktopListEl) return;
    const desktops = filteredDesktops();
    if (!desktops.length) {
      desktopListEl.innerHTML = loggedIn
        ? '<p class="empty-list">No desktops are assigned to this account. Ask an administrator.</p>'
        : '<p class="empty-list">Sign in to see your desktops.</p>';
      showMoreBtn?.classList.add("hidden");
      if (!connectModal.classList.contains("hidden")) closeConnect();
      selectDesktop(null);
      return;
    }
    const rdp = desktops.filter((d) => d.protocol !== "ssh");
    const ssh = desktops.filter((d) => d.protocol === "ssh");
    const extra = rdp.length > PAGE_SIZE || ssh.length > PAGE_SIZE;
    showMoreBtn.classList.toggle("hidden", !extra || showAllDesktops);
    desktopListEl.innerHTML = renderGroup("RDP sessions", rdp) + renderGroup("SSH sessions", ssh);
    for (const button of desktopListEl.querySelectorAll(".desktop-item")) {
      button.addEventListener("click", () => {
        const desktop = allDesktops.find((d) => d.id === button.dataset.id);
        if (desktop) launchSessionTab(desktop);
      });
    }
    const keep = desktops.find((d) => d.id === selectedDesktop?.id);
    if (keep) selectDesktop(keep);
    else if (!connectModal.classList.contains("hidden")) closeConnect();
  }

  function showSignedOut() {
    loggedIn = false;
    allDesktops = [];
    loginEl.classList.remove("is-authed");
    document.body.classList.remove("chrome-on");
    document.getElementById("app-chrome")?.classList.add("hidden");
    gateAuth.classList.remove("hidden");
    pickerWrap.classList.add("hidden");
    gateUserbar.classList.add("hidden");
    document.getElementById("console-switch")?.classList.add("hidden");
    closeConnect();
    closeSessionNotice();
    renderDesktops();
  }

  function showSignedIn(user) {
    loggedIn = true;
    loginEl.classList.add("is-authed");
    document.body.classList.add("chrome-on");
    document.getElementById("app-chrome")?.classList.remove("hidden");
    gateAuth.classList.add("hidden");
    pickerWrap.classList.toggle("hidden", isSessionTab);
    gateUserbar.classList.remove("hidden");
    document.getElementById("console-switch")?.classList.toggle("hidden", !user?.admin);
    const name = user?.displayName || user?.username || "Signed in";
    gateWho.textContent = name;
    const avatar = document.getElementById("gate-avatar");
    if (avatar) avatar.textContent = name.slice(0, 1).toUpperCase();
  }

  function refreshDesktops() {
    if (!loggedIn) return;
    fetch("/api/desktops", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401) {
          showSignedOut();
          return;
        }
        const payload = await res.json().catch(() => ({}));
        allDesktops = payload.desktops || [];
        renderDesktops();
      })
      .catch(() => {});
  }

  searchEl?.addEventListener("input", () => {
    desktopQuery = searchEl.value;
    showAllDesktops = false;
    renderDesktops();
  });

  showMoreBtn?.addEventListener("click", () => {
    showAllDesktops = true;
    renderDesktops();
  });

  filterBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = filterMenu.classList.contains("hidden");
    filterMenu.classList.toggle("hidden", !open);
    filterBtn.setAttribute("aria-expanded", String(open));
  });

  filterMenu?.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      desktopFilter = button.dataset.filter || "all";
      showAllDesktops = false;
      filterMenu.querySelectorAll("button").forEach((item) => {
        item.classList.toggle("is-on", item === button);
      });
      filterMenu.classList.add("hidden");
      filterBtn.setAttribute("aria-expanded", "false");
      renderDesktops();
    });
  });

  filterMenu?.addEventListener("click", (event) => event.stopPropagation());

  document.addEventListener("click", () => {
    if (!filterMenu || filterMenu.classList.contains("hidden")) return;
    filterMenu.classList.add("hidden");
    filterBtn.setAttribute("aria-expanded", "false");
  });

  document.getElementById("modal-close")?.addEventListener("click", () => {
    if (isSessionTab) {
      closeSessionWindow();
      return;
    }
    closeConnect();
  });
  document.getElementById("modal-dismiss")?.addEventListener("click", () => {
    if (isSessionTab) {
      closeSessionWindow();
      return;
    }
    closeConnect();
  });
  document.getElementById("session-notice-ok")?.addEventListener("click", closeSessionNotice);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (sessionNotice && !sessionNotice.classList.contains("hidden")) {
      closeSessionNotice();
      return;
    }
    if (isSessionTab) return;
    if (!connectModal.classList.contains("hidden")) closeConnect();
  });

  function applyHero(hero) {
    const img = document.getElementById("hero-image");
    if (!img) return;
    if (hero?.logo) {
      img.src = hero.logo;
      img.classList.add("is-on");
    } else {
      img.removeAttribute("src");
      img.classList.remove("is-on");
    }
  }

  fetch("/api/os")
    .then((res) => res.json())
    .then((payload) => applyHero(payload.hero))
    .catch(() => {});

  fetch("/api/config")
    .then((res) => res.json())
    .then((config) => {
      if (!isSessionTab) document.title = "Cloud Desktop";
      if (config.defaultUsername) usernameEl.value = config.defaultUsername;
      if (config.gateRequired) {
        gateRow.classList.remove("hidden");
        gateEl.required = true;
      }
    })
    .catch(() => { /* login still works */ });

  function setGateError(message) {
    gateAuthError.hidden = !message;
    gateAuthError.textContent = message || "";
  }

  gateAuth.addEventListener("submit", async (event) => {
    event.preventDefault();
    setGateError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: document.getElementById("gate-user").value.trim(),
          password: document.getElementById("gate-pass").value,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not sign in.");
      document.getElementById("gate-pass").value = "";
      showSignedIn(payload.user);
      refreshDesktops();
    } catch (err) {
      setGateError(err.message);
    }
  });

  document.getElementById("gate-logout")?.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    showSignedOut();
  });

  fetch("/api/me", { credentials: "same-origin" })
    .then(async (res) => {
      if (!res.ok) {
        showSignedOut();
        return;
      }
      const payload = await res.json().catch(() => ({}));
      showSignedIn(payload.user);
      refreshDesktops();
    })
    .catch(() => showSignedOut());

  setInterval(refreshDesktops, 5000);
})();
