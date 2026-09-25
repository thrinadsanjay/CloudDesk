const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "os.json");
const LOGOS_DIR = process.env.LOGOS_DIR || path.join(__dirname, "..", "logos");
const IMAGE_EXTS = [".png", ".svg", ".webp", ".jpg", ".jpeg", ".gif"];

function defaultHeroFile() {
  const files = listHeroImages();
  return files[0] || "";
}

function seed() {
  return {
    os: [
      { id: "debian", label: "Debian", family: "linux", file: "debian.png" },
      { id: "ubuntu", label: "Ubuntu", family: "linux", file: "ubuntu.png" },
      { id: "redhat", label: "Red Hat", family: "linux", file: "redhat.png" },
      { id: "rocky", label: "Rocky Linux", family: "linux", file: "rocky.png" },
      { id: "windows", label: "Windows", family: "windows", file: "windows.png" },
      { id: "linux", label: "Linux (xrdp)", family: "linux", file: "linux.png" },
    ],
    hero: { file: defaultHeroFile() },
  };
}

function normalizeHeroState(hero) {
  if (typeof hero === "string") return { file: hero };
  if (hero && typeof hero.file === "string") return { file: hero.file };
  return { file: defaultHeroFile() };
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(parsed.os)) throw new Error("invalid");
    parsed.hero = normalizeHeroState(parsed.hero);
    return parsed;
  } catch {
    const data = seed();
    save(data);
    return data;
  }
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(LOGOS_DIR, "images"), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeRelPath(name) {
  const raw = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw.includes("..")) return "";
  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return "";
  if (parts.length === 2 && parts[0] !== "images") return "";
  if (!parts.every((part) => /^[a-zA-Z0-9._-]+$/.test(part))) return "";
  const ext = path.extname(parts[parts.length - 1]).toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) return "";
  return parts.join("/");
}

function listLogoFiles() {
  fs.mkdirSync(path.join(LOGOS_DIR, "images"), { recursive: true });
  const found = [];
  function scan(dir, prefix) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && IMAGE_EXTS.includes(path.extname(entry.name).toLowerCase())) {
        found.push(prefix + entry.name);
      }
    }
  }
  scan(LOGOS_DIR, "");
  scan(path.join(LOGOS_DIR, "images"), "images/");
  return found.sort();
}

function listHeroImages() {
  return listLogoFiles().filter((name) => name.startsWith("images/"));
}

function normalizeHeroFile(name) {
  let raw = String(name || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!raw || raw.includes("..")) return "";
  if (!raw.startsWith("images/")) raw = `images/${path.basename(raw)}`;
  const safe = safeRelPath(raw);
  if (!safe.startsWith("images/")) return "";
  return existingFile(safe);
}

function existingFile(relPath) {
  const safe = safeRelPath(relPath);
  if (!safe) return "";
  try {
    const full = path.join(LOGOS_DIR, safe);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return safe;
  } catch {
    return "";
  }
  return "";
}

function resolveFile(osId, preferred) {
  const files = listLogoFiles();
  const wanted = [];
  const mapped = safeRelPath(preferred);
  if (mapped) wanted.push(mapped.toLowerCase());
  for (const ext of IMAGE_EXTS) {
    wanted.push(`${osId}${ext}`);
    wanted.push(`images/${osId}${ext}`);
  }
  for (const name of wanted) {
    const match = files.find((file) => file.toLowerCase() === name.toLowerCase());
    if (match) return match;
  }
  return "";
}

function decorate(item) {
  const file = resolveFile(item.id, item.file);
  return {
    id: item.id,
    label: item.label,
    family: item.family === "windows" ? "windows" : "linux",
    file: item.file || `${item.id}.png`,
    present: Boolean(file),
    logo: file ? `/logos/${file}` : "",
  };
}

function decorateHero() {
  const file = normalizeHeroFile(load().hero?.file);
  return {
    file: file || "",
    present: Boolean(file),
    logo: file ? `/logos/${file}` : "",
  };
}

function list() {
  return load().os.map(decorate);
}

function get(id) {
  const found = load().os.find((item) => item.id === id);
  return found ? decorate(found) : null;
}

function normalize(input, { creating } = {}) {
  const id = slug(input?.id);
  const label = String(input?.label || "").trim();
  const family = input?.family === "windows" ? "windows" : "linux";
  const file = safeRelPath(input?.file) || `${id}.png`;
  if (!id) throw new Error("OS id is required (letters, numbers, dashes).");
  if (!label) throw new Error("Display name is required.");
  if (creating && load().os.some((item) => item.id === id)) {
    throw new Error("That OS id already exists.");
  }
  return { id, label, family, file };
}

function add(input) {
  const data = load();
  const item = normalize(input, { creating: true });
  data.os.push(item);
  save(data);
  return decorate(item);
}

function update(id, input) {
  const data = load();
  const idx = data.os.findIndex((item) => item.id === id);
  if (idx === -1) return null;
  const nextId = slug(input?.id || id);
  if (nextId !== id && data.os.some((item) => item.id === nextId)) {
    throw new Error("That OS id already exists.");
  }
  data.os[idx] = normalize({ ...data.os[idx], ...input, id: nextId });
  save(data);
  return decorate(data.os[idx]);
}

function remove(id) {
  const data = load();
  const next = data.os.filter((item) => item.id !== id);
  if (next.length === data.os.length) return false;
  data.os = next;
  save(data);
  return true;
}

function familyFor(osId) {
  return get(osId)?.family || (osId === "windows" ? "windows" : "linux");
}

function getHero() {
  return decorateHero();
}

function setHero(input) {
  const data = load();
  const requested = input?.file ?? "";
  if (requested && !normalizeHeroFile(requested)) {
    throw new Error("Pick an image from the logos/images folder.");
  }
  data.hero = { file: normalizeHeroFile(requested) };
  save(data);
  return decorateHero();
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function saveUploadedLogo({ name, data, kind }) {
  const raw = String(data || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw new Error("No file data.");
  let buf;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new Error("Could not read that file.");
  }
  if (!buf.length) throw new Error("Could not read that file.");
  if (buf.length > MAX_LOGO_BYTES) throw new Error("File is larger than 2MB.");
  const base = path.basename(String(name || ""));
  const rel = kind === "hero" ? safeRelPath(`images/${base}`) : safeRelPath(base);
  if (!rel) throw new Error("Use a simple image name such as debian.png.");
  if (kind === "hero" && !rel.startsWith("images/")) {
    throw new Error("Login images must go in logos/images/.");
  }
  if (kind !== "hero" && rel.includes("/")) {
    throw new Error("OS logos are stored in the logos folder, not a subfolder.");
  }
  const full = path.join(LOGOS_DIR, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return rel;
}

module.exports = {
  LOGOS_DIR,
  list,
  get,
  add,
  update,
  remove,
  listLogoFiles,
  listHeroImages,
  familyFor,
  decorate,
  getHero,
  setHero,
  saveUploadedLogo,
};
