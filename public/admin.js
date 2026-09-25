(() => {
  const appEl = document.getElementById("admin-app");
  const logoutBtn = document.getElementById("logout-btn");
  const form = document.getElementById("desktop-form");
  const modal = document.getElementById("desktop-modal");
  const osForm = document.getElementById("os-form");
  const osModal = document.getElementById("os-modal");
  const userForm = document.getElementById("user-form");
  const userModal = document.getElementById("user-modal");
  const userFormError = document.getElementById("user-form-error");
  const heroForm = document.getElementById("hero-form");
  const formError = document.getElementById("admin-form-error");
  const osFormError = document.getElementById("os-form-error");
  const heroFormError = document.getElementById("hero-form-error");
  const logoUploadError = document.getElementById("logo-upload-error");
  const formTitle = document.getElementById("form-title");
  const formKicker = document.getElementById("form-kicker");
  const saveBtn = document.getElementById("save-btn");
  const deleteBtn = document.getElementById("delete-btn");
  const newBtn = document.getElementById("new-btn");
  const formStatus = document.getElementById("form-status");
  const formStatusLabel = document.getElementById("form-status-label");
  const osSelect = document.getElementById("os-select");
  const logoFile = document.getElementById("logo-file");
  const osMappingRows = document.getElementById("os-mapping-rows");
  const logoGrid = document.getElementById("logo-grid");
  const alertsBtn = document.getElementById("alerts-btn");
  const alertsMenu = document.getElementById("alerts-menu");
  const alertsBadge = document.getElementById("alerts-badge");

  const PAGE_COPY = {
    dashboard: { title: "Dashboard", sub: "Overview of your desktops and gateway" },
    sessions: { title: "Sessions", sub: "Last 24 hours through this gateway" },
    users: { title: "Users", sub: "Gateway accounts and which desktops they may open" },
    branding: { title: "Branding", sub: "Login graphic and OS logos" },
    audit: { title: "Audit Logs", sub: "Last 24 hours of gateway session events" },
  };

  const PAGE_SIZE = 8;
  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 17.2V20h2.8l8.1-8.1-2.8-2.8L4 17.2zM17.7 8.3a.8.8 0 0 0 0-1.1l-1.9-1.9a.8.8 0 0 0-1.1 0l-1.5 1.5 2.8 2.8 1.7-1.3z" fill="currentColor"/></svg>',
    connect: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 20h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M8 7l.8 12h6.4L16 7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  let desktops = [];
  let osTypes = [];
  let logoFiles = [];
  let heroFiles = [];
  let heroFile = "";
  let sessions = { sessions: [], active: [], recent: [] };
  let gatewayUsers = [];
  let selectedId = "";
  let currentView = "dashboard";
  let machinePage = 1;

  function setError(el, message) {
    el.hidden = !message;
    el.textContent = message || "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function cell(label, inner) {
    return `<td data-label="${escapeHtml(label)}">${inner}</td>`;
  }

  async function api(url, options) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...(options?.headers || {}) },
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) sendToLogin();
      const error = new Error(payload.error || "Request failed");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function showApp() {
    appEl.classList.remove("hidden");
  }

  function sendToLogin() {
    window.location.replace("/");
  }

  function field(name, owner = form) {
    return owner.elements.namedItem(name);
  }

  function setAdminUser(user) {
    const name = user?.displayName || user?.username || "admin";
    const who = document.getElementById("gate-who");
    const avatar = document.getElementById("gate-avatar");
    if (who) who.textContent = name;
    if (avatar) avatar.textContent = name.slice(0, 1).toUpperCase();
  }

  function statusText(state) {
    if (state === "in-use") return "In Use";
    if (state === "unavailable") return "Offline";
    if (state === "available") return "Online";
    if (state === "active") return "Active";
    if (state === "failed") return "Failed";
    if (state === "disconnected") return "Disconnected";
    return state || "Unknown";
  }

  function pillClass(state) {
    if (state === "active" || state === "available") return "active";
    if (state === "in-use") return "busy";
    if (state === "failed" || state === "unavailable") return "bad";
    return "";
  }

  function timeAgo(ts) {
    if (!ts) return "Never";
    const s = Math.max(0, Math.round((Date.now() - Number(ts)) / 1000));
    if (s < 20) return "Just now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function lastSeenText(desktop) {
    if (desktop.state === "in-use") return "Active now";
    return timeAgo(desktop.lastSeen);
  }

  function clock(ts) {
    if (!ts) return "—";
    return new Date(Number(ts)).toLocaleString();
  }

  function logoImg(src, label) {
    if (src) return `<img src="${escapeHtml(src)}" alt="">`;
    return `<span class="pc-fallback ac-fallback">${escapeHtml((label || "?").slice(0, 1))}</span>`;
  }

  function openModal() {
    modal.classList.remove("hidden");
    document.body.classList.add("ac-modal-open");
    window.setTimeout(() => field("name")?.focus(), 0);
  }

  function closeModal() {
    modal.classList.add("hidden");
    if (osModal.classList.contains("hidden") && userModal.classList.contains("hidden")) {
      document.body.classList.remove("ac-modal-open");
    }
  }

  function openOsModal() {
    osModal.classList.remove("hidden");
    document.body.classList.add("ac-modal-open");
    window.setTimeout(() => field("id", osForm)?.focus(), 0);
  }

  function closeOsModal() {
    osModal.classList.add("hidden");
    if (modal.classList.contains("hidden") && userModal.classList.contains("hidden")) {
      document.body.classList.remove("ac-modal-open");
    }
  }

  function openUserModal() {
    userModal.classList.remove("hidden");
    document.body.classList.add("ac-modal-open");
    window.setTimeout(() => field("username", userForm)?.focus(), 0);
  }

  function closeUserModal() {
    userModal.classList.add("hidden");
    if (modal.classList.contains("hidden") && osModal.classList.contains("hidden")) {
      document.body.classList.remove("ac-modal-open");
    }
  }

  function renderUserPicks(selected) {
    const box = document.getElementById("user-desktop-picks");
    const chosen = new Set(selected || []);
    if (!desktops.length) {
      box.innerHTML = '<p class="ac-empty">Add a desktop on the dashboard first.</p>';
      return;
    }
    box.innerHTML = desktops.map((d) => `
      <label class="user-pick">
        <input type="checkbox" name="desktopIds" value="${escapeHtml(d.id)}" ${chosen.has(d.id) ? "checked" : ""} />
        ${logoImg(d.logo, d.name)}
        <span>${escapeHtml(d.name)}</span>
      </label>
    `).join("");
  }

  function resetUserForm() {
    userForm.reset();
    field("id", userForm).value = "";
    field("password", userForm).required = true;
    field("password", userForm).placeholder = "";
    field("enabled", userForm).checked = true;
    field("admin", userForm).checked = false;
    document.getElementById("user-form-title").textContent = "Add User";
    document.getElementById("user-form-kicker").textContent = "This signs them into the gateway. They still type the machine password to open RDP or SSH.";
    renderUserPicks([]);
    setError(userFormError, "");
  }

  function fillUserForm(user) {
    field("id", userForm).value = user.id;
    field("username", userForm).value = user.username;
    field("displayName", userForm).value = user.displayName || "";
    field("password", userForm).value = "";
    field("password", userForm).required = false;
    field("password", userForm).placeholder = "Leave blank to keep";
    field("enabled", userForm).checked = user.enabled !== false;
    field("admin", userForm).checked = Boolean(user.admin);
    document.getElementById("user-form-title").textContent = "Edit User";
    document.getElementById("user-form-kicker").textContent = "Leave the password blank to keep the current one.";
    renderUserPicks(user.desktopIds || []);
    setError(userFormError, "");
    openUserModal();
  }

  function renderUsers() {
    const rows = document.getElementById("user-rows");
    if (!gatewayUsers.length) {
      rows.innerHTML = '<tr><td colspan="6" class="ac-empty">No gateway users yet. Add one to let people see assigned desktops.</td></tr>';
      return;
    }
    const names = new Map(desktops.map((d) => [d.id, d.name]));
    rows.innerHTML = gatewayUsers.map((user) => {
      const assigned = (user.desktopIds || []).map((id) => names.get(id) || id).join(", ") || "None";
      return `
        <tr>
          ${cell("Username", `<strong>${escapeHtml(user.username)}</strong>`)}
          ${cell("Display name", escapeHtml(user.displayName || "—"))}
          ${cell("Role", `<span class="ac-pill ${user.admin ? "busy" : ""}">${user.admin ? "Admin" : "User"}</span>`)}
          ${cell("Desktops", escapeHtml(assigned))}
          ${cell("Status", `<span class="ac-pill ${user.enabled === false ? "bad" : "active"}">${user.enabled === false ? "Disabled" : "Enabled"}</span>`)}
          ${cell("Actions", `<div class="ac-actions">
              <button type="button" class="ac-icon-btn" data-edit-user="${escapeHtml(user.id)}" title="Edit">${ICONS.edit}</button>
              <button type="button" class="ac-icon-btn" data-del-user="${escapeHtml(user.id)}" title="Delete">${ICONS.trash}</button>
            </div>`)}
        </tr>
      `;
    }).join("");
    rows.querySelectorAll("[data-edit-user]").forEach((button) => {
      button.addEventListener("click", () => {
        const user = gatewayUsers.find((item) => item.id === button.dataset.editUser);
        if (user) fillUserForm(user);
      });
    });
    rows.querySelectorAll("[data-del-user]").forEach((button) => {
      button.addEventListener("click", async () => {
        const user = gatewayUsers.find((item) => item.id === button.dataset.delUser);
        if (!user) return;
        if (!confirm(`Delete gateway user ${user.username}?`)) return;
        try {
          await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
          await refreshUsers();
        } catch (err) {
          setError(userFormError, err.message);
        }
      });
    });
  }

  async function refreshUsers() {
    const payload = await api("/api/admin/users");
    gatewayUsers = payload.users || [];
    renderUsers();
  }

  function familyLabel(family) {
    return family === "windows" ? "Windows" : "Linux";
  }

  function resetOsForm() {
    osForm.reset();
    field("originalId", osForm).value = "";
    fillLogoSelect("");
    document.getElementById("os-form-title").textContent = "Add OS mapping";
    document.getElementById("os-save-btn").textContent = "Save mapping";
    setError(osFormError, "");
  }

  function fillOsForm(item) {
    field("originalId", osForm).value = item.id;
    field("id", osForm).value = item.id;
    field("label", osForm).value = item.label;
    field("family", osForm).value = item.family;
    fillLogoSelect(item.file);
    document.getElementById("os-form-title").textContent = "Edit OS mapping";
    document.getElementById("os-save-btn").textContent = "Save mapping";
    setError(osFormError, "");
    openOsModal();
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsDataURL(file);
    });
  }

  async function uploadLogo(file, kind) {
    if (!file) return null;
    if (file.size > 2 * 1024 * 1024) throw new Error("File is larger than 2MB.");
    const data = await readFileAsDataUrl(file);
    const payload = await api("/api/admin/logos", {
      method: "POST",
      body: JSON.stringify({ name: file.name, data, kind }),
    });
    return payload.file;
  }

  function setView(view) {
    if (!PAGE_COPY[view]) view = "dashboard";
    currentView = view;
    const copy = PAGE_COPY[view];
    document.getElementById("page-title").textContent = copy.title;
    document.getElementById("page-sub").textContent = copy.sub;
    document.querySelectorAll(".ac-nav .nav-page").forEach((button) => {
      button.classList.toggle("is-on", button.dataset.view === view);
    });
    document.getElementById("dashboard-view").classList.toggle("hidden", view !== "dashboard");
    document.getElementById("sessions-view").classList.toggle("hidden", view !== "sessions");
    document.getElementById("users-view").classList.toggle("hidden", view !== "users");
    document.getElementById("branding-view").classList.toggle("hidden", view !== "branding");
    document.getElementById("audit-view").classList.toggle("hidden", view !== "audit");
    if (view === "branding") refreshOs().catch(() => {});
    if (view === "users") refreshUsers().catch(() => {});
  }

  function fillOsSelect(selected) {
    const value = selected || field("os")?.value || "debian";
    osSelect.innerHTML = osTypes.map((item) => (
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`
    )).join("");
    if (![...osSelect.options].some((option) => option.value === value) && value) {
      osSelect.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
    }
    osSelect.value = value;
  }

  function fillLogoSelect(selected) {
    const options = ['<option value="">Match OS id (debian.png, …)</option>']
      .concat(logoFiles.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`));
    logoFile.innerHTML = options.join("");
    if (selected && ![...logoFile.options].some((option) => option.value === selected)) {
      logoFile.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>`);
    }
    logoFile.value = selected || "";
  }

  function fillHeroSelect() {
    const select = document.getElementById("hero-file");
    if (!select) return;
    const options = ['<option value="">None</option>']
      .concat(heroFiles.map((name) => {
        const label = name.replace(/^images\//, "");
        return `<option value="${escapeHtml(name)}">${escapeHtml(label)}</option>`;
      }));
    select.innerHTML = options.join("");
    if (heroFile && ![...select.options].some((option) => option.value === heroFile)) {
      select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(heroFile)}">${escapeHtml(heroFile)}</option>`);
    }
    select.value = heroFile || "";
    previewHero();
  }

  function previewHero() {
    const select = document.getElementById("hero-file");
    const img = document.getElementById("hero-preview-image");
    const empty = document.getElementById("hero-preview-empty");
    const file = select?.value || "";
    if (!img) return;
    if (file) {
      img.src = `/logos/${file}`;
      img.classList.add("is-on");
      if (empty) empty.hidden = true;
    } else {
      img.removeAttribute("src");
      img.classList.remove("is-on");
      if (empty) empty.hidden = false;
    }
  }

  function renderOsTables() {
    if (!osTypes.length) {
      osMappingRows.innerHTML = '<tr><td colspan="5" class="ac-empty">No OS mappings yet.</td></tr>';
    } else {
      osMappingRows.innerHTML = osTypes.map((item) => `
        <tr>
          ${cell("OS id", `<span class="ac-name">${item.logo ? `<img src="${escapeHtml(item.logo)}" alt="">` : '<span class="pc-fallback ac-fallback">?</span>'}${escapeHtml(item.id)}</span>`)}
          ${cell("Label", escapeHtml(item.label))}
          ${cell("Family", escapeHtml(familyLabel(item.family)))}
          ${cell("Logo file", `${escapeHtml(item.file || "—")}${item.present ? "" : ' <small class="ac-empty">missing</small>'}`)}
          ${cell("Actions", `<div class="ac-actions">
              <button type="button" class="ac-icon-btn" data-edit="${escapeHtml(item.id)}" title="Edit">${ICONS.edit}</button>
              <button type="button" class="ac-icon-btn" data-del="${escapeHtml(item.id)}" title="Delete">${ICONS.trash}</button>
            </div>`)}
        </tr>
      `).join("");
      osMappingRows.querySelectorAll("[data-edit]").forEach((button) => {
        button.addEventListener("click", () => {
          const item = osTypes.find((os) => os.id === button.dataset.edit);
          if (item) fillOsForm(item);
        });
      });
      osMappingRows.querySelectorAll("[data-del]").forEach((button) => {
        button.addEventListener("click", async () => {
          if (!confirm("Delete this OS mapping?")) return;
          try {
            await api(`/api/admin/os/${button.dataset.del}`, { method: "DELETE" });
            await refreshOs();
          } catch (err) {
            setError(osFormError, err.message);
          }
        });
      });
    }

    const osLogos = logoFiles.filter((name) => !name.startsWith("images/"));
    if (!osLogos.length) {
      logoGrid.innerHTML = '<p class="ac-empty">No OS logos in logos/ yet.</p>';
      return;
    }
    logoGrid.innerHTML = osLogos.map((name) => {
      const used = osTypes.find((item) => item.file === name || (item.logo && item.logo.endsWith(`/${name}`)));
      return `
        <div class="logo-tile">
          <img src="/logos/${escapeHtml(name)}" alt="">
          <strong>${escapeHtml(used?.label || name.replace(/\.[^.]+$/, ""))}</strong>
          <small>${escapeHtml(name)}</small>
          <span class="logo-badge ${used ? "" : "idle"}">${used ? "In use" : "On disk"}</span>
        </div>
      `;
    }).join("");
  }

  function protocolLabel(value) {
    return String(value || "rdp").toLowerCase() === "ssh" ? "SSH" : "RDP";
  }

  function defaultPort(protocol) {
    return protocolLabel(protocol) === "SSH" ? 22 : 3389;
  }

  function resetForm() {
    selectedId = "";
    form.reset();
    field("id").value = "";
    field("protocol").value = "rdp";
    field("port").value = 3389;
    fillOsSelect("debian");
    formTitle.textContent = "Add Session";
    formKicker.textContent = "Configure a new session to allow users to connect.";
    saveBtn.textContent = "Save";
    deleteBtn.classList.add("hidden");
    formStatus.hidden = true;
    setError(formError, "");
  }

  function fillForm(desktop) {
    selectedId = desktop.id;
    field("id").value = desktop.id;
    field("name").value = desktop.name;
    field("host").value = desktop.host;
    field("protocol").value = desktop.protocol === "ssh" ? "ssh" : "rdp";
    field("port").value = desktop.port;
    fillOsSelect(desktop.os);
    formTitle.textContent = "Edit Session";
    formKicker.textContent = "Users still type the machine password on the login page.";
    saveBtn.textContent = "Save";
    deleteBtn.classList.remove("hidden");
    formStatus.hidden = false;
    formStatus.dataset.state = desktop.state || "available";
    formStatusLabel.textContent = statusText(desktop.state);
    setError(formError, "");
    openModal();
  }

  function filteredDesktops() {
    const q = document.getElementById("machine-search").value.trim().toLowerCase();
    const status = document.getElementById("machine-status").value;
    const os = document.getElementById("machine-os").value;
    return desktops.filter((d) => {
      if (status !== "all" && d.state !== status) return false;
      if (os !== "all" && d.os !== os) return false;
      if (!q) return true;
      const hay = `${d.name} ${d.host} ${d.osLabel || ""} ${d.os || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function fillOsFilter() {
    const select = document.getElementById("machine-os");
    const current = select.value || "all";
    const seen = new Map();
    for (const d of desktops) {
      if (!seen.has(d.os)) seen.set(d.os, d.osLabel || d.os);
    }
    select.innerHTML = '<option value="all">All OS</option>' +
      [...seen.entries()].map(([id, label]) => (
        `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`
      )).join("");
    select.value = [...select.options].some((opt) => opt.value === current) ? current : "all";
  }

  function bindRowActions(root) {
    root.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const desktop = desktops.find((d) => d.id === button.dataset.edit);
        if (desktop) fillForm(desktop);
      });
    });
    root.querySelectorAll("[data-connect]").forEach((button) => {
      button.addEventListener("click", () => {
        window.location.href = "/";
      });
    });
    root.querySelectorAll("[data-del]").forEach((button) => {
      button.addEventListener("click", async () => {
        const desktop = desktops.find((d) => d.id === button.dataset.del);
        if (!desktop) return;
        if (!confirm(`Delete ${desktop.name} from the gateway?`)) return;
        try {
          await api(`/api/admin/desktops/${desktop.id}`, { method: "DELETE" });
          if (selectedId === desktop.id) resetForm({ go: false });
          await refresh();
        } catch (err) {
          setError(formError, err.message);
          setView("dashboard");
        }
      });
    });
  }

  function machineRow(d) {
    return `
      <tr>
        ${cell("Name", `<span class="ac-name">${logoImg(d.logo, d.name)}${escapeHtml(d.name)}</span>`)}
        ${cell("OS", escapeHtml(d.osLabel || d.os))}
        ${cell("Protocol", `<span class="ac-pill">${protocolLabel(d.protocol)}</span>`)}
        ${cell("Host / IP", `${escapeHtml(d.host)}${d.port && Number(d.port) !== defaultPort(d.protocol) ? `:${escapeHtml(d.port)}` : ""}`)}
        ${cell("Status", `<span class="ac-status" data-state="${escapeHtml(d.state)}"><i class="bubble"></i>${escapeHtml(statusText(d.state))}</span>`)}
        ${cell("Last Seen", escapeHtml(lastSeenText(d)))}
        ${cell("Actions", `<div class="ac-actions">
            <button type="button" class="ac-icon-btn" data-edit="${escapeHtml(d.id)}" title="Edit">${ICONS.edit}</button>
            <button type="button" class="ac-icon-btn" data-connect="${escapeHtml(d.id)}" title="Open desktops">${ICONS.connect}</button>
            <button type="button" class="ac-icon-btn" data-del="${escapeHtml(d.id)}" title="Delete">${ICONS.more}</button>
          </div>`)}
      </tr>
    `;
  }

  function renderPager(total) {
    const pager = document.getElementById("machine-pager");
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (machinePage > pages) machinePage = pages;
    if (pages <= 1) {
      pager.innerHTML = "";
      return;
    }
    pager.innerHTML = Array.from({ length: pages }, (_, i) => {
      const n = i + 1;
      return `<button type="button" class="${n === machinePage ? "is-on" : ""}" data-page="${n}">${n}</button>`;
    }).join("");
    pager.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        machinePage = Number(button.dataset.page);
        renderMachines();
      });
    });
  }

  function renderMachines() {
    const rows = document.getElementById("machine-rows");
    const filtered = filteredDesktops();
    const start = (machinePage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);
    if (!filtered.length) {
      rows.innerHTML = '<tr><td colspan="7" class="ac-empty">No machines match these filters.</td></tr>';
    } else {
      rows.innerHTML = pageRows.map(machineRow).join("");
      bindRowActions(rows);
    }
    renderPager(filtered.length);
  }

  function renderStats() {
    const total = desktops.length;
    const online = desktops.filter((d) => d.state === "available").length;
    const busy = desktops.filter((d) => d.state === "in-use").length;
    const offline = desktops.filter((d) => d.state === "unavailable").length;
    document.getElementById("stat-cards").innerHTML = `
      <div class="ac-stat">
        <small>Total Desktops</small>
        <strong>${total}</strong>
      </div>
      <div class="ac-stat">
        <small><i class="bubble" data-state="available"></i> Online</small>
        <strong>${online}</strong>
      </div>
      <div class="ac-stat">
        <small><i class="bubble" data-state="in-use"></i> In Use</small>
        <strong>${busy}</strong>
      </div>
      <div class="ac-stat">
        <small><i class="bubble" data-state="unavailable"></i> Offline</small>
        <strong>${offline}</strong>
      </div>
    `;
    alertsBadge.hidden = offline === 0;
    alertsBadge.textContent = String(offline);
    const offlineList = desktops.filter((d) => d.state === "unavailable");
    alertsMenu.innerHTML = offlineList.length
      ? offlineList.map((d) => (
        `<button type="button" data-goto="${escapeHtml(d.id)}">${escapeHtml(d.name)} is offline</button>`
      )).join("")
      : '<p>No offline desktops right now.</p>';
    alertsMenu.querySelectorAll("[data-goto]").forEach((button) => {
      button.addEventListener("click", () => {
        alertsMenu.classList.add("hidden");
        alertsBtn.setAttribute("aria-expanded", "false");
        setView("dashboard");
      });
    });
  }

  function durationText(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) return "—";
    const s = Math.floor(value / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }

  function sessionDuration(entry) {
    if (entry?.durationMs != null) return durationText(entry.durationMs);
    if (!entry?.startedAt) return "—";
    return durationText((entry.endedAt || Date.now()) - entry.startedAt);
  }

  function appUserLabel(entry) {
    return entry?.appDisplayName || entry?.appUser || "—";
  }

  function listedSessions() {
    return sessions.sessions || sessions.recent || [];
  }

  function renderSessions() {
    const recent = document.getElementById("recent-sessions");
    const rows = document.getElementById("session-rows");
    const audit = document.getElementById("audit-rows");
    const list = listedSessions();
    const preview = list.slice(0, 6);
    recent.innerHTML = preview.length
      ? preview.map((entry) => `
          <tr>
            ${cell("Desktop", `<span class="ac-name">${logoImg(entry.logo, entry.desktopName)}<span>${escapeHtml(entry.desktopName || entry.host || "Unknown")}</span></span>`)}
            ${cell("App user", escapeHtml(appUserLabel(entry)))}
            ${cell("Source IP", escapeHtml(entry.clientIp || "—"))}
            ${cell("Session time", escapeHtml(sessionDuration(entry)))}
            ${cell("Status", `<span class="ac-pill ${pillClass(entry.state)}">${escapeHtml(statusText(entry.state))}</span>`)}
          </tr>
        `).join("")
      : '<tr><td colspan="5" class="ac-empty">No sessions through this gateway in the last 24 hours.</td></tr>';
    rows.innerHTML = list.length
      ? list.map((entry) => {
        const state = entry.state || "disconnected";
        return `
          <tr>
            ${cell("Desktop", `<span class="ac-name">${logoImg(entry.logo, entry.desktopName)}<span>${escapeHtml(entry.desktopName || entry.host || "Unknown")}</span></span>`)}
            ${cell("App user", escapeHtml(appUserLabel(entry)))}
            ${cell("Machine user", escapeHtml(entry.username || "—"))}
            ${cell("Source IP", escapeHtml(entry.clientIp || "—"))}
            ${cell("Started", escapeHtml(clock(entry.startedAt)))}
            ${cell("Session time", escapeHtml(sessionDuration(entry)))}
            ${cell("Status", `<span class="ac-pill ${pillClass(state)}">${escapeHtml(statusText(state))}</span>`)}
          </tr>
        `;
      }).join("")
      : '<tr><td colspan="7" class="ac-empty">No sessions in the last 24 hours.</td></tr>';
    audit.innerHTML = list.length
      ? list.map((e) => `
          <tr>
            ${cell("When", escapeHtml(clock(e.endedAt || e.startedAt)))}
            ${cell("App user", escapeHtml(appUserLabel(e)))}
            ${cell("Source IP", escapeHtml(e.clientIp || "—"))}
            ${cell("Desktop", escapeHtml(e.desktopName || "—"))}
            ${cell("Session time", escapeHtml(sessionDuration(e)))}
            ${cell("Status", `<span class="ac-pill ${pillClass(e.state)}">${escapeHtml(statusText(e.state))}</span>`)}
          </tr>
        `).join("")
      : '<tr><td colspan="6" class="ac-empty">No audit events yet. Session history is stored on this host.</td></tr>';
  }

  function render() {
    fillOsFilter();
    renderStats();
    renderMachines();
    renderSessions();
    renderUsers();
    if (selectedId) {
      const current = desktops.find((d) => d.id === selectedId);
      if (current) {
        formStatus.hidden = false;
        formStatus.dataset.state = current.state || "available";
        formStatusLabel.textContent = statusText(current.state);
      }
    }
  }

  async function refreshOs() {
    const payload = await api("/api/admin/os");
    osTypes = payload.os || [];
    logoFiles = payload.files || [];
    heroFiles = payload.heroFiles || [];
    heroFile = payload.hero?.file || "";
    fillOsSelect(field("os")?.value);
    fillLogoSelect(field("file", osForm)?.value);
    fillHeroSelect();
    renderOsTables();
  }

  async function refresh() {
    const payload = await api("/api/admin/desktops");
    desktops = payload.desktops || [];
    try {
      sessions = await api("/api/admin/sessions");
    } catch {
      sessions = { sessions: [], active: [], recent: [] };
    }
    try {
      const people = await api("/api/admin/users");
      gatewayUsers = people.users || [];
    } catch {
      gatewayUsers = [];
    }
    render();
  }

  async function boot() {
    await refreshOs();
    resetForm();
    await refresh();
  }

  document.querySelectorAll(".ac-nav .nav-page").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  document.querySelectorAll("[data-view='sessions'].ac-link").forEach((button) => {
    button.addEventListener("click", () => setView("sessions"));
  });

  ["machine-search", "machine-status", "machine-os"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      machinePage = 1;
      renderMachines();
    });
    document.getElementById(id).addEventListener("change", () => {
      machinePage = 1;
      renderMachines();
    });
  });

  alertsBtn.addEventListener("click", () => {
    const open = alertsMenu.classList.toggle("hidden");
    alertsBtn.setAttribute("aria-expanded", String(!open));
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".ac-bell-wrap")) return;
    alertsMenu.classList.add("hidden");
    alertsBtn.setAttribute("aria-expanded", "false");
  });

  field("protocol")?.addEventListener("change", () => {
    field("port").value = defaultPort(field("protocol").value);
  });
  field("port")?.addEventListener("input", () => {
    field("port").value = String(field("port").value || "").replace(/\D/g, "").slice(0, 5);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError(formError, "");
    const data = new FormData(form);
    const port = Number(data.get("port"));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(formError, "Enter a port between 1 and 65535.");
      return;
    }
    const body = {
      name: data.get("name"),
      host: data.get("host"),
      port,
      os: data.get("os"),
      protocol: data.get("protocol"),
    };
    try {
      if (selectedId) {
        await api(`/api/admin/desktops/${selectedId}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        const created = await api("/api/admin/desktops", { method: "POST", body: JSON.stringify(body) });
        selectedId = created.desktop?.id || "";
      }
      await refresh();
      closeModal();
      resetForm();
    } catch (err) {
      setError(formError, err.message);
    }
  });

  document.getElementById("form-cancel").addEventListener("click", () => {
    closeModal();
    resetForm();
  });

  modal.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => {
      closeModal();
      resetForm();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!osModal.classList.contains("hidden")) {
      closeOsModal();
      resetOsForm();
      return;
    }
    if (!userModal.classList.contains("hidden")) {
      closeUserModal();
      resetUserForm();
      return;
    }
    if (modal.classList.contains("hidden")) return;
    closeModal();
    resetForm();
  });

  document.getElementById("hero-file")?.addEventListener("change", previewHero);

  document.getElementById("hero-upload")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(heroFormError, "");
    try {
      const saved = await uploadLogo(file, "hero");
      await refreshOs();
      if (saved) {
        document.getElementById("hero-file").value = saved;
        previewHero();
      }
    } catch (err) {
      setError(heroFormError, err.message);
    }
  });

  async function handleOsLogoFile(file) {
    setError(logoUploadError, "");
    try {
      await uploadLogo(file, "logo");
      await refreshOs();
    } catch (err) {
      setError(logoUploadError, err.message);
    }
  }

  const logoDrop = document.querySelector(".logo-drop");
  document.getElementById("logo-upload")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await handleOsLogoFile(file);
  });
  logoDrop?.addEventListener("dragover", (event) => {
    event.preventDefault();
    logoDrop.classList.add("is-over");
  });
  logoDrop?.addEventListener("dragleave", () => logoDrop.classList.remove("is-over"));
  logoDrop?.addEventListener("drop", async (event) => {
    event.preventDefault();
    logoDrop.classList.remove("is-over");
    const file = event.dataTransfer?.files?.[0];
    if (file) await handleOsLogoFile(file);
  });

  heroForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError(heroFormError, "");
    const body = { file: document.getElementById("hero-file").value };
    try {
      const payload = await api("/api/admin/hero", { method: "PUT", body: JSON.stringify(body) });
      heroFile = payload.hero?.file || "";
      fillHeroSelect();
    } catch (err) {
      setError(heroFormError, err.message);
    }
  });

  osForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError(osFormError, "");
    const data = new FormData(osForm);
    const originalId = String(data.get("originalId") || "");
    const body = {
      id: data.get("id"),
      label: data.get("label"),
      family: data.get("family"),
      file: data.get("file"),
    };
    try {
      if (originalId) {
        await api(`/api/admin/os/${originalId}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/api/admin/os", { method: "POST", body: JSON.stringify(body) });
      }
      osForm.reset();
      closeOsModal();
      resetOsForm();
      await refreshOs();
    } catch (err) {
      setError(osFormError, err.message);
    }
  });

  document.getElementById("os-add-btn").addEventListener("click", () => {
    resetOsForm();
    openOsModal();
  });

  document.getElementById("os-reset-btn").addEventListener("click", () => {
    closeOsModal();
    resetOsForm();
  });

  osModal.querySelectorAll("[data-close-os-modal]").forEach((el) => {
    el.addEventListener("click", () => {
      closeOsModal();
      resetOsForm();
    });
  });

  document.getElementById("user-add-btn").addEventListener("click", () => {
    resetUserForm();
    openUserModal();
  });

  document.getElementById("user-cancel").addEventListener("click", () => {
    closeUserModal();
    resetUserForm();
  });

  userModal.querySelectorAll("[data-close-user-modal]").forEach((el) => {
    el.addEventListener("click", () => {
      closeUserModal();
      resetUserForm();
    });
  });

  userForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError(userFormError, "");
    const data = new FormData(userForm);
    const id = String(data.get("id") || "");
    const body = {
      username: data.get("username"),
      displayName: data.get("displayName"),
      password: data.get("password"),
      enabled: Boolean(data.get("enabled")),
      admin: Boolean(data.get("admin")),
      desktopIds: data.getAll("desktopIds"),
    };
    try {
      if (id) {
        await api(`/api/admin/users/${id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
      }
      closeUserModal();
      resetUserForm();
      await refreshUsers();
    } catch (err) {
      setError(userFormError, err.message);
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    if (!confirm("Delete this PC from the gateway?")) return;
    setError(formError, "");
    try {
      await api(`/api/admin/desktops/${selectedId}`, { method: "DELETE" });
      resetForm();
      closeModal();
      await refresh();
    } catch (err) {
      setError(formError, err.message);
    }
  });

  newBtn.addEventListener("click", () => {
    resetForm();
    openModal();
  });

  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    sendToLogin();
  });

  api("/api/admin/session")
    .then(async (payload) => {
      setAdminUser(payload.user);
      showApp();
      await boot();
    })
    .catch(() => sendToLogin());

  setInterval(() => {
    if (appEl.classList.contains("hidden")) return;
    refresh().catch(() => {});
  }, 5000);
})();
