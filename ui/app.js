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

function plainText(s) {
  const el = document.createElement("textarea");
  el.innerHTML = String(s ?? "")
    .replace(/\\r\\n|\\n|\\r/g, " ")
    .replace(/<[^>]*>/g, " ");
  return el.value.replace(/\s+/g, " ").trim();
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

// ---------------- UX helpers (toasts, busy state, modal) ----------------

function errText(e) {
  if (e == null) return "Unknown error";
  if (typeof e === "string") return e;
  return e.message || String(e);
}

async function run(cmd, args = {}, opts = {}) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    const msg = errText(e);
    setStatus(msg);
    if (!opts.silent) toast(msg, "error");
    throw e;
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function withBusy(btn, fn) {
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("is-busy");
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-busy");
  }
}

function toast(message, type = "info", ms = 4000) {
  let container = $("#ux-toasts");
  if (!container) {
    container = document.createElement("div");
    container.id = "ux-toasts";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = `ux-toast ux-toast-${type}`;
  const text = document.createElement("span");
  text.className = "ux-toast-text";
  text.textContent = message;
  const close = document.createElement("button");
  close.className = "ux-toast-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  el.append(text, close);
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const timer = setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }
  close.addEventListener("click", dismiss);
}

function openModal({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, input = null }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ux-modal-overlay";
    const dialog = document.createElement("div");
    dialog.className = "ux-modal";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const h = document.createElement("h3");
    h.textContent = title;
    const p = document.createElement("p");
    p.className = "ux-modal-msg";
    p.textContent = message;
    dialog.append(h, p);
    let inputEl = null;
    if (input) {
      inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.className = "ux-modal-input";
      inputEl.value = input.value ?? "";
      inputEl.placeholder = input.placeholder ?? "";
      dialog.appendChild(inputEl);
    }
    const actions = document.createElement("div");
    actions.className = "ux-modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = cancelLabel;
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = danger ? "danger" : "primary";
    confirmBtn.textContent = confirmLabel;
    actions.append(cancelBtn, confirmBtn);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    const close = (val) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(null);
      } else if (e.key === "Enter" && inputEl && document.activeElement === inputEl) {
        close(inputEl.value.trim() || null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
    cancelBtn.addEventListener("click", () => close(null));
    confirmBtn.addEventListener("click", () => close(inputEl ? (inputEl.value.trim() || null) : true));
    document.body.appendChild(overlay);
    (inputEl || confirmBtn).focus();
  });
}

function confirmAction(message, title = "Please confirm", confirmLabel = "Remove") {
  return openModal({ title, message, confirmLabel, danger: true }).then((v) => v === true);
}

function promptDialog(title, message, placeholder = "") {
  return openModal({ title, message, confirmLabel: "OK", input: { placeholder } });
}

function emptyTableRow(tbody, colSpan, message) {
  tbody.innerHTML = `<tr><td colspan="${colSpan}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
}

function statusBadge(status) {
  if (!status) return "";
  let cls = "info";
  if (status.startsWith("Error")) cls = "danger";
  else if (status === "Up To Date") cls = "success";
  else if (status === "New Version Available") cls = "info";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function injectUxStyles() {
  const style = document.createElement("style");
  style.id = "ux-injected-styles";
  style.textContent = `
#ux-toasts { position: fixed; top: 12px; right: 12px; z-index: 9999; display: flex; flex-direction: column; gap: 8px; max-width: 360px; }
.ux-toast { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 6px; background: #2b2b2b; color: #eee; box-shadow: 0 4px 14px rgba(0,0,0,.35); font-size: 13px; opacity: 0; transform: translateX(24px); transition: opacity .25s ease, transform .25s ease; border-left: 4px solid #4a9eff; }
.ux-toast.show { opacity: 1; transform: translateX(0); }
.ux-toast-success { border-left-color: #3fb950; }
.ux-toast-error { border-left-color: #f85149; }
.ux-toast-info { border-left-color: #4a9eff; }
.ux-toast-text { flex: 1; word-break: break-word; }
.ux-toast-close { background: none; border: none; color: inherit; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; opacity: .7; }
.ux-toast-close:hover { opacity: 1; }
.ux-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 9998; display: flex; align-items: center; justify-content: center; }
.ux-modal { background: #1f1f1f; color: #eee; border-radius: 8px; padding: 20px; width: 380px; max-width: 90vw; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
.ux-modal h3 { margin: 0 0 8px; font-size: 16px; }
.ux-modal-msg { margin: 0 0 16px; font-size: 13px; color: #ccc; white-space: pre-wrap; }
.ux-modal-input { width: 100%; box-sizing: border-box; margin: 0 0 16px; padding: 6px 8px; background: #111; color: #eee; border: 1px solid #444; border-radius: 4px; }
.ux-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ux-modal-actions button { padding: 6px 14px; border-radius: 4px; border: 1px solid #555; background: #333; color: #eee; cursor: pointer; }
.ux-modal-actions button:hover { background: #444; }
.ux-modal-actions button.primary { background: #2f6fdb; border-color: #2f6fdb; }
.ux-modal-actions button.primary:hover { background: #3a7de8; }
.ux-modal-actions button.danger { background: #b3261e; border-color: #b3261e; }
.ux-modal-actions button.danger:hover { background: #c93a32; }
button.is-busy { position: relative; opacity: .65; cursor: wait; }
button.is-busy::after { content: ""; position: absolute; width: 12px; height: 12px; top: 50%; left: 50%; margin: -6px 0 0 -6px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%; animation: ux-spin .7s linear infinite; pointer-events: none; }
@keyframes ux-spin { to { transform: rotate(360deg); } }
`;
  document.head.appendChild(style);
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
  if (tab === "trovesaurus") { loadMailCard(); loadNews(); loadCalendar(); loadStreams(); }
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
  if (!state.myMods.length) {
    emptyTableRow(tbody, 8, "No mods installed — add some from Get More Mods.");
    return;
  }
  for (const mod of state.myMods) {
    const tr = document.createElement("tr");
    const isSelected = state.selectedMyMod === mod.filePath;
    if (isSelected) tr.classList.add("selected");
    const version = mod.downloads?.find((d) => d.fileid === mod.currentFileId)?.version ?? "";
    tr.innerHTML = `
      <td><input type="checkbox" class="mm-enabled" ${mod.enabled ? "checked" : ""} /></td>
      <td>${escapeHtml(mod.name)}</td>
      <td>${escapeHtml(mod.author)}</td>
      <td>${escapeHtml(mod.type)}${mod.subtype ? " / " + escapeHtml(mod.subtype) : ""}</td>
      <td>${escapeHtml(version)}</td>
      <td>${formatDate(mod.unixTimeSeconds)}</td>
      <td class="${statusClass(mod.status)}">${statusBadge(mod.status)}</td>
      <td><input type="checkbox" class="mm-updates-disabled" ${mod.updatesDisabled ? "checked" : ""} /></td>`;
    tr.querySelector(".mm-enabled").addEventListener("change", async (e) => {
      e.stopPropagation();
      try {
        state.myMods = await run("set_mod_enabled", { filePath: mod.filePath, enabled: e.target.checked });
      } catch {
        e.target.checked = mod.enabled;
      }
      renderMyMods();
    });
    tr.querySelector(".mm-updates-disabled").addEventListener("change", async (e) => {
      e.stopPropagation();
      state.myMods = await run("set_mod_updates_disabled", { filePath: mod.filePath, disabled: e.target.checked });
      renderMyMods();
    });
    tr.addEventListener("click", () => {
      state.selectedMyMod = isSelected ? null : mod.filePath;
      renderMyMods();
      if (!isSelected) renderMyModDetail(mod);
    });
    tbody.appendChild(tr);
    if (isSelected) {
      const detailTr = document.createElement("tr");
      detailTr.className = "mm-detail-row";
      detailTr.innerHTML = `<td colspan="8"><div class="mm-detail-content muted">Loading…</div></td>`;
      tbody.appendChild(detailTr);
    }
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
  const container = $(".mm-detail-row .mm-detail-content");
  if (!container) return;
  let files = [];
  try { files = await run("get_mod_files", { filePath: mod.filePath }, { silent: true }); } catch {}
  const img = mod.image_full && !mod.image_full.endsWith("modconstruction.jpg")
    ? `<img class="detail-img" src="${escapeHtml(mod.image_full)}" />` : "";
  container.classList.remove("muted");
  container.innerHTML = `
    <h3>${escapeHtml(mod.name)} ${mod.id ? `<a data-url="https://trovesaurus.com/mod.php?id=${mod.id}">(view on Trovesaurus)</a>` : ""}</h3>
    ${img}
    <p>${escapeHtml(cleanNotes(mod))}</p>
    ${files.length ? `<details><summary>Files (${files.length})</summary><ul>${files.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></details>` : ""}`;
}

function selectedMod() {
  return state.myMods.find((m) => m.filePath === state.selectedMyMod);
}

function setupMyMods() {
  $("#mm-add").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const path = await run("pick_mod_file", {}, { silent: true });
    if (!path) return;
    setStatus("Adding mod...");
    state.myMods = await run("add_mod", { path });
    renderMyMods();
    setStatus("Mod added");
    toast("Mod added", "success");
  }));
  $("#mm-remove").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const mod = selectedMod();
    if (!mod) return setStatus("Select a mod first");
    const ok = await confirmAction(`Remove "${mod.name}"? This will delete the mod file.`, "Remove Mod");
    if (!ok) return;
    state.myMods = await run("remove_mod", { filePath: mod.filePath });
    state.selectedMyMod = null;
    renderMyMods();
    setStatus(`Removed ${mod.name}`);
    toast(`Removed ${mod.name}`, "success");
  }));
  $("#mm-update").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const mod = selectedMod();
    if (!mod) return setStatus("Select a mod first");
    setStatus(`Updating ${mod.name}...`);
    state.myMods = await run("update_mod", { filePath: mod.filePath, fileId: null });
    const updated = state.myMods.find((m) => m.id && m.id === mod.id) ?? state.myMods.find((m) => m.name === mod.name);
    if (updated) {
      state.selectedMyMod = updated.filePath;
      renderMyModDetail(updated);
    }
    renderMyMods();
    setStatus(`Updated ${mod.name}`);
    toast(`Updated ${mod.name}`, "success");
  }));
  $("#mm-update-file").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const mod = selectedMod();
    if (!mod) return setStatus("Select a mod first");
    const path = await run("pick_mod_file", {}, { silent: true });
    if (!path) return;
    state.myMods = await run("update_mod_path", { filePath: mod.filePath, newFilePath: path });
    renderMyMods();
    setStatus(`Updated ${mod.name} from file`);
    toast(`Updated ${mod.name} from file`, "success");
  }));
  $("#mm-check").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    setStatus("Checking for updates...");
    state.myMods = await run("check_all_updates");
    renderMyMods();
    setStatus("Finished checking for updates");
    toast("Finished checking for updates", "info");
  }));
  $("#mm-copy-uri").addEventListener("click", async () => {
    const mod = selectedMod();
    if (!mod) return setStatus("Select a mod first");
    const uri = await run("copy_mod_uri", { filePath: mod.filePath });
    setStatus(`Copied: ${uri}`);
    toast("Mod URI copied to clipboard", "info");
  });
  $("#mm-open-folder").addEventListener("click", async () => {
    const folder = await run("get_mods_folder");
    await run("open_folder", { path: folder });
  });
  $("#mm-remove-overrides").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const ok = await confirmAction("Remove all override folders? Mod files inside them will be deleted.", "Remove Override Folders");
    if (!ok) return;
    const count = await run("remove_override_folders");
    state.myMods = await run("get_my_mods");
    renderMyMods();
    setStatus(`Removed ${count} override folder(s)`);
    toast(`Removed ${count} override folder(s)`, "success");
  }));
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

const GM_PAGE_SIZE = 100;
let gmDisplayCount = GM_PAGE_SIZE;

function renderRemoteMods(showMore = false) {
  if (!showMore) gmDisplayCount = GM_PAGE_SIZE;
  const search = $("#gm-search").value.toLowerCase();
  const type = $("#gm-type").value;
  const subtype = $("#gm-subtype").value;
  const sort = $("#gm-sort").value;

  let mods = state.trovesaurusMods.filter((m) => {
    if (type && m.type !== type) return false;
    if (subtype && m.subtype !== subtype) return false;
    if (search && !`${m.name} ${m.author} ${m.type} ${m.subtype}`.toLowerCase().includes(search)) return false;
    return true;
  });

  mods.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "date") return Number(b.date) - Number(a.date);
    return Number(b[sort]) - Number(a[sort]);
  });
  state.gmFiltered = mods;

  const tbody = $("#gm-table tbody");
  if (!mods.length) {
    tbody.innerHTML = "";
    emptyTableRow(tbody, 7, state.trovesaurusMods.length
      ? "No mods match your search or filters."
      : "No mods loaded — hit Refresh to fetch the Trovesaurus list.");
    return;
  }

  const installed = new Set(state.myMods.map((m) => m.id));
  const limit = Math.min(gmDisplayCount, mods.length);
  const rows = [];
  for (let i = 0; i < limit; i++) {
    const mod = mods[i];
    const img = mod.image ? `<img class="mod-thumb" loading="lazy" src="${escapeHtml(mod.image)}" />` : "";
    rows.push(`
      <tr data-idx="${i}"${mod.id && mod.id === state.selectedRemoteMod ? ' class="selected"' : ""}>
        <td>${img}</td>
        <td>${escapeHtml(mod.name)}</td>
        <td>${escapeHtml(mod.author)}</td>
        <td>${escapeHtml(mod.type)}${mod.subtype ? " / " + escapeHtml(mod.subtype) : ""}</td>
        <td>${mod.votes}</td>
        <td>${mod.totaldownloads}</td>
        <td><button class="gm-install">${installed.has(mod.id) ? "Reinstall" : "Install"}</button></td>
      </tr>`);
  }
  if (limit < mods.length) {
    rows.push(`
      <tr class="gm-show-more"><td colspan="7">
        <button class="gm-show-more-btn">Show more — ${limit} of ${mods.length} shown</button>
      </td></tr>`);
  }
  tbody.innerHTML = rows.join("");

  if (!showMore) {
    const toShow = mods.find((m) => m.id && m.id === state.selectedRemoteMod) ?? mods[0];
    if (toShow) renderRemoteModDetail(toShow);
  }
}

function renderRemoteModDetail(mod) {
  state.selectedRemoteMod = mod.id;
  const panel = $("#gm-detail");
  const img = mod.image_full && !mod.image_full.endsWith("modconstruction.jpg")
    ? `<img class="detail-img" src="${escapeHtml(mod.image_full)}" />` : "";
  const downloads = (mod.downloads ?? []).slice().sort((a, b) => Number(b.fileid) - Number(a.fileid));
  panel.innerHTML = `
    <h3>${escapeHtml(mod.name)}</h3>
    <p class="muted">by ${escapeHtml(mod.author)} | ${escapeHtml(mod.type)}${mod.subtype ? " / " + escapeHtml(mod.subtype) : ""}
      | ${mod.votes} votes | ${mod.totaldownloads} downloads</p>
    ${img}
    <p>${escapeHtml(plainText(mod.description))}</p>
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
    btn.addEventListener("click", () => withBusy(btn, async () => {
      setStatus(`Installing ${mod.name}...`);
      state.myMods = await run("install_trovesaurus_mod", { id: mod.id, fileId: btn.dataset.fileid });
      renderMyMods();
      renderRemoteMods();
      setStatus(`Installed ${mod.name}`);
      toast(`Installed ${mod.name}`, "success");
    }));
  });
}

function setupGetMoreMods() {
  $("#gm-refresh").addEventListener("click", (e) => withBusy(e.currentTarget, () => loadTrovesaurusMods(true)));
  const debouncedRender = debounce(renderRemoteMods, 300);
  $("#gm-search").addEventListener("input", () => debouncedRender());
  $("#gm-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") renderRemoteMods();
  });
  $("#gm-type").addEventListener("change", () => renderRemoteMods());
  $("#gm-subtype").addEventListener("change", () => renderRemoteMods());
  $("#gm-sort").addEventListener("change", () => renderRemoteMods());
  $("#gm-table tbody").addEventListener("click", (e) => {
    const showMoreBtn = e.target.closest(".gm-show-more-btn");
    if (showMoreBtn) {
      gmDisplayCount += GM_PAGE_SIZE;
      renderRemoteMods(true);
      return;
    }
    const tr = e.target.closest("tr[data-idx]");
    if (!tr) return;
    const mod = state.gmFiltered?.[Number(tr.dataset.idx)];
    if (!mod) return;
    const installBtn = e.target.closest(".gm-install");
    if (installBtn) {
      e.stopPropagation();
      withBusy(installBtn, async () => {
        setStatus(`Installing ${mod.name}...`);
        state.myMods = await run("install_trovesaurus_mod", { id: mod.id, fileId: "" });
        renderMyMods();
        renderRemoteMods(true);
        setStatus(`Installed ${mod.name}`);
        toast(`Installed ${mod.name}`, "success");
      });
      return;
    }
    renderRemoteModDetail(mod);
    $$("#gm-table tbody tr.selected").forEach((r) => r.classList.remove("selected"));
    tr.classList.add("selected");
  });
}

// ---------------- Mod Packs ----------------

async function loadModPacks() {
  setStatus("Loading mod packs...");
  try {
    state.remotePacks = await run("get_mod_packs", {}, { silent: true });
  } catch {
    state.remotePacks = [];
  }
  renderRemotePacks();
  setStatus(`Loaded ${state.remotePacks.length} mod packs`);
}

function renderRemotePacks() {
  const list = $("#mp-remote-list");
  list.innerHTML = "";
  if (!state.remotePacks.length) {
    list.innerHTML = `<div class="empty-state">No mod packs found on Trovesaurus.</div>`;
    return;
  }
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
    card.querySelector(".mp-install").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
      setStatus(`Installing pack ${pack.name}...`);
      state.myMods = await run("install_mod_pack", { pack });
      renderMyMods();
      setStatus(`Installed pack ${pack.name}`);
      toast(`Installed pack ${pack.name}`, "success");
    }));
    card.querySelector(".mp-copy").addEventListener("click", async () => {
      const uri = await run("copy_mod_pack_uri", { pack });
      setStatus(`Copied: ${uri}`);
      toast("Mod pack URI copied to clipboard", "info");
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
  if (!state.localPacks.length) {
    list.innerHTML = `<div class="empty-state">No local mod packs — create one from your installed mods.</div>`;
    return;
  }
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
    card.querySelector(".mp-install").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
      setStatus(`Installing pack ${pack.name}...`);
      state.myMods = await run("install_mod_pack", { pack });
      renderMyMods();
      setStatus(`Installed pack ${pack.name}`);
      toast(`Installed pack ${pack.name}`, "success");
    }));
    card.querySelector(".mp-copy").addEventListener("click", async () => {
      const uri = await run("copy_mod_pack_uri", { pack });
      setStatus(`Copied: ${uri}`);
      toast("Mod pack URI copied to clipboard", "info");
    });
    card.querySelector(".mp-delete").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
      const ok = await confirmAction(`Delete mod pack "${pack.name}"? This cannot be undone.`, "Delete Mod Pack", "Delete");
      if (!ok) return;
      state.localPacks = await run("remove_mod_pack", { name: pack.name });
      renderLocalPacks();
      setStatus(`Deleted mod pack ${pack.name}`);
      toast(`Deleted mod pack ${pack.name}`, "success");
    }));
    list.appendChild(card);
  }
}

function setupModPacks() {
  $("#mp-refresh").addEventListener("click", (e) => withBusy(e.currentTarget, loadModPacks));
  $("#mp-create").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const candidates = state.myMods.filter((m) => m.id && m.enabled && !m.packName);
    if (!candidates.length) return setStatus("No enabled unpackaged mods with Trovesaurus IDs");
    const name = await promptDialog("Create Mod Pack", "Enter a name for the new mod pack:", "My Mod Pack");
    if (!name) return;
    state.localPacks = await run("create_mod_pack", { name, modIds: candidates.map((m) => m.id) });
    renderLocalPacks();
    setStatus(`Created mod pack ${name}`);
    toast(`Created mod pack ${name}`, "success");
  }));
}

// ---------------- Trovesaurus ----------------

async function loadMailCard() {
  const container = $("#ts-status");
  container.innerHTML = "";
  try {
    const mail = await run("get_mail_count", {}, { silent: true });
    if (mail > 0) container.innerHTML = `<div class="status-card"><div class="name">Trovesaurus Mail</div><div class="value">${mail} unread</div></div>`;
  } catch {}
}

async function loadNews() {
  const list = $("#ts-news");
  try {
    const news = await run("get_news", {}, { silent: true });
    list.innerHTML = news.length ? news.map((n) => `
      <div class="card">
        <h4><a data-url="${escapeHtml(n.url)}">${escapeHtml(n.title)}</a></h4>
        <p class="muted">by ${escapeHtml(n.author)} | ${formatDate(n.date)} | ${escapeHtml(n.views)} views | ${escapeHtml(n.comments)} comments</p>
        <p>${escapeHtml(plainText(n.preview).slice(0, 240))}</p>
      </div>`).join("") : `<div class="empty-state">No news articles right now.</div>`;
  } catch {
    list.innerHTML = `<p class="muted">News unavailable.</p>`;
  }
}

async function loadCalendar() {
  const list = $("#ts-calendar");
  try {
    const items = (await run("get_calendar", {}, { silent: true })).slice()
      .sort((a, b) => Number(a.enddate) - Number(b.enddate));
    list.innerHTML = items.length ? items.map((c) => `
      <div class="card">
        <h4><a data-url="${escapeHtml(c.url)}">${escapeHtml(c.name)}</a></h4>
        <p class="muted">${formatDate(c.startdate)} - ${formatDate(c.enddate)}</p>
      </div>`).join("") : `<div class="empty-state">No upcoming events.</div>`;
  } catch {
    list.innerHTML = `<p class="muted">Calendar unavailable.</p>`;
  }
}

async function loadStreams() {
  const list = $("#ts-streams");
  try {
    const streams = await run("get_streams", {}, { silent: true });
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
  $("#ts-news-refresh").addEventListener("click", (e) => withBusy(e.currentTarget, loadNews));
  $("#ts-calendar-refresh").addEventListener("click", (e) => withBusy(e.currentTarget, loadCalendar));
  $("#ts-streams-refresh").addEventListener("click", (e) => withBusy(e.currentTarget, loadStreams));
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
  $("#ar-folders").innerHTML = folders.length
    ? folders.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("")
    : `<option disabled>No archive folders found</option>`;
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
  $("#md-save-yaml").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const details = yamlDetailsFromForm();
    const folder = await run("get_mods_folder");
    const safe = details.title.replace(/[/\\:*?"<>|]/g, "");
    await run("save_yaml", { details, path: `${folder}/${safe}.yaml` });
    setStatus(`Saved YAML: ${safe}.yaml`);
    toast(`Saved YAML: ${safe}.yaml`, "success");
  }));
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
  $("#md-build").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const details = yamlDetailsFromForm();
    const folder = await run("get_mods_folder");
    const safe = details.title.replace(/[/\\:*?"<>|]/g, "");
    const yamlPath = `${folder}/${safe}.yaml`;
    await run("save_yaml", { details, path: yamlPath });
    setStatus("Building TMod (running Trove dev tool)...");
    const output = await run("run_dev_tool", { commandLineArgs: `-tool buildmod -meta "${yamlPath}"` });
    $("#md-output").textContent = output;
    setStatus("Build complete");
    toast("TMod build complete", "success");
  }));
  $("#ex-pick-file").addEventListener("click", async () => {
    const files = await run("pick_files", { filters: ["tmod"] });
    if (files.length) $("#ex-file").value = files[0];
  });
  $("#ex-pick-folder").addEventListener("click", async () => {
    const folder = await run("pick_folder");
    if (folder) $("#ex-folder").value = folder;
  });
  $("#ex-run").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
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
      toast(`Extracted to ${folder}`, "success");
    } finally {
      $("#ex-progress").classList.add("hidden");
    }
  }));
  $("#ar-refresh").addEventListener("click", (e) => withBusy(e.currentTarget, loadExtractableFolders));
  $("#ar-extract-all").addEventListener("click", (e) => withBusy(e.currentTarget, () => extractArchives([...$("#ar-folders").options].filter((o) => !o.disabled).map((o) => o.value))));
  $("#ar-extract-selected").addEventListener("click", (e) => withBusy(e.currentTarget, () => extractArchives([...$("#ar-folders").selectedOptions].map((o) => o.value))));
  $("#ar-list-contents").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const selected = [...$("#ar-folders").selectedOptions].map((o) => o.value);
    if (!selected.length) return setStatus("Select archive folders first");
    for (const folder of selected) {
      const output = await run("run_dev_tool", { commandLineArgs: `-tool listarchive "${folder}"` });
      $("#md-output").textContent = output;
    }
  }));
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
  toast("Archive extraction complete", "success");
}

// ---------------- Settings ----------------

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  $("#st-key").value = s.trovesaurus_account_link_key ?? "";
  $("#st-auto-update").checked = !!s.auto_update_mods;
  $("#st-game-status").checked = !!s.update_trove_game_status;
  $("#st-check-mail").checked = !!s.trovesaurus_check_mail;
  $("#st-start-min").checked = !!s.start_minimized;
  $("#st-min-tray").checked = !!s.minimize_to_tray;
  $("#st-interval").value = s.auto_update_interval_hours ?? 1;
  renderLocations();
}

function renderLocations() {
  const tbody = $("#st-locations tbody");
  tbody.innerHTML = "";
  if (!state.settings.locations.length) {
    emptyTableRow(tbody, 5, "No Trove locations configured — add one or use Auto-Detect.");
    return;
  }
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
  $("#st-detect").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    state.settings.locations = await run("detect_locations");
    renderLocations();
    setStatus(`Detected ${state.settings.locations.length} location(s)`);
    toast(`Detected ${state.settings.locations.length} location(s)`, "info");
  }));
  $("#st-save").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const s = state.settings;
    s.trovesaurus_account_link_key = $("#st-key").value.trim();
    s.auto_update_mods = $("#st-auto-update").checked;
    s.update_trove_game_status = $("#st-game-status").checked;
    s.trovesaurus_check_mail = $("#st-check-mail").checked;
    s.start_minimized = $("#st-start-min").checked;
    s.minimize_to_tray = $("#st-min-tray").checked;
    s.auto_update_interval_hours = Number($("#st-interval").value) || 1;
    await run("save_settings", { settings: s });
    startAutoUpdateTimer();
    setStatus("Settings saved");
    toast("Settings saved", "success");
  }));
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
    toast("Mod installed from Trove URI", "success");
    return;
  }

  if (parsed.type === "localMod") {
    state.myMods = await run("add_mod", { path: parsed.fileName });
    renderMyMods();
    setStatus("Mod installed from Trove URI");
    toast("Mod installed from Trove URI", "success");
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
        const resolveMod = (id) => state.trovesaurusMods.find((m) => m.id === id)
          ?? state.myMods.find((m) => m.id === id);
        pack = {
          id: "",
          url: "",
          name: decodeURIComponent(adhoc.groups.name.replace(/\+/g, " ")),
          authorname: "",
          source: "Local",
          mods: modIds.map(resolveMod).filter(Boolean),
        };
      }
    }
    if (pack && pack.mods.length) {
      state.myMods = await run("install_mod_pack", { pack });
      if (!pack.id) {
        state.localPacks = await run("create_mod_pack", { name: pack.name, modIds: pack.mods.map((m) => m.id) });
      }
      renderMyMods();
      setStatus(`Installed mod pack: ${pack.name}`);
      toast(`Installed mod pack: ${pack.name}`, "success");
    } else {
      setStatus("Mod pack not found for Trove URI");
    }
  }
}

// ---------------- Auto update ----------------

let autoUpdateTimer = null;
async function runAutoUpdate() {
  try {
    state.myMods = await run("check_all_updates", {}, { silent: true });
    for (const m of state.myMods.filter((x) => x.enabled && !x.updatesDisabled && x.status === "New Version Available")) {
      setStatus(`Auto-updating ${m.name}...`);
      state.myMods = await run("update_mod", { filePath: m.filePath, fileId: null }, { silent: true });
    }
    renderMyMods();
    setStatus("Auto-update finished");
  } catch {}
}

function startAutoUpdateTimer() {
  clearInterval(autoUpdateTimer);
  autoUpdateTimer = null;
  const s = state.settings;
  if (!s?.auto_update_mods) return;
  const hours = Math.max(1, Number(s.auto_update_interval_hours) || 1);
  autoUpdateTimer = setInterval(runAutoUpdate, hours * 3600 * 1000);
}

// ---------------- About ----------------

async function setupAbout() {
  const version = await run("get_app_version");
  $("#ab-version").textContent = `Version ${version}`;
  $("#ab-check-update").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    const status = $("#ab-update-status");
    status.textContent = "Checking for updates...";
    try {
      status.textContent = await run("check_app_update", {}, { silent: true });
    } catch (e) {
      status.textContent = `Update check failed: ${errText(e)}`;
      toast(`Update check failed: ${errText(e)}`, "error");
    }
  }));
}

// ---------------- Init ----------------

async function init() {
  injectUxStyles();
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

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($(".ux-modal-overlay")) return;
    if (state.selectedMyMod && $("#tab-mymods").classList.contains("active")) {
      state.selectedMyMod = null;
      renderMyMods();
    }
  });

  state.settings = await run("get_settings");
  loadedTabs.add("mymods");
  await loadMyMods();
  startAutoUpdateTimer();
  if (state.settings.auto_update_mods) runAutoUpdate();

  loadedTabs.add("trovesaurus");
  Promise.allSettled([loadMailCard(), loadNews(), loadCalendar(), loadStreams()]);

  const launchUri = await run("get_launch_trove_uri");
  if (launchUri) await handleTroveUri(launchUri).catch(() => {});

  setStatus("Ready");
}

init();
