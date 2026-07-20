use crate::models::{TroveLocation, TroveMod, TroveModPack};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub locations: Vec<TroveLocation>,
    pub trovesaurus_account_link_key: String,
    pub auto_update_mods: bool,
    pub auto_update_interval_hours: u64,
    pub start_minimized: bool,
    pub minimize_to_tray: bool,
    pub update_trove_game_status: bool,
    pub trovesaurus_check_mail: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            locations: Vec::new(),
            trovesaurus_account_link_key: String::new(),
            auto_update_mods: false,
            auto_update_interval_hours: 1,
            start_minimized: false,
            minimize_to_tray: false,
            update_trove_game_status: true,
            trovesaurus_check_mail: false,
        }
    }
}

pub fn app_data_folder() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let folder = base.join("TroveUp");
    resolve_folder(&folder)
}

pub fn mods_folder() -> PathBuf {
    resolve_folder(&app_data_folder().join("mods"))
}

pub fn trove_toolbox_mods_folder() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let folder = base.join("Trove Toolbox").join("mods");
    if folder.is_dir() {
        Some(folder)
    } else {
        None
    }
}

pub fn trove_tools_dotnet_mods_folder() -> Option<PathBuf> {
    let base = dirs::data_dir()?;
    let folder = base.join("TroveTools.NET").join("mods");
    if folder.is_dir() {
        Some(folder)
    } else {
        None
    }
}

pub fn resolve_folder(path: &std::path::Path) -> PathBuf {
    if !path.exists() {
        let _ = std::fs::create_dir_all(path);
    }
    path.to_path_buf()
}

pub fn get_safe_filename(filename: &str) -> String {
    filename
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect()
}

fn settings_path() -> PathBuf {
    app_data_folder().join("settings.json")
}

fn my_mods_path() -> PathBuf {
    app_data_folder().join("mymods.json")
}

fn trovesaurus_mods_cache_path() -> PathBuf {
    app_data_folder().join("trovesaurus_mods_cache.json")
}

fn my_mod_packs_path() -> PathBuf {
    app_data_folder().join("mymodpacks.json")
}

pub fn load_settings() -> Settings {
    match std::fs::read_to_string(settings_path()) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), json).map_err(|e| e.to_string())
}

pub fn load_my_mods() -> Vec<TroveMod> {
    match std::fs::read_to_string(my_mods_path()) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_my_mods(mods: &[TroveMod]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(mods).map_err(|e| e.to_string())?;
    std::fs::write(my_mods_path(), json).map_err(|e| e.to_string())
}

pub fn load_trovesaurus_mods_cache() -> Vec<TroveMod> {
    match std::fs::read_to_string(trovesaurus_mods_cache_path()) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_trovesaurus_mods_cache(mods: &[TroveMod]) {
    if let Ok(json) = serde_json::to_string(mods) {
        let _ = std::fs::write(trovesaurus_mods_cache_path(), json);
    }
}

pub fn load_my_mod_packs() -> Vec<TroveModPack> {
    match std::fs::read_to_string(my_mod_packs_path()) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_my_mod_packs(packs: &[TroveModPack]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(packs).map_err(|e| e.to_string())?;
    std::fs::write(my_mod_packs_path(), json).map_err(|e| e.to_string())
}

pub fn detect_locations(existing: &mut Vec<TroveLocation>) {
    let mut potential: Vec<(PathBuf, String)> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
        for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
                let base = RegKey::predef(hive);
                let Ok(uninstall) = base.open_subkey_with_flags(UNINSTALL, KEY_READ | view) else {
                    continue;
                };
                for key_name in uninstall.enum_keys().flatten() {
                    if key_name.starts_with("Glyph Trove") {
                        if let Ok(key) = uninstall.open_subkey(&key_name) {
                            if let Ok(path) = key.get_value::<String, _>("InstallLocation") {
                                let name = format!("{} (Glyph)", key_name.replace("Glyph ", ""));
                                potential.push((PathBuf::from(path), name));
                            }
                        }
                    }
                }
                if let Ok(key) = uninstall.open_subkey("Steam App 304050") {
                    if let Ok(path) = key.get_value::<String, _>("InstallLocation") {
                        let p = PathBuf::from(path);
                        potential.push((p.join("Live"), "Trove Live (Steam)".into()));
                        potential.push((p.join(r"Games\Trove\Live"), "Trove Live (Steam)".into()));
                        potential.push((p.join("PTS"), "Trove PTS (Steam)".into()));
                        potential.push((p.join(r"Games\Trove\PTS"), "Trove PTS (Steam)".into()));
                    }
                }
            }
        }

        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
        for pf in [program_files_x86, program_files] {
            if pf.is_empty() {
                continue;
            }
            let pf = PathBuf::from(pf);
            potential.push((pf.join(r"Glyph\Games\Trove\Live"), "Trove Live (Glyph)".into()));
            potential.push((pf.join(r"Glyph\Games\Trove\PTS"), "Trove PTS (Glyph)".into()));
            potential.push((pf.join(r"Steam\steamapps\common\Trove\Live"), "Trove Live (Steam)".into()));
            potential.push((pf.join(r"Steam\steamapps\common\Trove\Games\Trove\Live"), "Trove Live (Steam)".into()));
            potential.push((pf.join(r"Steam\steamapps\common\Trove\PTS"), "Trove PTS (Steam)".into()));
            potential.push((pf.join(r"Steam\steamapps\common\Trove\Games\Trove\PTS"), "Trove PTS (Steam)".into()));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            potential.push((
                home.join("Library/Application Support/Steam/steamapps/common/Trove/Live"),
                "Trove Live (Steam)".into(),
            ));
            potential.push((
                home.join("Library/Application Support/Steam/steamapps/common/Trove/PTS"),
                "Trove PTS (Steam)".into(),
            ));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            potential.push((
                home.join(".steam/steam/steamapps/common/Trove/Live"),
                "Trove Live (Steam)".into(),
            ));
            potential.push((
                home.join(".local/share/Steam/steamapps/common/Trove/Live"),
                "Trove Live (Steam)".into(),
            ));
        }
    }

    for (path, name) in potential {
        if path.join("Trove.exe").exists() || path.join("trove").exists() {
            let path_str = path.to_string_lossy().to_string();
            if !existing
                .iter()
                .any(|l| l.location_path.to_lowercase() == path_str.to_lowercase())
            {
                existing.push(TroveLocation {
                    location_name: name,
                    location_path: path_str,
                    enabled: true,
                    primary: false,
                });
            }
        }
    }

    if !existing.is_empty() && !existing.iter().any(|l| l.primary) {
        existing[0].primary = true;
    }
}
