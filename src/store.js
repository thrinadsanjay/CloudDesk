const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "desktops.json");

function seed() {
  return {
    desktops: [
      {
        id: crypto.randomUUID(),
        name: process.env.DESKTOP_NAME || "Debian Desktop",
        host: process.env.RDP_HOST || "host.docker.internal",
        port: Number(process.env.RDP_PORT || 3389),
        protocol: "rdp",
        os: "debian",
        enabled: true,
      },
    ],
  };
}

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.desktops)) throw new Error("invalid");
    return parsed;
  } catch {
    const data = seed();
    save(data);
    return data;
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function listDesktops() {
  return load().desktops;
}

function publicDesktops() {
  return listDesktops()
    .filter((d) => d.enabled !== false)
    .map((d) => ({
      id: d.id,
      name: d.name,
      os: d.os || "debian",
      protocol: normalizeProtocol(d.protocol, { fallback: true }),
      port: Number(d.port || defaultPortFor(d.protocol)),
    }));
}

function getDesktop(id) {
  return listDesktops().find((d) => d.id === id) || null;
}

function normalizeProtocol(value, { fallback } = {}) {
  const protocol = String(value || "rdp").trim().toLowerCase();
  if (protocol === "rdp" || protocol === "ssh") return protocol;
  if (fallback) return "rdp";
  throw new Error("Protocol must be RDP or SSH.");
}

function defaultPortFor(protocol) {
  return normalizeProtocol(protocol, { fallback: true }) === "ssh" ? 22 : 3389;
}

function normalize(input) {
  const name = String(input?.name || "").trim();
  const host = String(input?.host || "").trim();
  const protocol = normalizeProtocol(input?.protocol);
  const rawPort = input?.port;
  const port = rawPort === "" || rawPort == null
    ? defaultPortFor(protocol)
    : Number(rawPort);
  const os = String(input?.os || "debian")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9-]+$/.test(os)) {
    throw new Error("OS must be a mapped id such as debian or windows.");
  }
  if (!name || !host) {
    throw new Error("Name and host are required.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be a number between 1 and 65535.");
  }
  return {
    name,
    host,
    port,
    protocol,
    os,
    enabled: input?.enabled !== false,
  };
}

function addDesktop(input) {
  const data = load();
  const desktop = { id: crypto.randomUUID(), ...normalize(input) };
  data.desktops.push(desktop);
  save(data);
  return desktop;
}

function updateDesktop(id, input) {
  const data = load();
  const idx = data.desktops.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  data.desktops[idx] = { ...data.desktops[idx], ...normalize({ ...data.desktops[idx], ...input }) };
  save(data);
  return data.desktops[idx];
}

function removeDesktop(id) {
  const data = load();
  const next = data.desktops.filter((d) => d.id !== id);
  if (next.length === data.desktops.length) return false;
  data.desktops = next;
  save(data);
  return true;
}

module.exports = {
  listDesktops,
  publicDesktops,
  getDesktop,
  addDesktop,
  updateDesktop,
  removeDesktop,
  normalizeProtocol,
  defaultPortFor,
};
