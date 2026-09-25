const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "users.json");
const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD = 8;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(parsed.users)) throw new Error("invalid");
    return parsed;
  } catch {
    const data = { users: [] };
    save(data);
    return data;
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    desktopIds: Array.isArray(user.desktopIds) ? [...user.desktopIds] : [],
    enabled: user.enabled !== false,
    admin: Boolean(user.admin),
    createdAt: user.createdAt || null,
  };
}

function isAdmin(user) {
  return Boolean(user?.admin) && user.enabled !== false;
}

function enabledAdmins(data, exceptId) {
  return (data?.users || []).filter((item) => (
    item.admin && item.enabled !== false && item.id !== exceptId
  ));
}

function hashPassword(password, salt) {
  const usedSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), usedSalt, SCRYPT_KEYLEN).toString("hex");
  return { salt: usedSalt, hash };
}

function verifyPassword(user, password) {
  if (!user?.salt || !user?.hash) return false;
  const check = crypto.scryptSync(String(password), user.salt, SCRYPT_KEYLEN);
  const saved = Buffer.from(user.hash, "hex");
  if (check.length !== saved.length) return false;
  return crypto.timingSafeEqual(check, saved);
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(username)) {
    throw new Error("Username must be 2–32 characters: letters, numbers, dot, dash, or underscore.");
  }
  return username;
}

function normalizeDesktopIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    const value = String(id || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function requirePassword(password, { required }) {
  const value = String(password || "");
  if (!value) {
    if (required) throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
    return "";
  }
  if (value.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  return value;
}

function list() {
  return load().users.map(publicUser);
}

function get(id) {
  const found = load().users.find((item) => item.id === id);
  return found ? publicUser(found) : null;
}

function getRecord(id) {
  return load().users.find((item) => item.id === id) || null;
}

function authenticate(username, password) {
  const name = String(username || "").trim().toLowerCase();
  const user = load().users.find((item) => item.username === name);
  if (!user || user.enabled === false) return null;
  if (!verifyPassword(user, password)) return null;
  return publicUser(user);
}

function add(input) {
  const username = normalizeUsername(input?.username);
  const displayName = String(input?.displayName || username).trim() || username;
  const password = requirePassword(input?.password, { required: true });
  const desktopIds = normalizeDesktopIds(input?.desktopIds);
  const data = load();
  if (data.users.some((item) => item.username === username)) {
    throw new Error("That username already exists.");
  }
  const secrets = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    displayName,
    desktopIds,
    enabled: input?.enabled !== false,
    admin: Boolean(input?.admin),
    createdAt: Date.now(),
    ...secrets,
  };
  data.users.push(user);
  save(data);
  return publicUser(user);
}

function update(id, input) {
  const data = load();
  const idx = data.users.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  const current = data.users[idx];
  const username = input?.username != null ? normalizeUsername(input.username) : current.username;
  if (username !== current.username && data.users.some((item) => item.username === username)) {
    throw new Error("That username already exists.");
  }
  const password = requirePassword(input?.password, { required: false });
  const next = {
    ...current,
    username,
    displayName: String(input?.displayName ?? current.displayName).trim() || username,
    desktopIds: input?.desktopIds != null ? normalizeDesktopIds(input.desktopIds) : current.desktopIds,
    enabled: input?.enabled !== false,
    admin: input?.admin != null ? Boolean(input.admin) : Boolean(current.admin),
  };
  if (current.admin && (!next.admin || next.enabled === false) && !enabledAdmins(data, current.id).length) {
    throw new Error("Keep at least one enabled administrator.");
  }
  if (password) Object.assign(next, hashPassword(password));
  data.users[idx] = next;
  save(data);
  return publicUser(next);
}

function remove(id) {
  const data = load();
  const current = data.users.find((item) => item.id === id);
  if (!current) return false;
  if (current.admin && !enabledAdmins(data, current.id).length) {
    throw new Error("Cannot delete the last administrator.");
  }
  data.users = data.users.filter((item) => item.id !== id);
  save(data);
  return true;
}

function ensureBuiltinAdmin(username, password) {
  let name = "admin";
  try {
    name = normalizeUsername(username || "admin");
  } catch {
    name = "admin";
  }
  const data = load();
  const existing = data.users.find((item) => item.username === name);
  if (existing) {
    if (!existing.admin) {
      existing.admin = true;
      save(data);
    }
    return publicUser(existing);
  }
  const pass = String(password || "");
  if (!pass) {
    console.warn("[users] ADMIN_PASSWORD is empty; did not create the default admin account.");
    return null;
  }
  const secrets = hashPassword(pass);
  const user = {
    id: crypto.randomUUID(),
    username: name,
    displayName: "Administrator",
    desktopIds: [],
    enabled: true,
    admin: true,
    createdAt: Date.now(),
    ...secrets,
  };
  data.users.push(user);
  save(data);
  console.log(`[users] created built-in administrator '${name}'`);
  return publicUser(user);
}

function unassignDesktop(desktopId) {
  const data = load();
  let changed = false;
  for (const user of data.users) {
    const ids = user.desktopIds || [];
    const next = ids.filter((id) => id !== desktopId);
    if (next.length !== ids.length) {
      user.desktopIds = next;
      changed = true;
    }
  }
  if (changed) save(data);
}

function canAccess(user, desktopId) {
  if (!user || user.enabled === false) return false;
  if (user.admin) return true;
  return (user.desktopIds || []).includes(String(desktopId || ""));
}

module.exports = {
  list,
  get,
  getRecord,
  authenticate,
  add,
  update,
  remove,
  unassignDesktop,
  canAccess,
  isAdmin,
  ensureBuiltinAdmin,
};
