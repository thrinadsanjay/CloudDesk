const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const GuacamoleLite = require("guacamole-lite");
const { encryptToken } = require("./encrypt");
const { endpointKey, statusForDesktop } = require("./status");
const store = require("./store");
const osStore = require("./os");
const users = require("./users");
const history = require("./history");

const WEB_PORT = Number(process.env.WEB_PORT || 9080);
const TLS_PORT = Number(process.env.TLS_PORT || 9443);
const GUACD_HOST = process.env.GUACD_HOST || "127.0.0.1";
const GUACD_PORT = Number(process.env.GUACD_PORT || 4822);
const GATE_PASSWORD = process.env.GATE_PASSWORD || "";
const RDP_USERNAME = process.env.RDP_USERNAME || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TLS_CERT = process.env.TLS_CERT || "/certs/cert.pem";
const TLS_KEY = process.env.TLS_KEY || "/certs/key.pem";
const TOKEN_TTL_MS = 2 * 60 * 1000;
const USER_TTL_MS = 8 * 60 * 60 * 1000;

function requireTokenKey() {
  const key = process.env.TOKEN_KEY || "";
  if (key.length !== 32) {
    throw new Error("TOKEN_KEY must be exactly 32 characters (AES-256-CBC)");
  }
  return key;
}

const TOKEN_KEY = requireTokenKey();
users.ensureBuiltinAdmin(ADMIN_USER, ADMIN_PASSWORD);
const webSessions = new Map();
const userSessions = new Map();
history.load();
const lastSeen = history.lastSeenMap();
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err?.message || err);
});
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err?.message || err);
});

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) out[key] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function cookieFlags(req) {
  const secure = Boolean(req.secure || req.headers["x-forwarded-proto"] === "https");
  return `HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}`;
}

function setSessionCookie(res, req, name, token, maxAgeSec) {
  res.setHeader("Set-Cookie", `${name}=${token}; ${cookieFlags(req)}; Max-Age=${maxAgeSec}`);
}

function clearSessionCookie(res, req, name) {
  res.setHeader("Set-Cookie", `${name}=; ${cookieFlags(req)}; Max-Age=0`);
}

function requireUser(req, res, next) {
  const token = parseCookies(req).cd_user;
  const session = token && userSessions.get(token);
  if (!session || session.expires < Date.now()) {
    if (token) userSessions.delete(token);
    return res.status(401).json({ error: "Sign in to the gateway first." });
  }
  const user = users.get(session.userId);
  if (!user || user.enabled === false) {
    userSessions.delete(token);
    return res.status(401).json({ error: "Sign in to the gateway first." });
  }
  req.gatewayUser = user;
  next();
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!users.isAdmin(req.gatewayUser)) {
      return res.status(403).json({ error: "Administrator access required." });
    }
    next();
  });
}

function allowedDesktops(user) {
  const list = store.listDesktops().filter((d) => d.enabled !== false);
  if (users.isAdmin(user)) return list;
  const allowed = new Set(user?.desktopIds || []);
  return list.filter((d) => allowed.has(d.id));
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || "";
  return ip.replace(/^::ffff:/, "") || "";
}

function connectionFrom(connection) {
  const root = connection?.connectionSettings || {};
  const stamped = root.cdMeta || {};
  const conn = root.connection || {};
  const nested = conn.settings && typeof conn.settings === "object" && !Array.isArray(conn.settings)
    ? conn.settings
    : {};
  const protocol = store.normalizeProtocol(
    stamped.protocol || conn.type || nested.type || "rdp",
    { fallback: true }
  );
  return {
    host: String(stamped.hostname || nested.hostname || conn.hostname || root.hostname || ""),
    port: Number(stamped.port || nested.port || conn.port || root.port || store.defaultPortFor(protocol)),
    username: String(stamped.username || nested.username || conn.username || root.username || "").trim() || "unknown",
    desktopId: String(stamped.desktopId || root.desktopId || nested.desktopId || conn.desktopId || ""),
    appUser: String(stamped.appUser || root.appUser || ""),
    appDisplayName: String(stamped.appDisplayName || root.appDisplayName || ""),
    clientIp: String(stamped.clientIp || root.clientIp || ""),
    protocol,
  };
}

function rdpFromConnection(connection) {
  return connectionFrom(connection);
}

function activeCount(desktop) {
  const key = endpointKey(desktop.host, desktop.port);
  let n = 0;
  for (const value of webSessions.values()) {
    if (value.desktopId && value.desktopId === desktop.id) n += 1;
    else if (!value.desktopId && value.key && value.key === key) n += 1;
  }
  return n;
}

function findDesktopByEndpoint(host, port) {
  return store.listDesktops().find((d) => (
    d.host === host && Number(d.port || 3389) === Number(port || 3389)
  )) || null;
}

function publicSession(entry) {
  if (!entry) return null;
  const startedAt = entry.startedAt || null;
  const endedAt = entry.endedAt || null;
  const durationMs = startedAt
    ? Math.max(0, (endedAt || Date.now()) - startedAt)
    : 0;
  return {
    id: entry.id,
    username: entry.username,
    appUser: entry.appUser || "",
    appDisplayName: entry.appDisplayName || "",
    clientIp: entry.clientIp || "",
    host: entry.host,
    port: entry.port,
    desktopId: entry.desktopId,
    desktopName: entry.desktopName,
    os: entry.os,
    osLabel: entry.osLabel,
    logo: entry.logo,
    protocol: entry.protocol || "rdp",
    state: entry.state,
    startedAt,
    endedAt,
    durationMs,
  };
}

function upsertHistory(entry) {
  history.upsert(entry);
}

function sessionFromConnection(connection, extra = {}) {
  const rdp = connectionFrom(connection);
  const host = rdp.host;
  const port = rdp.port;
  const desktop = (rdp.desktopId && store.getDesktop(rdp.desktopId)) || findDesktopByEndpoint(host, port);
  const os = desktop ? osStore.get(desktop.os) : null;
  const protocol = store.normalizeProtocol(desktop?.protocol || rdp.protocol, { fallback: true });
  return {
    id: connection?.connectionId || crypto.randomUUID(),
    key: desktop ? endpointKey(desktop.host, desktop.port) : (host ? endpointKey(host, port) : ""),
    username: rdp.username,
    appUser: rdp.appUser || extra.appUser || "",
    appDisplayName: rdp.appDisplayName || extra.appDisplayName || "",
    clientIp: rdp.clientIp || extra.clientIp || "",
    host: desktop?.host || host,
    port: desktop ? Number(desktop.port || store.defaultPortFor(desktop.protocol)) : port,
    desktopId: desktop?.id || rdp.desktopId || "",
    desktopName: desktop?.name || host || "Unknown",
    os: desktop?.os || "",
    osLabel: os?.label || desktop?.os || "",
    logo: os?.logo || "",
    protocol,
    startedAt: Date.now(),
    endedAt: null,
    state: "active",
    ...extra,
  };
}

async function decorateDesktop(desktop) {
  const presence = await statusForDesktop(desktop, activeCount(desktop));
  const os = osStore.get(desktop.os) || osStore.decorate({
    id: desktop.os || "debian",
    label: desktop.os || "Linux",
    family: desktop.os === "windows" ? "windows" : "linux",
    file: `${desktop.os || "debian"}.png`,
  });
  return {
    id: desktop.id,
    name: desktop.name,
    os: os.id,
    osLabel: os.label,
    family: os.family,
    logo: os.logo,
    protocol: store.normalizeProtocol(desktop.protocol, { fallback: true }),
    host: desktop.host,
    port: Number(desktop.port || store.defaultPortFor(desktop.protocol)),
    enabled: desktop.enabled !== false,
    lastSeen: lastSeen.get(desktop.id) || null,
    ...presence,
  };
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use((req, res, next) => {
  const limit = req.originalUrl.split("?")[0] === "/api/admin/logos" ? "3mb" : "32kb";
  express.json({ limit })(req, res, next);
});
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));
fs.mkdirSync(osStore.LOGOS_DIR, { recursive: true });
app.use("/logos", express.static(osStore.LOGOS_DIR, { index: false }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

app.get("/api/config", (_req, res) => {
  res.json({
    authRequired: true,
    gateRequired: Boolean(GATE_PASSWORD),
    defaultUsername: RDP_USERNAME,
    adminEnabled: users.list().some((user) => user.admin),
  });
});

function issueUserSession(res, req, user) {
  const token = crypto.randomBytes(24).toString("hex");
  userSessions.set(token, { userId: user.id, expires: Date.now() + USER_TTL_MS });
  setSessionCookie(res, req, "cd_user", token, Math.floor(USER_TTL_MS / 1000));
}

function clearUserSession(req, res) {
  const token = parseCookies(req).cd_user;
  if (token) userSessions.delete(token);
  clearSessionCookie(res, req, "cd_user");
}

app.post("/api/login", loginLimiter, (req, res) => {
  const user = users.authenticate(req.body?.username, req.body?.password);
  if (!user) {
    return res.status(401).json({ error: "Invalid gateway credentials." });
  }
  issueUserSession(res, req, user);
  res.json({ ok: true, user });
});

app.post("/api/logout", (req, res) => {
  clearUserSession(req, res);
  res.json({ ok: true });
});

app.get("/api/me", requireUser, (req, res) => {
  res.json({ user: req.gatewayUser });
});

app.get("/api/desktops", requireUser, async (req, res) => {
  const full = allowedDesktops(req.gatewayUser);
  const decorated = await Promise.all(full.map((d) => decorateDesktop(d)));
  res.json({
    desktops: decorated.map((d) => ({
      id: d.id,
      name: d.name,
      os: d.os,
      osLabel: d.osLabel,
      family: d.family,
      logo: d.logo,
      protocol: d.protocol || "rdp",
      state: d.state,
      label: d.label,
      reason: d.reason,
    })),
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, desktops: store.listDesktops().length });
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const user = users.authenticate(req.body?.username, req.body?.password);
  if (!user) {
    return res.status(401).json({ error: "Invalid gateway credentials." });
  }
  if (!users.isAdmin(user)) {
    return res.status(403).json({ error: "Administrator access required." });
  }
  issueUserSession(res, req, user);
  res.json({ ok: true, user });
});

app.post("/api/admin/logout", (req, res) => {
  clearUserSession(req, res);
  res.json({ ok: true });
});

app.get("/api/admin/session", requireAdmin, (req, res) => {
  res.json({ ok: true, user: req.gatewayUser });
});

app.get("/api/os", (_req, res) => {
  res.json({ os: osStore.list(), hero: osStore.getHero() });
});

app.get("/api/admin/os", requireAdmin, (_req, res) => {
  res.json({
    os: osStore.list(),
    files: osStore.listLogoFiles(),
    heroFiles: osStore.listHeroImages(),
    hero: osStore.getHero(),
  });
});

app.put("/api/admin/hero", requireAdmin, (req, res) => {
  try {
    res.json({ hero: osStore.setHero(req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not save login graphic." });
  }
});

app.post("/api/admin/os", requireAdmin, (req, res) => {
  try {
    res.status(201).json({ os: osStore.add(req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not add OS mapping." });
  }
});

app.put("/api/admin/os/:id", requireAdmin, (req, res) => {
  try {
    const item = osStore.update(req.params.id, req.body);
    if (!item) return res.status(404).json({ error: "OS mapping not found." });
    res.json({ os: item });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not update OS mapping." });
  }
});

app.delete("/api/admin/os/:id", requireAdmin, (req, res) => {
  if (!osStore.remove(req.params.id)) {
    return res.status(404).json({ error: "OS mapping not found." });
  }
  res.json({ ok: true });
});

app.post("/api/admin/logos", requireAdmin, (req, res) => {
  try {
    const file = osStore.saveUploadedLogo(req.body || {});
    res.status(201).json({
      file,
      files: osStore.listLogoFiles(),
      heroFiles: osStore.listHeroImages(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not save logo." });
  }
});

app.get("/api/admin/desktops", requireAdmin, async (_req, res) => {
  const decorated = await Promise.all(store.listDesktops().map((d) => decorateDesktop(d)));
  res.json({ desktops: decorated });
});

app.get("/api/admin/sessions", requireAdmin, (_req, res) => {
  const cutoff = Date.now() - SESSION_WINDOW_MS;
  const byId = new Map();
  for (const entry of history.list()) {
    const ts = entry.endedAt || entry.startedAt || 0;
    if (entry.state === "active" || ts >= cutoff) byId.set(entry.id, entry);
  }
  for (const entry of webSessions.values()) {
    byId.set(entry.id, entry);
  }
  const sessions = [...byId.values()]
    .sort((a, b) => {
      const aLive = a.state === "active" ? 0 : 1;
      const bLive = b.state === "active" ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return (b.startedAt || 0) - (a.startedAt || 0);
    })
    .map(publicSession);
  res.json({
    sessions,
    active: sessions.filter((item) => item.state === "active"),
    recent: sessions,
  });
});

function requireMappedOs(osId) {
  const os = osStore.get(osId);
  if (!os) {
    throw new Error("Unknown OS. Add it under Branding first.");
  }
  return os;
}

app.post("/api/admin/desktops", requireAdmin, (req, res) => {
  try {
    requireMappedOs(req.body?.os);
    res.status(201).json({ desktop: store.addDesktop(req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not add desktop." });
  }
});

app.put("/api/admin/desktops/:id", requireAdmin, (req, res) => {
  try {
    requireMappedOs(req.body?.os);
    const desktop = store.updateDesktop(req.params.id, req.body);
    if (!desktop) return res.status(404).json({ error: "Desktop not found." });
    res.json({ desktop });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not update desktop." });
  }
});

app.delete("/api/admin/desktops/:id", requireAdmin, (req, res) => {
  if (!store.removeDesktop(req.params.id)) {
    return res.status(404).json({ error: "Desktop not found." });
  }
  users.unassignDesktop(req.params.id);
  res.json({ ok: true });
});

function existingDesktopIds(ids) {
  const known = new Set(store.listDesktops().map((d) => d.id));
  return (Array.isArray(ids) ? ids : []).filter((id) => known.has(String(id)));
}

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  res.json({ users: users.list() });
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  try {
    const user = users.add({
      ...req.body,
      desktopIds: existingDesktopIds(req.body?.desktopIds),
    });
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not add user." });
  }
});

app.put("/api/admin/users/:id", requireAdmin, (req, res) => {
  try {
    const user = users.update(req.params.id, {
      ...req.body,
      desktopIds: req.body?.desktopIds != null ? existingDesktopIds(req.body.desktopIds) : undefined,
    });
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.enabled === false) {
      for (const [token, session] of userSessions) {
        if (session.userId === user.id) userSessions.delete(token);
      }
    }
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not update user." });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  try {
    if (!users.remove(req.params.id)) {
      return res.status(404).json({ error: "User not found." });
    }
    for (const [token, session] of userSessions) {
      if (session.userId === req.params.id) userSessions.delete(token);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not delete user." });
  }
});

function guacamoleConnection(desktop, username, password) {
  const protocol = store.normalizeProtocol(desktop.protocol, { fallback: true });
  const port = String(desktop.port || store.defaultPortFor(protocol));
  if (protocol === "ssh") {
    return {
      type: "ssh",
      settings: {
        hostname: desktop.host,
        port,
        username,
        password,
        "font-size": "14",
        "color-scheme": "gray-black",
        "server-alive-interval": "30",
      },
    };
  }
  const windows = osStore.familyFor(desktop.os) === "windows";
  return {
    type: "rdp",
    settings: {
      hostname: desktop.host,
      port,
      username,
      password,
      security: windows ? "nla" : "any",
      "ignore-cert": true,
      "enable-wallpaper": true,
      "enable-theming": true,
      "enable-font-smoothing": true,
      "enable-full-window-drag": false,
      "enable-desktop-composition": true,
      "enable-menu-animations": false,
      "resize-method": "display-update",
      "color-depth": 24,
      "disable-audio": false,
      "normalize-clipboard": "preserve",
    },
  };
}

app.post("/api/session", loginLimiter, requireUser, (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const gatePassword = String(req.body?.gatePassword || "");
  const desktopId = String(req.body?.desktopId || "").trim();

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  if (GATE_PASSWORD && gatePassword !== GATE_PASSWORD) {
    return res.status(401).json({ error: "Gateway password is incorrect." });
  }

  const desktop = store.getDesktop(desktopId);
  if (!desktop || desktop.enabled === false) {
    return res.status(404).json({ error: "Choose a desktop from the list." });
  }
  if (!users.canAccess(req.gatewayUser, desktop.id)) {
    return res.status(403).json({ error: "That desktop is not assigned to you." });
  }

  const protocol = store.normalizeProtocol(desktop.protocol, { fallback: true });
  const token = encryptToken(
    {
      expiration: Date.now() + TOKEN_TTL_MS,
      desktopId: desktop.id,
      appUser: req.gatewayUser.username,
      appDisplayName: req.gatewayUser.displayName || req.gatewayUser.username,
      clientIp: clientIp(req),
      connection: guacamoleConnection(desktop, username, password),
    },
    TOKEN_KEY
  );

  res.json({ token, ttlMs: TOKEN_TTL_MS, desktopName: desktop.name, protocol });
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/guac")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

function attachGuacamole(server) {
  const guacServer = new GuacamoleLite(
    { server, path: "/guac" },
    { host: GUACD_HOST, port: GUACD_PORT },
    {
      crypt: {
        cypher: "AES-256-CBC",
        key: TOKEN_KEY,
      },
      log: {
        level: process.env.LOG_LEVEL || "NORMAL",
      },
      connectionDefaultSettings: {
        rdp: {
          audio: ["audio/L16"],
          image: ["image/png", "image/jpeg"],
        },
        ssh: {
          "font-size": "14",
          "color-scheme": "gray-black",
        },
      },
      allowedUnencryptedConnectionSettings: {
        rdp: ["width", "height", "dpi", "audio", "image", "timezone"],
        ssh: ["width", "height", "dpi", "timezone"],
      },
    },
    {
      processConnectionSettings: (settings, callback) => {
        const conn = settings?.connection || {};
        const nested = conn.settings && typeof conn.settings === "object" && !Array.isArray(conn.settings)
          ? conn.settings
          : {};
        const hostname = conn.hostname || nested.hostname;
        const username = conn.username || nested.username;
        const protocol = store.normalizeProtocol(conn.type || nested.type || "rdp", { fallback: true });
        const port = Number(conn.port || nested.port || store.defaultPortFor(protocol));
        if (settings.expiration && Number(settings.expiration) < Date.now()) {
          return callback(new Error("Session token expired. Sign in again."));
        }
        if (!username || !hostname) {
          return callback(new Error("Missing connection details"));
        }
        settings.cdMeta = {
          hostname,
          port,
          username,
          protocol,
          desktopId: String(settings.desktopId || conn.desktopId || nested.desktopId || ""),
          appUser: String(settings.appUser || ""),
          appDisplayName: String(settings.appDisplayName || ""),
          clientIp: String(settings.clientIp || ""),
        };
        callback(null, settings);
      },
    }
  );

  guacServer.on("open", (connection) => {
    const rec = sessionFromConnection(connection);
    if (connection?.connectionId) webSessions.set(connection.connectionId, rec);
    if (rec.desktopId) lastSeen.set(rec.desktopId, rec.startedAt);
    upsertHistory(rec);
    console.log(`[session] open user=${rec.username} host=${rec.host} desktop=${rec.desktopName} id=${rec.id}`);
  });
  guacServer.on("close", (connection, error) => {
    const id = connection?.connectionId;
    const rec = (id && webSessions.get(id)) || sessionFromConnection(connection);
    rec.state = error?.message ? "failed" : "disconnected";
    rec.endedAt = Date.now();
    if (rec.desktopId) lastSeen.set(rec.desktopId, rec.endedAt);
    upsertHistory(rec);
    if (id) webSessions.delete(id);
    console.log(`[session] close user=${rec.username} id=${id} reason=${error?.message || "normal"}`);
  });
  guacServer.on("error", (connection, error) => {
    console.error("[session] error", connection?.connectionId, error?.message || error);
  });
  return guacServer;
}

const httpServer = http.createServer(app);
attachGuacamole(httpServer);
httpServer.listen(WEB_PORT, "0.0.0.0", () => {
  console.log(`Cloud Desktop listening on http://0.0.0.0:${WEB_PORT}`);
});

if (fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)) {
  const httpsServer = https.createServer(
    {
      cert: fs.readFileSync(TLS_CERT),
      key: fs.readFileSync(TLS_KEY),
    },
    app
  );
  attachGuacamole(httpsServer);
  httpsServer.listen(TLS_PORT, "0.0.0.0", () => {
    console.log(`Cloud Desktop TLS listening on https://0.0.0.0:${TLS_PORT}`);
  });
}
