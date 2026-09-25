const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "sessions.json");
const MAX = Number(process.env.SESSION_HISTORY_MAX || 500);

let sessions = [];

function sanitize(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  if (!id) return null;
  return {
    id,
    key: String(entry.key || ""),
    username: String(entry.username || ""),
    appUser: String(entry.appUser || ""),
    appDisplayName: String(entry.appDisplayName || ""),
    clientIp: String(entry.clientIp || ""),
    host: String(entry.host || ""),
    port: Number(entry.port || 3389) || 3389,
    desktopId: String(entry.desktopId || ""),
    desktopName: String(entry.desktopName || ""),
    os: String(entry.os || ""),
    osLabel: String(entry.osLabel || ""),
    logo: String(entry.logo || ""),
    protocol: String(entry.protocol || "rdp"),
    state: entry.state === "active" ? "active" : (entry.state === "failed" ? "failed" : "disconnected"),
    startedAt: Number(entry.startedAt) || null,
    endedAt: Number(entry.endedAt) || null,
  };
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ sessions }, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error("[history] save failed", err?.message || err);
  }
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const list = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    const now = Date.now();
    sessions = list.map(sanitize).filter(Boolean).map((entry) => {
      if (entry.state !== "active") return entry;
      return { ...entry, state: "disconnected", endedAt: entry.endedAt || entry.startedAt || now };
    });
    if (sessions.length > MAX) sessions.length = MAX;
    persist();
  } catch {
    sessions = [];
  }
  return sessions;
}

function list() {
  return sessions;
}

function upsert(entry) {
  const rec = sanitize(entry);
  if (!rec) return;
  const idx = sessions.findIndex((item) => item.id === rec.id);
  if (idx === -1) sessions.unshift(rec);
  else sessions[idx] = rec;
  if (sessions.length > MAX) sessions.length = MAX;
  persist();
}

function lastSeenMap() {
  const map = new Map();
  for (const entry of sessions) {
    if (!entry.desktopId) continue;
    const ts = entry.endedAt || entry.startedAt;
    if (!ts) continue;
    const prev = map.get(entry.desktopId) || 0;
    if (ts > prev) map.set(entry.desktopId, ts);
  }
  return map;
}

module.exports = {
  load,
  list,
  upsert,
  lastSeenMap,
};
