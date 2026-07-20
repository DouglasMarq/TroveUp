use crate::models::TroveMod;
use crate::settings;
use crate::tmod;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub const OVERRIDE_FOLDER: &str = "override";
pub const MODS_FOLDER: &str = "mods";
pub const INDEX_FILE: &str = "index.tfi";

pub const STATUS_DOWNLOADING: &str = "Downloading";
pub const STATUS_INSTALLING: &str = "Installing";
pub const STATUS_NEW_VERSION: &str = "New Version Available";
pub const STATUS_UP_TO_DATE: &str = "Up To Date";

pub fn error_status(message: &str) -> String {
    format!("Error: {}", message)
}

static FOLDERS_BY_EXTENSION: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    let json = include_str!("resources/TroveFoldersByExtension.json");
    serde_json::from_str(json).unwrap_or_default()
});

pub fn load_mod_from_file(file_path: &Path) -> Result<TroveMod, String> {
    let mut trove_mod = TroveMod {
        file_path: file_path.to_string_lossy().to_string(),
        enabled: true,
        ..Default::default()
    };

    let stem = file_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let re = regex::Regex::new(r"^(?<Name>.*?)(?:\+(?<UnixTimeSeconds>\d+))?$").unwrap();
    if let Some(caps) = re.captures(&stem) {
        trove_mod.name = caps["Name"].to_string();
        if let Some(m) = caps.name("UnixTimeSeconds") {
            trove_mod.unix_time_seconds = m.as_str().parse().unwrap_or(0);
        }
    } else {
        trove_mod.name = stem;
    }

    if trove_mod.unix_time_seconds == 0 {
        if let Ok(metadata) = std::fs::metadata(file_path) {
            if let Ok(modified) = metadata.modified() {
                trove_mod.unix_time_seconds = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0);
            }
        }
    }

    if trove_mod.is_tmod() {
        if let Ok(properties) = tmod::read_tmod_properties(file_path) {
            if let Some(title) = properties.get(tmod::TITLE_VALUE) {
                trove_mod.name = title.clone();
            }
            if let Some(author) = properties.get(tmod::AUTHOR_VALUE) {
                trove_mod.author = author.clone();
            }
            if let Some(notes) = properties.get(tmod::NOTES_VALUE) {
                trove_mod.description = notes.clone();
            }
        }
    }

    Ok(trove_mod)
}

pub fn add_mod(trove_mod: &mut TroveMod) -> Result<(), String> {
    trove_mod.status = STATUS_INSTALLING.to_string();
    let source = PathBuf::from(&trove_mod.file_path);
    let file_name = source
        .file_name()
        .ok_or_else(|| "Invalid mod file path".to_string())?;
    let new_path = settings::mods_folder().join(file_name);
    if source != new_path {
        std::fs::copy(&source, &new_path).map_err(|e| e.to_string())?;
        trove_mod.file_path = new_path.to_string_lossy().to_string();
    }
    Ok(())
}

fn dirname(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    match normalized.rfind('/') {
        Some(i) => normalized[..i].to_string(),
        None => String::new(),
    }
}

fn is_override_folder(folder: &str) -> bool {
    folder.to_lowercase().ends_with(OVERRIDE_FOLDER)
}

fn index_exists(base_path: &Path, folder: &str) -> bool {
    let parent = dirname(folder);
    base_path.join(parent).join(INDEX_FILE).exists()
}

pub fn get_zip_entry_extract_folder(
    base_path: &Path,
    entry_full_name: &str,
    entry_name: &str,
    error_count: &mut u32,
) -> Option<String> {
    let mut folder = dirname(entry_full_name);
    if !is_override_folder(&folder) {
        folder = if folder.is_empty() {
            OVERRIDE_FOLDER.to_string()
        } else {
            format!("{}/{}", folder, OVERRIDE_FOLDER)
        };
    }

    if index_exists(base_path, &folder) {
        return Some(folder);
    }

    let mut current = folder.clone();
    loop {
        let stripped = match current.find('/') {
            Some(i) => current[i + 1..].to_string(),
            None => String::new(),
        };
        if stripped.is_empty() || stripped == current {
            break;
        }
        current = stripped;
        if index_exists(base_path, &current) {
            return Some(current);
        }
    }

    let ext = Path::new(entry_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    if let Some(dir) = FOLDERS_BY_EXTENSION.get(&ext) {
        let folder = format!("{}/{}", dir.replace('\\', "/"), OVERRIDE_FOLDER);
        if index_exists(base_path, &folder) {
            return Some(folder);
        }
    }

    *error_count += 1;
    None
}

fn get_zip_entry_extract_path(
    base_path: &Path,
    entry_full_name: &str,
    entry_name: &str,
    error_count: &mut u32,
) -> Option<PathBuf> {
    let folder = get_zip_entry_extract_folder(base_path, entry_full_name, entry_name, error_count)?;
    let rel_folder = settings::resolve_folder(&base_path.join(folder.replace('/', std::path::MAIN_SEPARATOR_STR)));
    Some(rel_folder.join(entry_name))
}

fn get_tmod_file_path(location_path: &Path, mod_title: &str) -> PathBuf {
    let mods_folder = settings::resolve_folder(&location_path.join(MODS_FOLDER));
    mods_folder.join(format!("{}.tmod", settings::get_safe_filename(mod_title)))
}

pub fn mod_title(trove_mod: &TroveMod) -> String {
    if trove_mod.is_tmod() {
        if let Ok(properties) = tmod::read_tmod_properties(Path::new(&trove_mod.file_path)) {
            if let Some(title) = properties.get(tmod::TITLE_VALUE) {
                return title.clone();
            }
        }
    }
    trove_mod.name.clone()
}

pub fn install_mod(trove_mod: &mut TroveMod, locations: &[crate::models::TroveLocation]) -> Result<(), String> {
    if trove_mod.file_path.is_empty() {
        return Ok(());
    }
    trove_mod.status = STATUS_INSTALLING.to_string();
    let file_path = PathBuf::from(&trove_mod.file_path);
    if !file_path.exists() {
        let msg = error_status("File not found");
        trove_mod.status = msg.clone();
        return Err(msg);
    }

    let mut total_errors: u32 = 0;
    for loc in locations.iter().filter(|l| l.enabled) {
        let loc_path = PathBuf::from(&loc.location_path);
        if trove_mod.is_tmod() {
            let mod_path = get_tmod_file_path(&loc_path, &mod_title(trove_mod));
            std::fs::copy(&file_path, &mod_path).map_err(|e| e.to_string())?;
        } else {
            let file = std::fs::File::open(&file_path).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
                if entry.name().is_empty() || entry.is_dir() {
                    continue;
                }
                let entry_full_name = entry.name().to_string();
                let entry_file_name = Path::new(&entry_full_name)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();
                if entry_file_name.is_empty() {
                    continue;
                }
                if let Some(extract_path) = get_zip_entry_extract_path(
                    &loc_path,
                    &entry_full_name,
                    &entry_file_name,
                    &mut total_errors,
                ) {
                    let mut out = std::fs::File::create(&extract_path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    Ok(())
}

pub fn uninstall_mod(trove_mod: &mut TroveMod, locations: &[crate::models::TroveLocation]) -> Result<(), String> {
    if trove_mod.file_path.is_empty() {
        return Ok(());
    }
    let file_path = PathBuf::from(&trove_mod.file_path);
    if !file_path.exists() {
        return Ok(());
    }

    let mut total_errors: u32 = 0;
    for loc in locations.iter().filter(|l| l.enabled) {
        let loc_path = PathBuf::from(&loc.location_path);
        if trove_mod.is_tmod() {
            let mod_path = get_tmod_file_path(&loc_path, &mod_title(trove_mod));
            if mod_path.exists() {
                std::fs::remove_file(&mod_path).map_err(|e| e.to_string())?;
            }
        } else {
            let file = std::fs::File::open(&file_path).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            for i in 0..zip.len() {
                let entry = zip.by_index(i).map_err(|e| e.to_string())?;
                if entry.name().is_empty() || entry.is_dir() {
                    continue;
                }
                let entry_full_name = entry.name().to_string();
                let entry_file_name = Path::new(&entry_full_name)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();
                if entry_file_name.is_empty() {
                    continue;
                }
                if let Some(extract_path) = get_zip_entry_extract_path(
                    &loc_path,
                    &entry_full_name,
                    &entry_file_name,
                    &mut total_errors,
                ) {
                    if extract_path.exists() {
                        let disk_size = std::fs::metadata(&extract_path).map(|m| m.len()).unwrap_or(0);
                        if disk_size == entry.size() {
                            let _ = std::fs::remove_file(&extract_path);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn remove_mod(trove_mod: &mut TroveMod, locations: &[crate::models::TroveLocation]) -> Result<(), String> {
    if trove_mod.file_path.is_empty() {
        return Ok(());
    }
    uninstall_mod(trove_mod, locations)?;
    trove_mod.enabled = false;

    let mods_folder = settings::mods_folder();
    let file_path = PathBuf::from(&trove_mod.file_path);
    if file_path.starts_with(&mods_folder) && file_path.exists() {
        std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn check_for_updates(trove_mod: &mut TroveMod, trovesaurus_mods: &[TroveMod]) {
    if !Path::new(&trove_mod.file_path).exists() {
        trove_mod.status = error_status("File not found");
        trove_mod.enabled = false;
        return;
    }

    let found = find_trovesaurus_mod(trove_mod, trovesaurus_mods);
    let mut updates_available = false;
    if let Some(remote) = found {
        if let Some(latest) = remote.latest_download() {
            if latest.date_seconds() > trove_mod.unix_time_seconds {
                updates_available = true;
            }
        }
        trove_mod.update_properties_from_trovesaurus(remote);
    }

    trove_mod.status = if updates_available {
        STATUS_NEW_VERSION.to_string()
    } else {
        STATUS_UP_TO_DATE.to_string()
    };
}

pub fn find_trovesaurus_mod<'a>(trove_mod: &TroveMod, trovesaurus_mods: &'a [TroveMod]) -> Option<&'a TroveMod> {
    if !trove_mod.id.is_empty() {
        if let Some(m) = trovesaurus_mods
            .iter()
            .find(|m| m.id.eq_ignore_ascii_case(&trove_mod.id))
        {
            return Some(m);
        }
    }
    let filtered = TroveMod::filter_mod_filename(&trove_mod.name).to_lowercase();
    trovesaurus_mods
        .iter()
        .find(|m| TroveMod::filter_mod_filename(&m.name).to_lowercase() == filtered)
}

pub fn mod_files(trove_mod: &TroveMod, primary_location_path: Option<&Path>) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    if trove_mod.is_tmod() || trove_mod.file_path.is_empty() {
        return Ok(files);
    }
    let file = std::fs::File::open(&trove_mod.file_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut error_count: u32 = 0;

    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().is_empty() || entry.is_dir() {
            continue;
        }
        let entry_full_name = entry.name().to_string();
        let entry_file_name = Path::new(&entry_full_name)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        if entry_file_name.is_empty() {
            continue;
        }

        let folder = match primary_location_path {
            Some(base) => get_zip_entry_extract_folder(base, &entry_full_name, &entry_file_name, &mut error_count)
                .unwrap_or_else(|| dirname(&entry_full_name)),
            None => dirname(&entry_full_name),
        };
        let mut folder = folder;
        if is_override_folder(&folder) {
            folder = dirname(&folder);
        }
        files.push(if folder.is_empty() {
            entry_file_name
        } else {
            format!("{}/{}", folder, entry_file_name)
        });
    }
    Ok(files)
}

pub fn detect_my_mods(my_mods: &mut Vec<TroveMod>) {
    let mut mod_files: Vec<PathBuf> = Vec::new();
    for folder in [
        Some(settings::mods_folder()),
        settings::trove_toolbox_mods_folder(),
        settings::trove_tools_dotnet_mods_folder(),
    ]
        .into_iter()
        .flatten()
    {
        for ext in ["zip", "tmod"] {
            if let Ok(entries) = std::fs::read_dir(&folder) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path
                        .extension()
                        .map(|e| e.to_string_lossy().to_lowercase() == ext)
                        .unwrap_or(false)
                    {
                        mod_files.push(path);
                    }
                }
            }
        }
    }

    for mod_file in mod_files {
        let file_name = mod_file
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let already_have = my_mods.iter().any(|m| {
            Path::new(&m.file_path)
                .file_name()
                .map(|f| f.to_string_lossy().to_lowercase() == file_name)
                .unwrap_or(false)
        });
        if !already_have {
            if let Ok(mut trove_mod) = load_mod_from_file(&mod_file) {
                let _ = add_mod(&mut trove_mod);
                my_mods.push(trove_mod);
            }
        }
    }
}

pub fn remove_mod_folders(locations: &[crate::models::TroveLocation]) -> u32 {
    let mut count = 0;
    for loc in locations.iter().filter(|l| l.enabled) {
        for entry in walkdir::WalkDir::new(&loc.location_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_dir())
        {
            if entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(OVERRIDE_FOLDER)
            {
                if std::fs::remove_dir_all(entry.path()).is_ok() {
                    count += 1;
                }
            }
        }
    }
    count
}

pub fn extractable_folders(base_path: &Path) -> Vec<String> {
    let mut folders = Vec::new();
    for entry in walkdir::WalkDir::new(base_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file() && e.file_name().to_string_lossy() == INDEX_FILE)
    {
        if let Some(parent) = entry.path().parent() {
            if let Ok(rel) = parent.strip_prefix(base_path) {
                folders.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    folders.sort();
    folders
}

pub fn make_relative_path(full_path: &Path, base_path: &Path) -> String {
    let folder = full_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let folder_str = folder.to_string_lossy().to_string();
    let mut folder_str = if is_override_folder(&folder_str.replace('\\', "/")) {
        folder
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        folder_str
    };

    let base_str = base_path.to_string_lossy().to_string();
    if !base_str.is_empty() && folder_str.to_lowercase().starts_with(&base_str.to_lowercase()) {
        folder_str = folder_str[base_str.len()..].to_string();
    }
    let folder_str = folder_str.trim_start_matches(['/', '\\']);
    let file_name = full_path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    if folder_str.is_empty() {
        file_name
    } else {
        format!("{}/{}", folder_str.replace('\\', "/"), file_name)
    }
}

pub fn get_override_path(relative_path: &str, base_path: &Path) -> Option<PathBuf> {
    if relative_path.trim().is_empty() {
        return None;
    }
    let filename = relative_path.replace('/', std::path::MAIN_SEPARATOR_STR);
    let folder = base_path.join(dirname(&filename.replace('\\', "/")).replace('/', std::path::MAIN_SEPARATOR_STR));
    let folder = if is_override_folder(&folder.to_string_lossy().replace('\\', "/")) {
        folder
    } else {
        folder.join(OVERRIDE_FOLDER)
    };
    let folder = settings::resolve_folder(&folder);
    let file_name = Path::new(&filename).file_name()?.to_os_string();
    Some(folder.join(file_name))
}

