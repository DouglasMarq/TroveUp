use crate::models::*;
use crate::settings;
use regex::Regex;

pub const MOD_LIST_URL: &str = "https://trovesaurus.com/modsapi.php?mode=list";
pub const MOD_PACKS_URL: &str = "https://trovesaurus.com/modpacks";
pub const CALENDAR_URL: &str = "https://trovesaurus.com/toolbox/calendar.php";
pub const NEWS_URL: &str = "https://trovesaurus.com/feeds/news.php";
pub const SERVER_STATUS_URL: &str = "https://trovesaurus.com/statusjson.php";
pub const ONLINE_STREAMS_URL: &str = "https://trovesaurus.com/feeds/onlinestreams.php";
pub const MAIL_COUNT_URL: &str = "https://trovesaurus.com/toolbox/mailcount.php";

pub fn add_querystring(url: &str, include_ticks: bool) -> String {
    let key = settings::load_settings().trovesaurus_account_link_key;
    let mut new_url = String::from(url);
    new_url.push_str(if url.contains('?') { "&" } else { "?" });
    new_url.push_str("ml=TroveUp");
    if !key.is_empty() {
        new_url.push_str(&format!("&key={}", key));
    }
    if include_ticks {
        new_url.push_str(&format!("&ticks={}", chrono::Local::now().timestamp_nanos_opt().unwrap_or(0)));
    }
    new_url
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("TroveUp")
        .build()
        .unwrap_or_default()
}

pub async fn fetch_mod_list() -> Result<Vec<TroveMod>, String> {
    let url = add_querystring(MOD_LIST_URL, false);
    let mods: Vec<TroveMod> = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    settings::save_trovesaurus_mods_cache(&mods);
    Ok(mods)
}

pub async fn fetch_news() -> Result<Vec<NewsItem>, String> {
    let url = add_querystring(NEWS_URL, false);
    http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

pub async fn fetch_calendar() -> Result<Vec<CalendarItem>, String> {
    let url = add_querystring(CALENDAR_URL, true);
    http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

pub async fn fetch_streams() -> Result<Vec<OnlineStream>, String> {
    let url = add_querystring(ONLINE_STREAMS_URL, false);
    http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

pub async fn fetch_server_status() -> Result<TroveServerStatus, String> {
    let url = add_querystring(SERVER_STATUS_URL, true);
    http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

pub async fn fetch_mail_count() -> Result<i64, String> {
    let url = add_querystring(MAIL_COUNT_URL, false);
    let text = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    text.trim().parse().map_err(|e: std::num::ParseIntError| e.to_string())
}

pub async fn fetch_mod_packs(mod_list: &[TroveMod]) -> Result<Vec<TroveModPack>, String> {
    let url = add_querystring(MOD_PACKS_URL, false);
    let html = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let pack_re = Regex::new(r#"(?s)<h3><a href="(?<Url>https?://(?:www\.)?trovesaurus\.com/modpack=(?<PackId>\d+)/[^"]*)">(?<Name>[^<]*)</a></h3>.*?Created by <a href=[^>]+>(?<Author>[^<]+)</a>(?<Details>.*?)<hr/>"#)
        .map_err(|e| e.to_string())?;
    let pack_mods_re = Regex::new(r#"<a href="https?://(?:www\.)?trovesaurus\.com/mod=(?<ModId>\d+)"#)
        .map_err(|e| e.to_string())?;

    let mut packs = Vec::new();
    for caps in pack_re.captures_iter(&html) {
        let details = &caps["Details"];
        let mut pack = TroveModPack {
            pack_id: caps["PackId"].to_string(),
            url: caps["Url"].to_string(),
            name: caps["Name"].to_string(),
            author: caps["Author"].to_string(),
            source: "Trovesaurus".to_string(),
            mods: Vec::new(),
        };
        for mod_caps in pack_mods_re.captures_iter(details) {
            if let Some(m) = mod_list.iter().find(|m| m.id == mod_caps["ModId"]) {
                pack.mods.push(m.clone());
            }
        }
        if !pack.mods.is_empty() {
            packs.push(pack);
        }
    }
    Ok(packs)
}

pub async fn download_mod(trove_mod: &TroveMod, file_id: &str) -> Result<String, String> {
    let download = trove_mod
        .downloads
        .iter()
        .find(|d| d.file_id == file_id)
        .ok_or_else(|| format!("Download file ID {} not found for mod {}", file_id, trove_mod.name))?;

    let format = if download.format.is_empty() { "zip" } else { &download.format };
    let file_name = format!(
        "{}+{}.{}",
        TroveMod::filter_mod_filename(&trove_mod.name),
        download.date,
        format
    );
    let local_path = settings::mods_folder().join(&file_name);

    let url = add_querystring(
        &format!("https://trovesaurus.com/mod.php?id={}&download={}", trove_mod.id, file_id),
        false,
    );
    let bytes = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::write(&local_path, &bytes).map_err(|e| e.to_string())?;

    Ok(local_path.to_string_lossy().to_string())
}
