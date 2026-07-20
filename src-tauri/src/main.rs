#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod mods;
mod settings;
mod tmod;
mod trovesaurus;

use models::*;
use settings::Settings;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    settings: Mutex<Settings>,
    my_mods: Mutex<Option<Vec<TroveMod>>>,
    my_mod_packs: Mutex<Option<Vec<TroveModPack>>>,
    trovesaurus_mods: Mutex<Option<Vec<TroveMod>>>,
    last_mod_list_fetch: Mutex<Option<std::time::Instant>>,
}

impl AppState {
    fn get_my_mods(&self) -> Vec<TroveMod> {
        let mut guard = self.my_mods.lock().unwrap();
        if guard.is_none() {
            let mut loaded = settings::load_my_mods();
            if loaded.is_empty() {
                mods::detect_my_mods(&mut loaded);
                let remote_list = settings::load_trovesaurus_mods_cache();
                let locations = enabled_locations(&self.settings.lock().unwrap());
                for trove_mod in loaded.iter_mut() {
                    if let Some(remote) = mods::find_trovesaurus_mod(trove_mod, &remote_list) {
                        trove_mod.update_properties_from_trovesaurus(remote);
                    }
                    let _ = mods::install_mod(trove_mod, &locations);
                }
                let _ = settings::save_my_mods(&loaded);
            }
            *guard = Some(loaded);
        }
        guard.clone().unwrap()
    }

    fn set_my_mods(&self, mods: Vec<TroveMod>) {
        let _ = settings::save_my_mods(&mods);
        *self.my_mods.lock().unwrap() = Some(mods);
    }

    fn get_my_mod_packs(&self) -> Vec<TroveModPack> {
        let mut guard = self.my_mod_packs.lock().unwrap();
        if guard.is_none() {
            *guard = Some(settings::load_my_mod_packs());
        }
        guard.clone().unwrap()
    }

    fn set_my_mod_packs(&self, packs: Vec<TroveModPack>) {
        let _ = settings::save_my_mod_packs(&packs);
        *self.my_mod_packs.lock().unwrap() = Some(packs);
    }
}

fn log_event(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit("log-message", message.into());
}

fn current_settings(state: &State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

fn enabled_locations(settings: &Settings) -> Vec<TroveLocation> {
    settings.locations.iter().filter(|l| l.enabled).cloned().collect()
}

fn primary_location_path(settings: &Settings) -> Option<PathBuf> {
    settings
        .locations
        .iter()
        .find(|l| l.primary)
        .map(|l| PathBuf::from(&l.location_path))
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    current_settings(&state)
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<(), String> {
    settings::save_settings(&settings)?;
    *state.settings.lock().unwrap() = settings;
    log_event(&app, "Settings saved".to_string());
    Ok(())
}

#[tauri::command]
fn detect_locations(state: State<AppState>) -> Vec<TroveLocation> {
    let mut settings = current_settings(&state);
    settings::detect_locations(&mut settings.locations);
    let _ = settings::save_settings(&settings);
    let locations = settings.locations.clone();
    *state.settings.lock().unwrap() = settings;
    locations
}

#[tauri::command]
fn validate_location(path: String) -> bool {
    Path::new(&path).join("Trove.exe").exists()
}

#[tauri::command]
fn get_mods_folder() -> String {
    settings::mods_folder().to_string_lossy().to_string()
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
async fn get_trovesaurus_mods(state: State<'_, AppState>, refresh: bool) -> Result<Vec<TroveMod>, String> {
    if !refresh {
        if let Some(cached) = state.trovesaurus_mods.lock().unwrap().clone() {
            return Ok(cached);
        }
    } else {
        let throttled = state
            .last_mod_list_fetch
            .lock()
            .unwrap()
            .map(|t| t.elapsed() < std::time::Duration::from_secs(30))
            .unwrap_or(false);
        if throttled {
            if let Some(cached) = state.trovesaurus_mods.lock().unwrap().clone() {
                return Ok(cached);
            }
        }
    }
    match trovesaurus::fetch_mod_list().await {
        Ok(list) => {
            *state.trovesaurus_mods.lock().unwrap() = Some(list.clone());
            *state.last_mod_list_fetch.lock().unwrap() = Some(std::time::Instant::now());
            Ok(list)
        }
        Err(e) => {
            let cached = settings::load_trovesaurus_mods_cache();
            if cached.is_empty() {
                Err(format!("Error refreshing Trovesaurus mod list: {}", e))
            } else {
                *state.trovesaurus_mods.lock().unwrap() = Some(cached.clone());
                Ok(cached)
            }
        }
    }
}

async fn trovesaurus_mod_list(state: &State<'_, AppState>) -> Vec<TroveMod> {
    if let Some(cached) = state.trovesaurus_mods.lock().unwrap().clone() {
        return cached;
    }
    match trovesaurus::fetch_mod_list().await {
        Ok(list) => {
            *state.trovesaurus_mods.lock().unwrap() = Some(list.clone());
            *state.last_mod_list_fetch.lock().unwrap() = Some(std::time::Instant::now());
            list
        }
        Err(_) => {
            let cached = settings::load_trovesaurus_mods_cache();
            if !cached.is_empty() {
                *state.trovesaurus_mods.lock().unwrap() = Some(cached.clone());
            }
            cached
        }
    }
}

async fn trovesaurus_mod_list_fresh(state: &State<'_, AppState>) -> Vec<TroveMod> {
    match trovesaurus::fetch_mod_list().await {
        Ok(list) => {
            *state.trovesaurus_mods.lock().unwrap() = Some(list.clone());
            *state.last_mod_list_fetch.lock().unwrap() = Some(std::time::Instant::now());
            list
        }
        Err(_) => trovesaurus_mod_list(state).await,
    }
}

#[tauri::command]
async fn get_news() -> Result<Vec<NewsItem>, String> {
    trovesaurus::fetch_news().await
}

#[tauri::command]
async fn get_calendar() -> Result<Vec<CalendarItem>, String> {
    trovesaurus::fetch_calendar().await
}

#[tauri::command]
async fn get_streams() -> Result<Vec<OnlineStream>, String> {
    trovesaurus::fetch_streams().await
}

#[tauri::command]
async fn get_mail_count() -> Result<i64, String> {
    trovesaurus::fetch_mail_count().await
}

#[tauri::command]
async fn get_mod_packs(state: State<'_, AppState>) -> Result<Vec<TroveModPack>, String> {
    let mod_list = trovesaurus_mod_list(&state).await;
    trovesaurus::fetch_mod_packs(&mod_list).await
}

#[tauri::command]
async fn get_my_mods(state: State<'_, AppState>) -> Result<Vec<TroveMod>, String> {
    let mods = state.get_my_mods();
    Ok(mods)
}

#[tauri::command]
async fn add_mod(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<Vec<TroveMod>, String> {
    let mut my_mods = state.get_my_mods();
    let file_name = Path::new(&path)
        .file_name()
        .map(|f| f.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if my_mods.iter().any(|m| {
        Path::new(&m.file_path)
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase() == file_name)
            .unwrap_or(false)
    }) {
        return Err("A mod with this file name is already added".to_string());
    }

    let mut trove_mod = mods::load_mod_from_file(Path::new(&path))?;
    mods::add_mod(&mut trove_mod)?;

    let remote_list = trovesaurus_mod_list(&state).await;
    if let Some(remote) = mods::find_trovesaurus_mod(&trove_mod, &remote_list) {
        trove_mod.update_properties_from_trovesaurus(remote);
    }
    let settings = current_settings(&state);
    if let Err(e) = mods::install_mod(&mut trove_mod, &enabled_locations(&settings)) {
        trove_mod.status = mods::error_status(&e);
        log_event(&app, format!("Error installing mod {}: {}", trove_mod.name, e));
        my_mods.push(trove_mod);
        state.set_my_mods(my_mods.clone());
        return Ok(my_mods);
    }
    mods::check_for_updates(&mut trove_mod, &remote_list);

    log_event(&app, format!("Added mod: {}", trove_mod.name));
    my_mods.push(trove_mod);
    state.set_my_mods(my_mods.clone());
    Ok(my_mods)
}

#[tauri::command]
fn remove_mod(app: AppHandle, state: State<AppState>, file_path: String) -> Result<Vec<TroveMod>, String> {
    let mut my_mods = state.get_my_mods();
    let settings = current_settings(&state);
    if let Some(pos) = my_mods.iter().position(|m| m.file_path == file_path) {
        let mut trove_mod = my_mods[pos].clone();
        mods::remove_mod(&mut trove_mod, &enabled_locations(&settings))?;
        log_event(&app, format!("Removed mod: {}", trove_mod.name));
        my_mods.remove(pos);
        state.set_my_mods(my_mods.clone());
    }
    Ok(my_mods)
}

#[tauri::command]
async fn set_mod_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    enabled: bool,
) -> Result<Vec<TroveMod>, String> {
    let remote_list = trovesaurus_mod_list(&state).await;
    let mut my_mods = state.get_my_mods();
    let settings = current_settings(&state);
    if let Some(trove_mod) = my_mods.iter_mut().find(|m| m.file_path == file_path) {
        if trove_mod.enabled != enabled {
            trove_mod.enabled = enabled;
            if enabled {
                mods::install_mod(trove_mod, &enabled_locations(&settings))?;
                log_event(&app, format!("Installed mod: {}", trove_mod.name));
            } else {
                mods::uninstall_mod(trove_mod, &enabled_locations(&settings))?;
                log_event(&app, format!("Uninstalled mod: {}", trove_mod.name));
            }
            mods::check_for_updates(trove_mod, &remote_list);
        }
    }
    state.set_my_mods(my_mods.clone());
    Ok(my_mods)
}

#[tauri::command]
fn set_mod_updates_disabled(
    state: State<AppState>,
    file_path: String,
    disabled: bool,
) -> Result<Vec<TroveMod>, String> {
    let mut my_mods = state.get_my_mods();
    if let Some(trove_mod) = my_mods.iter_mut().find(|m| m.file_path == file_path) {
        trove_mod.updates_disabled = disabled;
    }
    state.set_my_mods(my_mods.clone());
    Ok(my_mods)
}

async fn install_trovesaurus_mod_inner(
    app: &AppHandle,
    state: &AppState,
    id: String,
    file_id: String,
) -> Result<Vec<TroveMod>, String> {
    let remote_list = {
        let cached = state.trovesaurus_mods.lock().unwrap().clone();
        match cached {
            Some(list) => list,
            None => match trovesaurus::fetch_mod_list().await {
                Ok(list) => {
                    *state.trovesaurus_mods.lock().unwrap() = Some(list.clone());
                    list
                }
                Err(_) => settings::load_trovesaurus_mods_cache(),
            },
        }
    };
    let remote = remote_list
        .iter()
        .find(|m| m.id == id)
        .cloned()
        .ok_or_else(|| format!("Mod ID {} not found on Trovesaurus", id))?;

    let file_id = if file_id.is_empty() {
        remote
            .latest_download()
            .map(|d| d.file_id.clone())
            .ok_or_else(|| "No downloads available for this mod".to_string())?
    } else {
        file_id
    };

    log_event(app, format!("Downloading mod: {}", remote.name));
    let local_path = trovesaurus::download_mod(&remote, &file_id).await?;

    let mut my_mods = state.get_my_mods();

    let existing_pos = my_mods.iter().position(|m| m.id == id);
    let mut updates_disabled = false;
    let mut pack_name = String::new();
    if let Some(pos) = existing_pos {
        let mut old = my_mods[pos].clone();
        updates_disabled = old.updates_disabled;
        pack_name = old.pack_name.clone();
        if old.enabled {
            mods::uninstall_mod(&mut old, &enabled_locations(&state.settings.lock().unwrap()))?;
        }
        let old_path = PathBuf::from(&old.file_path);
        if old_path.exists() && old_path.to_string_lossy() != local_path {
            let _ = std::fs::remove_file(&old_path);
        }
    }

    let mut trove_mod = mods::load_mod_from_file(Path::new(&local_path))?;
    trove_mod.update_properties_from_trovesaurus(&remote);
    trove_mod.current_file_id = file_id.clone();
    if let Some(d) = remote.downloads.iter().find(|d| d.file_id == file_id) {
        trove_mod.unix_time_seconds = d.date_seconds();
    }
    trove_mod.enabled = true;
    trove_mod.updates_disabled = updates_disabled;
    trove_mod.pack_name = pack_name;

    mods::install_mod(&mut trove_mod, &enabled_locations(&state.settings.lock().unwrap()))?;
    trove_mod.status = mods::STATUS_UP_TO_DATE.to_string();

    log_event(app, format!("Installed mod: {}", trove_mod.name));
    match existing_pos {
        Some(pos) => my_mods[pos] = trove_mod,
        None => my_mods.push(trove_mod),
    }
    state.set_my_mods(my_mods.clone());
    Ok(my_mods)
}

#[tauri::command]
async fn install_trovesaurus_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    file_id: String,
) -> Result<Vec<TroveMod>, String> {
    install_trovesaurus_mod_inner(&app, &state, id, file_id).await
}

#[tauri::command]
async fn update_mod(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    file_id: Option<String>,
) -> Result<Vec<TroveMod>, String> {
    let remote_list = trovesaurus_mod_list(&state).await;
    let mut my_mods = state.get_my_mods();
    let settings = current_settings(&state);

    let pos = my_mods
        .iter()
        .position(|m| m.file_path == file_path)
        .ok_or_else(|| "Mod not found".to_string())?;
    let mut trove_mod = my_mods[pos].clone();

    let remote = mods::find_trovesaurus_mod(&trove_mod, &remote_list)
        .cloned()
        .ok_or_else(|| "Mod not found on Trovesaurus".to_string())?;

    let target_file_id = file_id
        .filter(|f| !f.is_empty())
        .or_else(|| remote.latest_download().map(|d| d.file_id.clone()))
        .ok_or_else(|| "No downloads available for this mod".to_string())?;

    let old_file = trove_mod.file_path.clone();
    if trove_mod.enabled && !old_file.is_empty() && Path::new(&old_file).exists() {
        mods::uninstall_mod(&mut trove_mod, &enabled_locations(&settings))?;
    }

    log_event(&app, format!("Downloading mod: {}", trove_mod.name));
    trove_mod.status = mods::STATUS_DOWNLOADING.to_string();
    let new_path = trovesaurus::download_mod(&remote, &target_file_id).await?;

    let mut updated = mods::load_mod_from_file(Path::new(&new_path))?;
    updated.update_properties_from_trovesaurus(&remote);
    updated.current_file_id = target_file_id.clone();
    if let Some(d) = remote.downloads.iter().find(|d| d.file_id == target_file_id) {
        updated.unix_time_seconds = d.date_seconds();
    }
    updated.enabled = trove_mod.enabled;
    updated.updates_disabled = trove_mod.updates_disabled;
    updated.pack_name = trove_mod.pack_name.clone();

    if !old_file.is_empty() && old_file != new_path && Path::new(&old_file).exists() {
        let _ = std::fs::remove_file(&old_file);
    }

    if updated.enabled {
        mods::install_mod(&mut updated, &enabled_locations(&settings))?;
    }
    updated.status = mods::STATUS_UP_TO_DATE.to_string();
    log_event(&app, format!("Updated mod: {}", updated.name));

    my_mods[pos] = updated;
    state.set_my_mods(my_mods.clone());
    Ok(my_mods)
}

#[tauri::command]
async fn update_mod_path(
    app: AppHandle,
    state: State<'_, AppState>,
    file_path: String,
    new_file_path: String,
) -> Result<Vec<TroveMod>, String> {
    let remote_list = trovesaurus_mod_list(&state).await;
    let mut my_mods = state.get_my_mods();
    let settings = current_settings(&state);

    let pos = my_mods
        .iter()
        .position(|m| m.file_path == file_path)
        .ok_or_else(|| "Mod not found".to_string())?;
    let mut trove_mod = my_mods[pos].clone();

    let old_file = trove_mod.file_path.clone();
    if trove_mod.enabled && !old_file.is_empty() && Path::new(&old_file).exists() {
        mods::uninstall_mod(&mut trove_mod, &enabled_locations(&settings))?;
    }

    let source = Path::new(&new_file_path);
    let file_name = source.file_name().ok_or_else(|| "Invalid file path".to_string())?;
    let new_path = settings::mods_folder().join(file_name);
    std::fs::copy(source, &new_path).map_err(|e| e.to_string())?;

    if !old_file.is_empty() && old_file != new_path.to_string_lossy() && Path::new(&old_file).exists() {
        let _ = std::fs::remove_file(&old_file);
    }

    let mut updated = mods::load_mod_from_file(&new_path)?;
    updated.enabled = trove_mod.enabled;
    updated.updates_disabled = trove_mod.updates_disabled;
    updated.pack_name = trove_mod.pack_name.clone();
    if let Ok(metadata) = std::fs::metadata(&new_path) {
        if let Ok(modified) = metadata.modified() {
            updated.unix_time_seconds = modified
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(updated.unix_time_seconds);
        }
    }
    if let Some(remote) = mods::find_trovesaurus_mod(&updated, &remote_list) {
        updated.update_properties_from_trovesaurus(remote);
    }

    if updated.enabled {
        mods::install_mod(&mut updated, &enabled_locations(&settings))?;
    } else {
        mods::check_for_updates(&mut updated, &remote_list);
    }
    log_event(&app, format!("Updated mod file: {}", updated.name));

    my_mods[pos] = updated;
    state.set_my_mods(my_mods.clone());
    Ok(my_mods)
}

#[tauri::command]
async fn check_all_updates(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<TroveMod>, String> {
    let remote_list = trovesaurus_mod_list_fresh(&state).await;
    let mut my_mods = state.get_my_mods();
    for trove_mod in my_mods.iter_mut() {
        mods::check_for_updates(trove_mod, &remote_list);
    }
    log_event(&app, "Finished checking mods for updates".to_string());
    state.set_my_mods(my_mods.clone());
    Ok(my_mods)
}

#[tauri::command]
fn get_mod_files(state: State<AppState>, file_path: String) -> Result<Vec<String>, String> {
    let my_mods = state.get_my_mods();
    let trove_mod = my_mods
        .iter()
        .find(|m| m.file_path == file_path)
        .ok_or_else(|| "Mod not found".to_string())?;
    let settings = current_settings(&state);
    mods::mod_files(trove_mod, primary_location_path(&settings).as_deref())
}

#[tauri::command]
fn remove_override_folders(app: AppHandle, state: State<AppState>) -> u32 {
    let settings = current_settings(&state);
    let count = mods::remove_mod_folders(&enabled_locations(&settings));
    let mut my_mods = state.get_my_mods();
    let mut changed = false;
    for trove_mod in my_mods.iter_mut() {
        if trove_mod.enabled {
            trove_mod.enabled = false;
            trove_mod.status = String::new();
            changed = true;
        }
    }
    if changed {
        state.set_my_mods(my_mods);
    }
    log_event(&app, format!("Removed {} override folder(s)", count));
    count
}

#[tauri::command]
fn copy_mod_uri(state: State<AppState>, file_path: String) -> Result<String, String> {
    let my_mods = state.get_my_mods();
    let trove_mod = my_mods
        .iter()
        .find(|m| m.file_path == file_path)
        .ok_or_else(|| "Mod not found".to_string())?;
    if trove_mod.id.is_empty() {
        return Err("Mod ID not found on Trovesaurus".to_string());
    }
    let file_id = if !trove_mod.current_file_id.is_empty() {
        trove_mod.current_file_id.clone()
    } else {
        trove_mod
            .latest_download()
            .map(|d| d.file_id.clone())
            .unwrap_or_default()
    };
    let uri = format!("trove://{};{}", trove_mod.id, file_id);
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(&uri))
        .map_err(|e| e.to_string())?;
    Ok(uri)
}

#[tauri::command]
fn get_my_mod_packs(state: State<AppState>) -> Vec<TroveModPack> {
    state.get_my_mod_packs()
}

#[tauri::command]
fn create_mod_pack(state: State<AppState>, name: String, mod_ids: Vec<String>) -> Result<Vec<TroveModPack>, String> {
    let mut my_mods = state.get_my_mods();
    let mut pack = TroveModPack {
        name: name.clone(),
        source: "Local".to_string(),
        ..Default::default()
    };
    for id in mod_ids {
        if let Some(pos) = my_mods
            .iter()
            .position(|m| m.id == id && m.enabled && !m.id.is_empty())
        {
            my_mods[pos].pack_name = name.clone();
            pack.mods.push(my_mods[pos].clone());
        }
    }
    let mut packs = state.get_my_mod_packs();
    if let Some(existing) = packs
        .iter_mut()
        .find(|p| p.name == name && p.pack_id.is_empty())
    {
        *existing = pack;
    } else {
        packs.push(pack);
    }
    state.set_my_mods(my_mods);
    state.set_my_mod_packs(packs.clone());
    Ok(packs)
}

#[tauri::command]
fn remove_mod_pack(state: State<AppState>, name: String) -> Vec<TroveModPack> {
    let mut packs = state.get_my_mod_packs();
    packs.retain(|p| p.name != name || !p.pack_id.is_empty());
    let mut my_mods = state.get_my_mods();
    let mut changed = false;
    for trove_mod in my_mods.iter_mut() {
        if trove_mod.pack_name == name {
            trove_mod.pack_name = String::new();
            changed = true;
        }
    }
    if changed {
        state.set_my_mods(my_mods);
    }
    state.set_my_mod_packs(packs.clone());
    packs
}

#[tauri::command]
async fn install_mod_pack(
    app: AppHandle,
    state: State<'_, AppState>,
    pack: TroveModPack,
) -> Result<Vec<TroveMod>, String> {
    for trove_mod in &pack.mods {
        if trove_mod.id.is_empty() {
            continue;
        }
        let already_installed = state
            .get_my_mods()
            .iter()
            .any(|m| m.id == trove_mod.id);
        if !already_installed {
            let file_id = trove_mod
                .latest_download()
                .map(|d| d.file_id.clone())
                .unwrap_or_default();
            if file_id.is_empty() {
                continue;
            }
            log_event(&app, format!("Installing mod pack mod: {}", trove_mod.name));
            install_trovesaurus_mod_inner(&app, &state, trove_mod.id.clone(), file_id).await?;
        }
        let mut my_mods = state.get_my_mods();
        if let Some(m) = my_mods.iter_mut().find(|m| m.id == trove_mod.id) {
            m.pack_name = pack.name.clone();
            state.set_my_mods(my_mods);
        }
    }
    Ok(state.get_my_mods())
}

#[tauri::command]
fn copy_mod_pack_uri(pack: TroveModPack) -> Result<String, String> {
    let uri = pack.trove_uri();
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(&uri))
        .map_err(|e| e.to_string())?;
    Ok(uri)
}

#[tauri::command]
fn get_mod_tags() -> serde_json::Value {
    let json = include_str!("resources/ModTags.json");
    serde_json::from_str(json).unwrap_or(serde_json::Value::Array(vec![]))
}

#[tauri::command]
fn save_yaml(details: ModDetails, path: String) -> Result<(), String> {
    details.save_yaml_file(Path::new(&path))
}

#[tauri::command]
fn load_yaml(path: String) -> Result<ModDetails, String> {
    let contents = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    ModDetails::load_from_yaml(&contents)
}

#[tauri::command]
fn read_tmod_properties(path: String) -> Result<std::collections::HashMap<String, String>, String> {
    tmod::read_tmod_properties(Path::new(&path))
}

#[tauri::command]
async fn extract_tmod_command(
    app: AppHandle,
    path: String,
    folder: String,
    create_override_folders: bool,
    create_yaml: bool,
) -> Result<(), String> {
    let tmod_path = PathBuf::from(&path);
    let dest = PathBuf::from(&folder);
    log_event(&app, format!("Extracting TMod: {}", path));
    tauri::async_runtime::spawn_blocking(move || {
        tmod::extract_tmod(&tmod_path, &dest, create_override_folders, create_yaml, |p| {
            let _ = app.emit("extract-progress", p);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_extractable_folders(state: State<AppState>) -> Vec<String> {
    let settings = current_settings(&state);
    match primary_location_path(&settings) {
        Some(base) => mods::extractable_folders(&base),
        None => Vec::new(),
    }
}

#[tauri::command]
fn make_relative_path(full_path: String, state: State<AppState>) -> String {
    let settings = current_settings(&state);
    let base = primary_location_path(&settings).unwrap_or_default();
    mods::make_relative_path(Path::new(&full_path), &base)
}

#[tauri::command]
fn get_override_path(relative_path: String, state: State<AppState>) -> Option<String> {
    let settings = current_settings(&state);
    let base = primary_location_path(&settings)?;
    mods::get_override_path(&relative_path, &base).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn run_dev_tool(state: State<'_, AppState>, command_line_args: String) -> Result<String, String> {
    let settings = current_settings(&state);
    let loc = settings
        .locations
        .iter()
        .find(|l| l.primary)
        .ok_or_else(|| {
            "No primary Trove location set: please update your settings before using the modder tools".to_string()
        })?
        .clone();

    tauri::async_runtime::spawn_blocking(move || {
        let dev_tool_log = dirs::data_dir()
            .unwrap_or_default()
            .join("Trove")
            .join("DevTool.log");

        if dev_tool_log.exists() {
            let modified = std::fs::metadata(&dev_tool_log)
                .and_then(|m| m.modified())
                .ok();
            let stamp = modified
                .map(|t| {
                    let dt: chrono::DateTime<chrono::Local> = t.into();
                    dt.format("%Y-%m-%d.%H-%M-%S").to_string()
                })
                .unwrap_or_default();
            let mut old_log = dev_tool_log.with_file_name(format!("DevTool.{}.log", stamp));
            let mut i = 1;
            while old_log.exists() {
                old_log = dev_tool_log.with_file_name(format!("DevTool.{}.{}.log", stamp, i));
                i += 1;
            }
            let _ = std::fs::rename(&dev_tool_log, &old_log);
        }

        let exe = Path::new(&loc.location_path).join("Trove.exe");
        if !exe.exists() {
            return Err(format!("Trove.exe not found at {}", exe.display()));
        }

        std::process::Command::new(&exe)
            .args(split_command_args(&command_line_args))
            .current_dir(&loc.location_path)
            .status()
            .map_err(|e| e.to_string())?;

        if dev_tool_log.exists() {
            std::fs::read_to_string(&dev_tool_log).map_err(|e| e.to_string())
        } else {
            Ok(format!("Dev Tool ended with no results in {}", dev_tool_log.display()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn pick_mod_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Trove Mods", &["zip", "tmod"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_files(filters: Vec<String>) -> Vec<String> {
    let mut dialog = rfd::FileDialog::new();
    if !filters.is_empty() {
        let refs: Vec<&str> = filters.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter("Files", &refs);
    }
    dialog
        .pick_files()
        .map(|paths| paths.iter().map(|p| p.to_string_lossy().to_string()).collect())
        .unwrap_or_default()
}

#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let resolved = settings::resolve_folder(Path::new(&path));
    open::that(&resolved).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(&text))
        .map_err(|e| e.to_string())
}

fn split_command_args(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in input.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

#[tauri::command]
async fn check_app_update(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            app.restart();
        }
        None => Ok("You are running the latest version".to_string()),
    }
}

#[tauri::command]
fn get_launch_trove_uri() -> Option<String> {
    let re = regex::Regex::new(r"(?i)(?<Uri>trove:[/\\]{0,2}.+)$").ok()?;
    std::env::args().find_map(|arg| re.captures(&arg).map(|c| c["Uri"].to_string()))
}

#[tauri::command]
fn parse_trove_uri_command(uri: String) -> Option<serde_json::Value> {
    parse_trove_uri(&uri)
}

fn parse_trove_uri(uri: &str) -> Option<serde_json::Value> {
    let re_mod = regex::Regex::new(r"(?i)trove:[/\\]{0,2}(?<ModId>\d+);(?<FileId>\d+)").ok()?;
    if let Some(caps) = re_mod.captures(uri) {
        return Some(serde_json::json!({
            "type": "mod",
            "modId": caps["ModId"].to_string(),
            "fileId": caps["FileId"].to_string(),
        }));
    }
    let re_local = regex::Regex::new(r"(?i)trove:[/\\]{0,2}(?<FileName>.+\.(?:zip|tmod))[/\\]?").ok()?;
    if let Some(caps) = re_local.captures(uri) {
        return Some(serde_json::json!({
            "type": "localMod",
            "fileName": caps["FileName"].to_string(),
        }));
    }
    let re_pack = regex::Regex::new(r"(?i)trove:[/\\]{0,2}modpack=(?<PackId>\d+)").ok()?;
    if let Some(caps) = re_pack.captures(uri) {
        return Some(serde_json::json!({
            "type": "modPack",
            "packId": caps["PackId"].to_string(),
            "uri": uri,
        }));
    }
    let re_adhoc = regex::Regex::new(r"(?i)trove:[/\\]{0,2}(?<Name>[^?]+?)/?\?(?<Mods>[0-9&]+)").ok()?;
    if re_adhoc.is_match(uri) {
        return Some(serde_json::json!({
            "type": "modPack",
            "uri": uri,
        }));
    }
    None
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            for arg in args {
                if let Some(caps) = regex::Regex::new(r"(?i)(?<Uri>trove:[/\\]{0,2}.+)$")
                    .ok()
                    .and_then(|re| re.captures(&arg))
                {
                    let _ = app.emit("trove-uri", caps["Uri"].to_string());
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            settings: Mutex::new({
                let mut s = settings::load_settings();
                if s.locations.is_empty() {
                    settings::detect_locations(&mut s.locations);
                } else if !s.locations.iter().any(|l| l.primary) {
                    s.locations[0].primary = true;
                }
                let _ = settings::save_settings(&s);
                s
            }),
            my_mods: Mutex::new(None),
            my_mod_packs: Mutex::new(None),
            trovesaurus_mods: Mutex::new(None),
            last_mod_list_fetch: Mutex::new(None),
        })
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri_plugin_deep_link::DeepLinkExt;

            #[cfg(target_os = "windows")]
            if let Err(e) = app.deep_link().register_all() {
                eprintln!("Error registering trove:// protocol: {}", e);
            }

            let deep_link_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let _ = deep_link_handle.emit("trove-uri", url.to_string());
                }
            });

            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().ok_or("No window icon")?)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let start_minimized = settings::load_settings().start_minimized;
            if start_minimized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            let state = window.app_handle().state::<AppState>();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if state.settings.lock().unwrap().minimize_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    if state.settings.lock().unwrap().minimize_to_tray {
                        if let Ok(true) = window.is_minimized() {
                            let _ = window.hide();
                        }
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            detect_locations,
            validate_location,
            get_mods_folder,
            get_app_version,
            get_trovesaurus_mods,
            get_news,
            get_calendar,
            get_streams,
            get_mail_count,
            get_mod_packs,
            get_my_mods,
            add_mod,
            remove_mod,
            set_mod_enabled,
            set_mod_updates_disabled,
            install_trovesaurus_mod,
            update_mod,
            update_mod_path,
            check_all_updates,
            get_mod_files,
            remove_override_folders,
            copy_mod_uri,
            get_my_mod_packs,
            create_mod_pack,
            remove_mod_pack,
            install_mod_pack,
            copy_mod_pack_uri,
            get_mod_tags,
            save_yaml,
            load_yaml,
            read_tmod_properties,
            extract_tmod_command,
            get_extractable_folders,
            make_relative_path,
            get_override_path,
            run_dev_tool,
            pick_mod_file,
            pick_files,
            pick_folder,
            open_url,
            open_folder,
            copy_to_clipboard,
            check_app_update,
            parse_trove_uri_command,
            get_launch_trove_uri,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
