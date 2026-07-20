use serde::{Deserialize, Deserializer, Serialize};

pub fn de_i64_flexible<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Number(n) => Ok(n.as_i64().unwrap_or(0)),
        serde_json::Value::String(s) => Ok(s.trim().parse().unwrap_or(0)),
        _ => Ok(0),
    }
}

pub fn de_bool_flexible<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Bool(b) => Ok(b),
        serde_json::Value::String(s) => Ok(matches!(s.to_lowercase().as_str(), "true" | "1" | "yes")),
        serde_json::Value::Number(n) => Ok(n.as_i64().unwrap_or(0) != 0),
        _ => Ok(false),
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ModDownload {
    #[serde(rename = "fileid")]
    pub file_id: String,
    #[serde(rename = "version")]
    pub version: String,
    #[serde(rename = "date")]
    pub date: String,
    #[serde(rename = "downloads", deserialize_with = "de_i64_flexible")]
    pub downloads: i64,
    #[serde(rename = "changes")]
    pub changes: String,
    #[serde(rename = "format")]
    pub format: String,
}

impl ModDownload {
    pub fn date_seconds(&self) -> i64 {
        self.date.trim().parse().unwrap_or(0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TroveMod {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "author")]
    pub author: String,
    #[serde(rename = "type")]
    pub mod_type: String,
    #[serde(rename = "subtype")]
    pub subtype: String,
    #[serde(rename = "description")]
    pub description: String,
    #[serde(rename = "date")]
    pub date_created: String,
    #[serde(rename = "status2")]
    pub trovesaurus_status: String,
    #[serde(rename = "replaces")]
    pub replaces: String,
    #[serde(rename = "totaldownloads", deserialize_with = "de_i64_flexible")]
    pub total_downloads: i64,
    #[serde(rename = "votes", deserialize_with = "de_i64_flexible")]
    pub votes: i64,
    #[serde(rename = "views", deserialize_with = "de_i64_flexible")]
    pub views: i64,
    #[serde(rename = "downloads")]
    pub downloads: Vec<ModDownload>,
    #[serde(rename = "image")]
    pub image: String,
    #[serde(rename = "image_full")]
    pub image_full: String,

    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "status")]
    pub status: String,
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "unixTimeSeconds")]
    pub unix_time_seconds: i64,
    #[serde(rename = "updatesDisabled")]
    pub updates_disabled: bool,
    #[serde(rename = "currentFileId")]
    pub current_file_id: String,
    #[serde(rename = "packName")]
    pub pack_name: String,
}

impl Default for TroveMod {
    fn default() -> Self {
        TroveMod {
            id: String::new(),
            name: String::new(),
            author: String::new(),
            mod_type: String::new(),
            subtype: String::new(),
            description: String::new(),
            date_created: String::new(),
            trovesaurus_status: String::new(),
            replaces: String::new(),
            total_downloads: 0,
            votes: 0,
            views: 0,
            downloads: Vec::new(),
            image: String::new(),
            image_full: String::new(),
            file_path: String::new(),
            status: String::new(),
            enabled: true,
            unix_time_seconds: 0,
            updates_disabled: false,
            current_file_id: String::new(),
            pack_name: String::new(),
        }
    }
}

impl TroveMod {
    pub fn is_tmod(&self) -> bool {
        self.file_path.to_lowercase().ends_with(".tmod")
    }

    pub fn latest_download(&self) -> Option<&ModDownload> {
        self.downloads
            .iter()
            .max_by_key(|d| d.file_id.parse::<i64>().unwrap_or(0))
    }


    pub fn filter_mod_filename(name: &str) -> String {
        let re = regex::Regex::new(r#"[+.\\/:*?"<>|\-]"#).unwrap();
        re.replace_all(name, "").to_string()
    }


    pub fn update_properties_from_trovesaurus(&mut self, other: &TroveMod) {
        self.id = other.id.clone();
        self.name = other.name.clone();
        if !other.author.trim().is_empty() {
            self.author = other.author.clone();
        }
        self.mod_type = other.mod_type.clone();
        self.subtype = other.subtype.clone();
        if !other.description.trim().is_empty() {
            self.description = other.description.clone();
        }
        self.date_created = other.date_created.clone();
        self.trovesaurus_status = other.trovesaurus_status.clone();
        self.replaces = other.replaces.clone();
        self.total_downloads = other.total_downloads;
        self.votes = other.votes;
        self.views = other.views;
        self.downloads = other.downloads.clone();
        self.image = other.image.clone();
        self.image_full = other.image_full.clone();

        if self.current_file_id.is_empty() {
            let stamp = self.unix_time_seconds.to_string();
            if let Some(d) = self.downloads.iter().find(|d| d.date == stamp) {
                self.current_file_id = d.file_id.clone();
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TroveLocation {
    #[serde(rename = "locationName")]
    pub location_name: String,
    #[serde(rename = "locationPath")]
    pub location_path: String,
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "primary")]
    pub primary: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TroveModPack {
    #[serde(rename = "id")]
    pub pack_id: String,
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "authorname")]
    pub author: String,
    #[serde(rename = "source")]
    pub source: String,
    #[serde(rename = "mods")]
    pub mods: Vec<TroveMod>,
}

impl TroveModPack {
    pub fn trove_uri(&self) -> String {
        if !self.pack_id.is_empty() {
            format!("trove://modpack={}", self.pack_id)
        } else {
            let ids: Vec<String> = self.mods.iter().map(|m| m.id.clone()).collect();
            format!("trove://{}?{}", urlencoding::encode(&self.name), ids.join("&"))
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct NewsItem {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "preview")]
    pub preview_html: String,
    #[serde(rename = "image")]
    pub image: String,
    #[serde(rename = "author")]
    pub author: String,
    #[serde(rename = "date")]
    pub date: String,
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "views")]
    pub views: String,
    #[serde(rename = "comments")]
    pub comments: String,
    #[serde(rename = "tags")]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CalendarItem {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "startdate")]
    pub start_date: String,
    #[serde(rename = "enddate")]
    pub end_date: String,
    #[serde(rename = "image")]
    pub image: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct OnlineStream {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "channel")]
    pub channel: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "online")]
    pub online: String,
    #[serde(rename = "description")]
    pub description: String,
    #[serde(rename = "status")]
    pub status: String,
    #[serde(rename = "preview")]
    pub preview: String,
    #[serde(rename = "viewers", deserialize_with = "de_i64_flexible")]
    pub viewers: i64,
    #[serde(rename = "featured")]
    pub featured: String,
    #[serde(rename = "updated")]
    pub updated: String,
}


#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ServerStatusEntry {
    #[serde(rename = "online", deserialize_with = "de_bool_flexible")]
    pub online: bool,
    #[serde(rename = "date")]
    pub date: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TroveServerStatus {
    #[serde(rename = "Live")]
    pub live: ServerStatusEntry,
    #[serde(rename = "Server")]
    pub server: ServerStatusEntry,
    #[serde(rename = "PTS")]
    pub pts: ServerStatusEntry,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ModDetails {
    #[serde(rename = "author")]
    pub author: String,
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "notes")]
    pub notes: String,
    #[serde(rename = "previewPath")]
    pub preview_path: String,
    #[serde(rename = "files")]
    pub files: Vec<String>,
    #[serde(rename = "tags")]
    pub tags: Vec<String>,
}

impl ModDetails {
    pub fn save_yaml_file(&self, path: &std::path::Path) -> Result<(), String> {
        let yaml = serde_yaml::to_string(self).map_err(|e| e.to_string())?;
        let contents = format!("---\n{}...\n", yaml);
        std::fs::write(path, contents).map_err(|e| e.to_string())
    }

    pub fn load_from_yaml(contents: &str) -> Result<ModDetails, String> {
        serde_yaml::from_str(contents).map_err(|e| e.to_string())
    }
}
