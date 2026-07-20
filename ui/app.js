const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const state = {
  myMods: [],
  trovesaurusMods: [],
  remotePacks: [],
  localPacks: [],
  settings: null,
  selectedMyMod: null,
  selectedRemoteMod: null,
  modTags: [],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function setStatus(text) {
  $("#status-text").textContent = text;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(unixSeconds) {
  const n = Number(unixSeconds);
  if (!n) return "";
  return new Date(n * 1000).toLocaleString();
}

function statusClass(status) {
  if (!status) return "";
  if (status.startsWith("Error")) return "status-error";
  if (status === "New Version Available") return "status-new";
  if (status === "Up To Date") return "status-ok";
  return "";
}

async function run(cmd, args = {}) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    setStatus(String(e));
    throw e;
  }
}

function setupTabs() {
  $$(".tab-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-button").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
      lazyLoadTab(btn.dataset.tab);
    });
  });
  $$(".sub-tab-button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".sub-tab-button").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".sub-tab-panel").forEach((p) => p.classList.toggle("active", p.id === `subtab-${btn.dataset.subtab}`));
      if (btn.dataset.subtab === "archives") loadExtractableFolders();
    });
  });
}

const loadedTabs = new Set();
function lazyLoadTab(tab) {
  if (loadedTabs.has(tab)) return;
  loadedTabs.add(tab);
  if (tab === "getmore") loadTrovesaurusMods(false);
  if (tab === "modpacks") { loadModPacks(); loadLocalPacks(); }
  if (tab === "trovesaurus") { loadServerStatus(); loadNews(); loadCalendar(); loadStreams(); }
  if (tab === "modder") loadModderTools();
  if (tab === "settings") renderSettings();
}

// ---------------- My Mods ----------------

async function loadMyMods() {
  state.myMods = await run("get_my_mods");
  renderMyMods();
}

function renderMyMods() {
  const tbody = $("#mm-table tbody");
  tbody.innerHTML = "";
  for (const mod of state.myMods) {
    const tr = document.createElement("tr");
    if (state.selectedMyMod === mod.filePath) tr.classList.add("selected");
    const version = mod.downloads?.find((d) => d.fileid === mod.currentFileId)?.version ?? "";
    tr.innerHTML = `
      <td><input type="checkbox" class="mm-enabled" ${mod.enabled ? "checked" : ""} /></td>
      <td>${escapeHtml(mod.name)}</td>
      <td>${escapeHtml(mod.author)}</td>
      <td>${escapeHtml(mod.type)}${mod.subtype ? " / " + escapeHtml(mod.subtype) : ""}</td>
      <td>${escapeHtml(version)}</td>
      <td>${formatDate(mod.unixTimeSeconds)}</td>
      <td class="${statusClass(mod.status)}">${escapeHtml(mod.status)}</td>
      <td><input type="checkbox" class="mm-updates-disabled" ${mod.updatesDisabled ? "checked" : ""} /></td>`;
    tr.querySelector(".mm-enabled").addEventListener("change", async (e) => {
      e.stopPropagation();
      state.myMods = await run("set_mod_enabled", { filePath: mod.filePath, enabled: e.target.checked });
      renderMyMods();
    });
    tr.querySelector(".mm-updates-disabled").addEventListener("change", async (e) => {
      e.stopPropagation();
      state.myMods = await run("set_mod_updates_disabled", { filePath: mod.filePath, disabled: e.target.checked });
      renderMyMods();
    });
    tr.addEventListener("click", () => {
      state.selectedMyMod = mod.filePath;
      renderMyMods();
      renderMyModDetail(mod);
    });
    tbody.appendChild(tr);
  }
}

function cleanNotes(mod) {
  const strip = (s) => String(s ?? "").replace(/<[^>]*(>|$)/g, "").replace(/[\s\r\n]+/g, " ").trim();
  let desc = strip(mod.description);
  let replaces = strip(mod.replaces);
  if (replaces) replaces = "Replaces: " + replaces;
  return `${desc} ${replaces}`.trim();
}

async function renderMyModDetail(mod) {
  const panel = $("#mm-detail");
  panel.classList.remove("hidden");
  let files = [];
  try { files = await run("get_mod_files", { filePath: mod.filePath }); } catch {}
  const img = mod.image_full && !mod.image_full.endsWith("modconstruction.jpg")
    ? `<img class="detail-img" src="${escapeHtml(mod.image_full)}" />` : "";
  panel.innerHTML = `
    <h3>${escapeHtml(mod.name)} ${mod.id ? `<a data-url="https://trovesaurus.com/mod.php?id=${mod.id}">(view on Trovesaurus)</a>` : ""}</h3>
    ${img}
    <p>${escapeHtml(cleanNotes(mod))}</p>
    ${files.length ? `<details><summary>Files (${files.length})</summary><ul>${files.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></details>` : ""}`;
}

function selectedMod() {
  return state.myMods.find((m) => m.filePath === state.selectedMyMod);
}

function setupMyMods() {
  $("#mm-add").addEventListener("click", async () => {
    const path = await run("pick_mod_file");
    if (!path) return;
    setStatus("Adding mod...");
    state.myMods = await run("add_mod", { path });
    renderMyMods();
    setStatus("Mod added");
  });
  $("#mm-remove").addEventListener("click", async () => {
    const mod = selectedMod();
    if (!mod) return setStatus("Select a mod first");
    state.myMods = await run("remove_mod", { filePath: mod.filePath });
    state.selectedMyMod = null;
    $("#mm-detail").classList.add("hidden");
    renderMyMods();
  });
  $("#mm-update").addEventListener("click", async () => {
    const mod = selectedMod();
    if (!mod) return setStatus("Select a mod first");
    setStatus(`Updating ${mod.name}...`);
    state.myMods = await run("update_mod", { filePath: mod.filePath, fileId: null });
    renderMyMods();
  });
  $("#mm-update-file").addEventListener("click", async () => {
    const mod = selectedMod();
    if (!mod) return setStatus("Select a mod first");
    const path = await run("pick_mod_file");
    if (!path) return;
    state.myMods = await run("update_mod_path", { filePath: mod.filePath, newFilePath: path });
    renderMyMods();
  });
  $("#mm-check").addEventListener("click", async () => {
    setStatus("Checking for updates...");
    state.myMods = await run("check_all_updates");
    renderMyMods();
    setStatus("Finished checking for updates");
  });
  $("#mm-copy-uri").addEventListener("click", async () => {
    const mod = selectedMod();
    if (!mod) return setStatus("Select a mod first");
    const uri = await run("copy_mod_uri", { filePath: mod.filePath });
    setStatus(`Copied: ${uri}`);
  });
  $("#mm-open-folder").addEventListener("click", async () => {
    const folder = await run("get_mods_folder");
    await run("open_folder", { path: folder });
  });
  $("#mm-remove-overrides").addEventListener("click", async () => {
    const count = await run("remove_override_folders");
    setStatus(`Removed ${count} override folder(s)`);
  });
}

// ---------------- Get More Mods ----------------

async function loadTrovesaurusMods(refresh) {
  setStatus("Loading mods from Trovesaurus...");
  state.trovesaurusMods = await run("get_trovesaurus_mods", { refresh });
  buildTypeFilters();
  renderRemoteMods();
  setStatus(`Loaded ${state.trovesaurusMods.length} mods`);
}

function buildTypeFilters() {
  const types = new Set(), subtypes = new Set();
  for (const m of state.trovesaurusMods) {
    if (m.type) types.add(m.type);
    if (m.subtype) subtypes.add(m.subtype);
  }
  const fill = (sel, values, label) => {
    const el = $(sel);
    const current = el.value;
    el.innerHTML = `<option value="">${label}</option>` + [...values].sort().map((v) => `<option>${escapeHtml(v)}</option>`).join("");
    el.value = current;
  };
  fill("#gm-type", types, "All Types");
  fill("#gm-subtype", subtypes, "All SubTypes");
}

function renderRemoteMods() {
  const search = $("#gm-search").value.toLowerCase();
  const type = $("#gm-type").value;
  const subtype = $("#gm-subtype").value;
  const sort = $("#gm-sort").value;

  let mods = state.trovesaurusMods.filter((m) => {
    if (type && m.type !== type) return false;
    if (subtype && m.subtype !== subtype) return false;
    if (search && !`${m.name} ${m.author} ${m.description}`.toLowerCase().includes(search)) return false;
    return true;
  });

  mods.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "date") return Number(b.date) - Number(a.date);
    return Number(b[sort]) - Number(a[sort]);
  });

  const installed = new Set(state.myMods.map((m) => m.id));
  const tbody = $("#gm-table tbody");
  tbody.innerHTML = "";
  for (const mod of mods) {
    const tr = document.createElement("tr");
    const img = mod.image ? `<img class="mod-thumb" loading="lazy" src="${escapeHtml(mod.image)}" />` : "";
    tr.innerHTML = `
      <td>${img}</td>
      <td>${escapeHtml(mod.name)}</td>
      <td>${escapeHtml(mod.author)}</td>
      <td>${escapeHtml(mod.type)}${mod.subtype ? " / " + escapeHtml(mod.subtype) : ""}</td>
      <td>${mod.votes}</td>
      <td>${mod.totaldownloads}</td>
      <td><button class="gm-install">${installed.has(mod.id) ? "Reinstall" : "Install"}</button></td>`;
    tr.querySelector(".gm-install").addEventListener("click", async (e) => {
      e.stopPropagation();
      setStatus(`Installing ${mod.name}...`);
      state.myMods = await run("install_trovesaurus_mod", { id: mod.id, fileId: "" });
      renderMyMods();
      renderRemoteMods();
      setStatus(`Installed ${mod.name}`);
    });
    tr.addEventListener("click", () => renderRemoteModDetail(mod));
    tbody.appendChild(tr);
  }
}

function renderRemoteModDetail(mod) {
  const panel = $("#gm-detail");
  const img = mod.image_full && !mod.image_full.endsWith("modconstruction.jpg")
    ? `<img class="detail-img" src="${escapeHtml(mod.image_full)}" />` : "";
  const downloads = (mod.downloads ?? []).slice().sort((a, b) => Number(b.fileid) - Number(a.fileid));
  panel.innerHTML = `
    <h3>${escapeHtml(mod.name)}</h3>
    <p class="muted">by ${escapeHtml(mod.author)} | ${escapeHtml(mod.type)}${mod.subtype ? " / " + escapeHtml(mod.subtype) : ""}
      | ${mod.votes} votes | ${mod.totaldownloads} downloads</p>
    ${img}
    <p>${escapeHtml(mod.description ?? "").replace(/<[^>]*>/g, " ")}</p>
    <p><a data-url="https://trovesaurus.com/mod.php?id=${mod.id}">View on Trovesaurus</a></p>
    <h4>Downloads</h4>
    <table class="data-table"><thead><tr><th>Version</th><th>Date</th><th>Format</th><th></th></tr></thead>
    <tbody>${downloads.map((d) => `
      <tr>
        <td>${escapeHtml(d.version)}</td>
        <td>${formatDate(d.date)}</td>
        <td>${escapeHtml(d.format || "zip")}</td>
        <td><button class="gm-install-version" data-fileid="${d.fileid}">Install</button></td>
      </tr>`).join("")}</tbody></table>`;
  panel.querySelectorAll(".gm-install-version").forEach((btn) => {
    btn.addEventListener("click", async () => {
      setStatus(`Installing ${mod.name}...`);
      state.myMods = await run("install_trovesaurus_mod", { id: mod.id, fileId: btn.dataset.fileid });
      renderMyMods();
      renderRemoteMods();
      setStatus(`Installed ${mod.name}`);
    });
  });
}

function setupGetMoreMods() {
  $("#gm-refresh").addEventListener("click", () => loadTrovesaurusMods(true));
  $("#gm-search").addEventListener("input", renderRemoteMods);
  $("#gm-type").addEventListener("change", renderRemoteMods);
  $("#gm-subtype").addEventListener("change", renderRemoteMods);
  $("#gm-sort").addEventListener("change", renderRemoteMods);
}

// ---------------- Mod Packs ----------------

async function loadModPacks() {
  setStatus("Loading mod packs...");
  try {
    state.remotePacks = await run("get_mod_packs");
  } catch {
    state.remotePacks = [];
  }
  renderRemotePacks();
  setStatus(`Loaded ${state.remotePacks.length} mod packs`);
}

function renderRemotePacks() {
  const list = $("#mp-remote-list");
  list.innerHTML = "";
  for (const pack of state.remotePacks) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h4>${escapeHtml(pack.name)}</h4>
      <p class="muted">by ${escapeHtml(pack.authorname)} | ${pack.mods.length} mods</p>
      <div class="row">
        <button class="mp-install">Install Pack</button>
        <button class="mp-copy">Copy URI</button>
        <a data-url="${escapeHtml(pack.url)}">View</a>
      </div>`;
    card.querySelector(".mp-install").addEventListener("click", async () => {
      setStatus(`Installing pack ${pack.name}...`);
      state.myMods = await run("install_mod_pack", { pack });
      renderMyMods();
      setStatus(`Installed pack ${pack.name}`);
    });
    card.querySelector(".mp-copy").addEventListener("click", async () => {
      const uri = await run("copy_mod_pack_uri", { pack });
      setStatus(`Copied: ${uri}`);
    });
    list.appendChild(card);
  }
}

async function loadLocalPacks() {
  state.localPacks = await run("get_my_mod_packs");
  renderLocalPacks();
}

function renderLocalPacks() {
  const list = $("#mp-local-list");
  list.innerHTML = "";
  for (const pack of state.localPacks) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h4>${escapeHtml(pack.name)}</h4>
      <p class="muted">${pack.mods.length} mods (${escapeHtml(pack.source)})</p>
      <div class="row">
        <button class="mp-install">Install Pack</button>
        <button class="mp-copy">Copy URI</button>
        <button class="mp-delete">Delete</button>
      </div>`;
    card.querySelector(".mp-install").addEventListener("click", async () => {
      state.myMods = await run("install_mod_pack", { pack });
      renderMyMods();
      setStatus(`Installed pack ${pack.name}`);
    });
    card.querySelector(".mp-copy").addEventListener("click", async () => {
      const uri = await run("copy_mod_pack_uri", { pack });
      setStatus(`Copied: ${uri}`);
    });
    card.querySelector(".mp-delete").addEventListener("click", async () => {
      state.localPacks = await run("remove_mod_pack", { name: pack.name });
      renderLocalPacks();
    });
    list.appendChild(card);
  }
}

function setupModPacks() {
  $("#mp-refresh").addEventListener("click", loadModPacks);
  $("#mp-create").addEventListener("click", async () => {
    const candidates = state.myMods.filter((m) => m.id);
    if (!candidates.length) return setStatus("No installed mods with Trovesaurus IDs");
    const name = prompt("Mod pack name:");
    if (!name) return;
    state.localPacks = await run("create_mod_pack", { name, modIds: candidates.map((m) => m.id) });
    renderLocalPacks();
  });
}

// ---------------- Trovesaurus ----------------

async function loadServerStatus() {
  const container = $("#ts-status");
  try {
    const status = await run("get_server_status");
    const entry = (name, e) => `
      <div class="status-card">
        <div class="name">${name}</div>
        <div class="value ${e.online ? "online" : "offline"}">${e.online ? "Online" : "Offline"}</div>
        <div class="muted">${formatDate(e.date)}</div>
      </div>`;
    container.innerHTML = entry("Live", status.Live) + entry("Server", status.Server) + entry("PTS", status.PTS);
  } catch {
    container.innerHTML = `<p class="muted">Server status unavailable.</p>`;
  }
  try {
    const mail = await run("get_mail_count");
    if (mail > 0) container.innerHTML += `<div class="status-card"><div class="name">Trovesaurus Mail</div><div class="value">${mail} unread</div></div>`;
  } catch {}
}

async function loadNews() {
  const list = $("#ts-news");
  try {
    const news = await run("get_news");
    list.innerHTML = news.map((n) => `
      <div class="card">
        <h4><a data-url="${escapeHtml(n.url)}">${escapeHtml(n.title)}</a></h4>
        <p class="muted">by ${escapeHtml(n.author)} | ${formatDate(n.date)} | ${escapeHtml(n.views)} views | ${escapeHtml(n.comments)} comments</p>
        <p>${escapeHtml((n.preview ?? "").replace(/<[^>]*>/g, " ").slice(0, 240))}</p>
      </div>`).join("");
  } catch {
    list.innerHTML = `<p class="muted">News unavailable.</p>`;
  }
}

async function loadCalendar() {
  const list = $("#ts-calendar");
  try {
    const items = await run("get_calendar");
    list.innerHTML = items.map((c) => `
      <div class="card">
        <h4><a data-url="${escapeHtml(c.url)}">${escapeHtml(c.name)}</a></h4>
        <p class="muted">${formatDate(c.startdate)} - ${formatDate(c.enddate)}</p>
      </div>`).join("");
  } catch {
    list.innerHTML = `<p class="muted">Calendar unavailable.</p>`;
  }
}

async function loadStreams() {
  const list = $("#ts-streams");
  try {
    const streams = await run("get_streams");
    const online = streams.filter((s) => String(s.online) === "1" || String(s.online).toLowerCase() === "true");
    list.innerHTML = online.length ? online.map((s) => `
      <div class="card">
        <h4><a data-url="https://www.twitch.tv/${escapeHtml(s.channel)}">${escapeHtml(s.name || s.channel)}</a></h4>
        <p class="muted">${escapeHtml(s.status)} | ${s.viewers} viewers</p>
      </div>`).join("") : `<p class="muted">No streams currently online.</p>`;
  } catch {
    list.innerHTML = `<p class="muted">Streams unavailable.</p>`;
  }
}

function setupTrovesaurus() {
  $("#ts-news-refresh").addEventListener("click", loadNews);
  $("#ts-calendar-refresh").addEventListener("click", loadCalendar);
  $("#ts-streams-refresh").addEventListener("click", loadStreams);
}

// ---------------- Modder Tools ----------------

async function loadModderTools() {
  if (!state.modTags.length) {
    state.modTags = await run("get_mod_tags");
  }
  const container = $("#md-tags");
  container.innerHTML = "";
  for (const tag of state.modTags) {
    const label = document.createElement("label");
    label.className = "check";
    label.innerHTML = `<input type="checkbox" data-title="${escapeHtml(tag.title)}" /> ${escapeHtml(tag.title)}`;
    container.appendChild(label);
  }
  const folder = await run("get_mods_folder");
  if (!$("#ex-folder").value) $("#ex-folder").value = folder;
}

function yamlDetailsFromForm() {
  const tags = $$("#md-tags input:checked").map((i) => i.dataset.title);
  const extra = $("#md-add-tags").value.split(",").map((t) => t.trim()).filter(Boolean);
  for (const t of extra) if (!tags.includes(t)) tags.push(t);
  return {
    author: $("#md-author").value,
    title: $("#md-title").value,
    notes: $("#md-notes").value,
    previewPath: $("#md-preview").value,
    files: $$("#md-files option").map((o) => o.value),
    tags,
  };
}

async function loadExtractableFolders() {
  const folders = await run("get_extractable_folders");
  $("#ar-folders").innerHTML = folders.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
}

function setupModderTools() {
  $("#md-add-files").addEventListener("click", async () => {
    const files = await run("pick_files", { filters: [] });
    const list = $("#md-files");
    for (const f of files) {
      const rel = await run("make_relative_path", { fullPath: f });
      if (![...list.options].some((o) => o.value === rel)) {
        list.add(new Option(rel, rel));
      }
    }
  });
  $("#md-remove-files").addEventListener("click", () => {
    [...$("#md-files").selectedOptions].forEach((o) => o.remove());
  });
  $("#md-pick-preview").addEventListener("click", async () => {
    const files = await run("pick_files", { filters: ["png", "jpg"] });
    if (!files.length) return;
    const rel = await run("make_relative_path", { fullPath: files[0] });
    $("#md-preview").value = rel;
    const list = $("#md-files");
    if (![...list.options].some((o) => o.value === rel)) list.add(new Option(rel, rel));
  });
  $("#md-save-yaml").addEventListener("click", async () => {
    const details = yamlDetailsFromForm();
    const folder = await run("get_mods_folder");
    const safe = details.title.replace(/[/\\:*?"<>|]/g, "");
    await run("save_yaml", { details, path: `${folder}/${safe}.yaml` });
    setStatus(`Saved YAML: ${safe}.yaml`);
  });
  $("#md-load-yaml").addEventListener("click", async () => {
    const files = await run("pick_files", { filters: ["yaml"] });
    if (!files.length) return;
    const details = await run("load_yaml", { path: files[0] });
    $("#md-author").value = details.author ?? "";
    $("#md-title").value = details.title ?? "";
    $("#md-notes").value = details.notes ?? "";
    $("#md-preview").value = details.previewPath ?? "";
    $("#md-add-tags").value = "";
    $$("#md-tags input").forEach((i) => { i.checked = (details.tags ?? []).includes(i.dataset.title); });
    const list = $("#md-files");
    list.innerHTML = "";
    for (const f of details.files ?? []) list.add(new Option(f, f));
    setStatus("YAML loaded");
  });
  $("#md-clear").addEventListener("click", () => {
    $("#md-author").value = $("#md-title").value = $("#md-notes").value = $("#md-preview").value = $("#md-add-tags").value = "";
    $("#md-files").innerHTML = "";
    $$("#md-tags input").forEach((i) => { i.checked = false; });
    $("#md-output").textContent = "";
  });
  $("#md-build").addEventListener("click", async () => {
    const details = yamlDetailsFromForm();
    const folder = await run("get_mods_folder");
    const safe = details.title.replace(/[/\\:*?"<>|]/g, "");
    const yamlPath = `${folder}/${safe}.yaml`;
    await run("save_yaml", { details, path: yamlPath });
    setStatus("Building TMod (running Trove dev tool)...");
    const output = await run("run_dev_tool", { commandLineArgs: `-tool buildmod -meta "${yamlPath}"` });
    $("#md-output").textContent = output;
    setStatus("Build complete");
  });
  $("#ex-pick-file").addEventListener("click", async () => {
    const files = await run("pick_files", { filters: ["tmod"] });
    if (files.length) $("#ex-file").value = files[0];
  });
  $("#ex-pick-folder").addEventListener("click", async () => {
    const folder = await run("pick_folder");
    if (folder) $("#ex-folder").value = folder;
  });
  $("#ex-run").addEventListener("click", async () => {
    const file = $("#ex-file").value;
    if (!file) return setStatus("Select a .tmod file first");
    let folder = $("#ex-folder").value;
    if ($("#ex-subfolder").checked) {
      const base = file.replace(/[/\\]/g, "/").split("/").pop().replace(/\.tmod$/i, "");
      folder = `${folder}/${base}`;
    }
    $("#ex-progress").classList.remove("hidden");
    setStatus("Extracting TMod...");
    try {
      await run("extract_tmod_command", {
        path: file,
        folder,
        createOverrideFolders: $("#ex-override").checked,
        createYaml: $("#ex-yaml").checked,
      });
      setStatus(`Extracted to ${folder}`);
    } finally {
      $("#ex-progress").classList.add("hidden");
    }
  });
  $("#ar-refresh").addEventListener("click", loadExtractableFolders);
  $("#ar-extract-all").addEventListener("click", () => extractArchives([...$("#ar-folders").options].map((o) => o.value)));
  $("#ar-extract-selected").addEventListener("click", () => extractArchives([...$("#ar-folders").selectedOptions].map((o) => o.value)));
  $("#ar-list-contents").addEventListener("click", async () => {
    const selected = [...$("#ar-folders").selectedOptions].map((o) => o.value);
    if (!selected.length) return setStatus("Select archive folders first");
    for (const folder of selected) {
      const output = await run("run_dev_tool", { commandLineArgs: `-tool listarchive "${folder}"` });
      $("#md-output").textContent = output;
    }
  });
}

async function extractArchives(folders) {
  if (!folders.length) return setStatus("Select archive folders first");
  for (const folder of folders) {
    setStatus(`Extracting archive: ${folder}`);
    const output = await run("run_dev_tool", {
      commandLineArgs: `-tool extractarchive "${folder}" "extracted/${folder}"`,
    });
    $("#md-output").textContent = output;
  }
  setStatus("Archive extraction complete");
}

// ---------------- Settings ----------------

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  $("#st-key").value = s.trovesaurus_account_link_key ?? "";
  $("#st-auto-update").checked = !!s.auto_update_mods;
  $("#st-game-status").checked = !!s.update_trove_game_status;
  $("#st-check-mail").checked = !!s.trovesaurus_check_mail;
  $("#st-server-status").checked = !!s.trovesaurus_server_status;
  $("#st-start-min").checked = !!s.start_minimized;
  $("#st-min-tray").checked = !!s.minimize_to_tray;
  $("#st-interval").value = s.auto_update_interval_hours ?? 1;
  renderLocations();
}

function renderLocations() {
  const tbody = $("#st-locations tbody");
  tbody.innerHTML = "";
  state.settings.locations.forEach((loc, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="st-loc-enabled" ${loc.enabled ? "checked" : ""} /></td>
      <td><input type="radio" name="st-primary" class="st-loc-primary" ${loc.primary ? "checked" : ""} /></td>
      <td><input type="text" class="st-loc-name" value="${escapeHtml(loc.locationName)}" /></td>
      <td><input type="text" class="st-loc-path" value="${escapeHtml(loc.locationPath)}" size="48" /></td>
      <td><button class="st-loc-remove">Remove</button></td>`;
    tr.querySelector(".st-loc-enabled").addEventListener("change", (e) => { loc.enabled = e.target.checked; });
    tr.querySelector(".st-loc-primary").addEventListener("change", () => {
      state.settings.locations.forEach((l, j) => { l.primary = i === j; });
    });
    tr.querySelector(".st-loc-name").addEventListener("input", (e) => { loc.locationName = e.target.value; });
    tr.querySelector(".st-loc-path").addEventListener("input", (e) => { loc.locationPath = e.target.value; });
    tr.querySelector(".st-loc-remove").addEventListener("click", () => {
      state.settings.locations.splice(i, 1);
      renderLocations();
    });
    tbody.appendChild(tr);
  });
}

function setupSettings() {
  $("#st-add-location").addEventListener("click", async () => {
    const folder = await run("pick_folder");
    if (!folder) return;
    const valid = await run("validate_location", { path: folder });
    if (!valid) setStatus("Warning: Trove.exe not found in the selected folder");
    state.settings.locations.push({
      locationName: folder.split(/[/\\]/).pop() || "Trove",
      locationPath: folder,
      enabled: true,
      primary: state.settings.locations.length === 0,
    });
    renderLocations();
  });
  $("#st-detect").addEventListener("click", async () => {
    state.settings.locations = await run("detect_locations");
    renderLocations();
    setStatus(`Detected ${state.settings.locations.length} location(s)`);
  });
  $("#st-save").addEventListener("click", async () => {
    const s = state.settings;
    s.trovesaurus_account_link_key = $("#st-key").value.trim();
    s.auto_update_mods = $("#st-auto-update").checked;
    s.update_trove_game_status = $("#st-game-status").checked;
    s.trovesaurus_check_mail = $("#st-check-mail").checked;
    s.trovesaurus_server_status = $("#st-server-status").checked;
    s.start_minimized = $("#st-start-min").checked;
    s.minimize_to_tray = $("#st-min-tray").checked;
    s.auto_update_interval_hours = Number($("#st-interval").value) || 1;
    await run("save_settings", { settings: s });
    setStatus("Settings saved");
  });
}

// ---------------- Deep links (trove://) ----------------

async function handleTroveUri(uri) {
  setStatus(`Processing Trove URI: ${uri}`);
  const parsed = await run("parse_trove_uri_command", { uri });
  if (!parsed) return setStatus(`Unknown Trove URI format: ${uri}`);

  document.querySelector('[data-tab="mymods"]').click();

  if (parsed.type === "mod") {
    state.myMods = await run("install_trovesaurus_mod", { id: parsed.modId, fileId: parsed.fileId });
    renderMyMods();
    setStatus("Mod installed from Trove URI");
    return;
  }

  if (parsed.type === "localMod") {
    state.myMods = await run("add_mod", { path: parsed.fileName });
    renderMyMods();
    setStatus("Mod installed from Trove URI");
    return;
  }

  if (parsed.type === "modPack") {
    let pack = null;
    const packIdMatch = uri.match(/modpack=(\d+)/i);
    if (packIdMatch) {
      if (!state.remotePacks.length) await loadModPacks();
      pack = state.remotePacks.find((p) => p.id === packIdMatch[1]);
      if (!pack) {
        await loadModPacks();
        pack = state.remotePacks.find((p) => p.id === packIdMatch[1]);
      }
    } else {
      const adhoc = uri.match(/trove:[/\\]{0,2}(?<name>[^?]+?)\/?\?(?<mods>[0-9&]+)/i);
      if (adhoc) {
        if (!state.trovesaurusMods.length) {
          state.trovesaurusMods = await run("get_trovesaurus_mods", { refresh: false });
        }
        const modIds = adhoc.groups.mods.split("&").filter(Boolean);
        pack = {
          id: "",
          url: "",
          name: decodeURIComponent(adhoc.groups.name),
          authorname: "",
          source: "Local",
          mods: state.trovesaurusMods.filter((m) => modIds.includes(m.id)),
        };
      }
    }
    if (pack && pack.mods.length) {
      state.myMods = await run("install_mod_pack", { pack });
      renderMyMods();
      setStatus(`Installed mod pack: ${pack.name}`);
    } else {
      setStatus("Mod pack not found for Trove URI");
    }
  }
}

// ---------------- About ----------------

async function setupAbout() {
  const version = await run("get_app_version");
  $("#ab-version").textContent = `Version ${version}`;
  $("#ab-check-update").addEventListener("click", async () => {
    const status = $("#ab-update-status");
    status.textContent = "Checking for updates...";
    try {
      status.textContent = await run("check_app_update");
    } catch (e) {
      status.textContent = `Update check failed: ${e}`;
    }
  });
}

// ---------------- Init ----------------

async function init() {
  setupTabs();
  setupMyMods();
  setupGetMoreMods();
  setupModPacks();
  setupTrovesaurus();
  setupModderTools();
  setupSettings();
  setupAbout();

  await listen("log-message", (e) => setStatus(e.payload));
  await listen("extract-progress", (e) => { $("#ex-progress").value = e.payload; });
  await listen("trove-uri", (e) => handleTroveUri(e.payload).catch(() => {}));

  document.body.addEventListener("click", async (e) => {
    const link = e.target.closest("[data-url]");
    if (link) {
      e.preventDefault();
      await run("open_url", { url: link.dataset.url });
    }
  });

  state.settings = await run("get_settings");
  loadedTabs.add("mymods");
  await loadMyMods();

  const launchUri = await run("get_launch_trove_uri");
  if (launchUri) await handleTroveUri(launchUri).catch(() => {});

  setStatus("Ready");
}

init();
