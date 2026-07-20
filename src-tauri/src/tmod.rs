use crate::models::ModDetails;
use crate::settings;
use flate2::read::ZlibDecoder;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const AUTHOR_VALUE: &str = "author";
pub const TITLE_VALUE: &str = "title";
pub const NOTES_VALUE: &str = "notes";
pub const TAGS_VALUE: &str = "tags";
pub const PREVIEW_PATH_VALUE: &str = "previewPath";

#[allow(dead_code)]
pub struct ArchiveIndexEntry {
    pub file: String,
    pub archive_index: i32,
    pub byte_offset: i32,
    pub size: i32,
    pub hash: i32,
}

pub struct TmodReader<R: Read> {
    reader: R,
}

impl<R: Read> TmodReader<R> {
    pub fn new(reader: R) -> Self {
        TmodReader { reader }
    }

    fn read_exact_bytes(&mut self, n: usize) -> std::io::Result<Vec<u8>> {
        let mut buf = vec![0u8; n];
        self.reader.read_exact(&mut buf)?;
        Ok(buf)
    }

    pub fn read_u64(&mut self) -> std::io::Result<u64> {
        let b = self.read_exact_bytes(8)?;
        Ok(u64::from_le_bytes(b.try_into().unwrap()))
    }

    pub fn read_u16(&mut self) -> std::io::Result<u16> {
        let b = self.read_exact_bytes(2)?;
        Ok(u16::from_le_bytes(b.try_into().unwrap()))
    }

    pub fn read_7bit_encoded_int(&mut self) -> std::io::Result<i32> {
        let mut result: u32 = 0;
        let mut shift = 0;
        loop {
            let b = self.read_exact_bytes(1)?[0];
            result |= ((b & 0x7f) as u32) << shift;
            if b & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift >= 35 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Invalid 7-bit encoded int",
                ));
            }
        }
        Ok(result as i32)
    }

    pub fn read_string(&mut self) -> std::io::Result<String> {
        let len = self.read_7bit_encoded_int()? as usize;
        let bytes = self.read_exact_bytes(len)?;
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }
}

pub fn read_tmod_header(
    path: &Path,
) -> Result<(HashMap<String, String>, Vec<ArchiveIndexEntry>, u64), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut reader = TmodReader::new(std::io::BufReader::new(file));

    let header_size = reader.read_u64().map_err(|e| e.to_string())?;
    let _tmod_version = reader.read_u16().map_err(|e| e.to_string())?;
    let property_count = reader.read_u16().map_err(|e| e.to_string())?;

    let mut properties = HashMap::new();
    let mut position: u64 = 8 + 2 + 2;

    for _ in 0..property_count {
        let key = reader.read_string().map_err(|e| e.to_string())?;
        let value = reader.read_string().map_err(|e| e.to_string())?;
        position += encoded_string_len(&key) + encoded_string_len(&value);
        if !key.trim().is_empty() && !value.trim().is_empty() {
            properties.insert(key, value);
        }
    }

    let mut entries = Vec::new();
    while position < header_size {
        let file = reader.read_string().map_err(|e| e.to_string())?;
        let archive_index = reader.read_7bit_encoded_int().map_err(|e| e.to_string())?;
        let byte_offset = reader.read_7bit_encoded_int().map_err(|e| e.to_string())?;
        let size = reader.read_7bit_encoded_int().map_err(|e| e.to_string())?;
        let hash = reader.read_7bit_encoded_int().map_err(|e| e.to_string())?;
        position += encoded_string_len(&file)
            + encoded_int_len(archive_index)
            + encoded_int_len(byte_offset)
            + encoded_int_len(size)
            + encoded_int_len(hash);
        entries.push(ArchiveIndexEntry {
            file,
            archive_index,
            byte_offset,
            size,
            hash,
        });
    }

    Ok((properties, entries, header_size))
}

fn encoded_string_len(s: &str) -> u64 {
    let len = s.len() as u64;
    encoded_int_len(len as i32) + len
}

fn encoded_int_len(value: i32) -> u64 {
    let mut v = value as u32;
    let mut count = 1;
    while v >= 0x80 {
        v >>= 7;
        count += 1;
    }
    count
}

pub fn read_tmod_properties(path: &Path) -> Result<HashMap<String, String>, String> {
    let (properties, _, _) = read_tmod_header(path)?;
    Ok(properties)
}

pub fn extract_tmod(
    path: &Path,
    folder: &Path,
    create_override_folders: bool,
    create_yaml: bool,
    mut update_progress: impl FnMut(f64),
) -> Result<(), String> {
    let (properties, entries, header_size) = read_tmod_header(path)?;

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buffered = std::io::BufReader::new(file);
    std::io::Seek::seek(&mut buffered, std::io::SeekFrom::Start(header_size))
        .map_err(|e| e.to_string())?;
    let mut decompressor = ZlibDecoder::new(buffered);

    let mut sorted: Vec<&ArchiveIndexEntry> = entries.iter().collect();
    sorted.sort_by_key(|e| e.byte_offset);

    let total = sorted.len().max(1) as f64;
    let mut offset: i64 = 0;
    let mut buffer = [0u8; 65536];

    for (i, entry) in sorted.iter().enumerate() {
        update_progress(i as f64 / total * 100.0);

        let entry_rel = entry.file.replace('/', std::path::MAIN_SEPARATOR_STR);
        let mut extract_path: PathBuf = folder.join(&entry_rel);
        if create_override_folders {
            let parent = extract_path
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| folder.to_path_buf());
            let file_name = extract_path
                .file_name()
                .map(|f| f.to_os_string())
                .unwrap_or_default();
            extract_path = parent.join("override").join(file_name);
        }
        if let Some(parent) = extract_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        while offset < entry.byte_offset as i64 {
            let mut skip_buf = [0u8; 8192];
            let to_read = std::cmp::min((entry.byte_offset as i64 - offset) as usize, skip_buf.len());
            let read = decompressor.read(&mut skip_buf[..to_read]).map_err(|e| e.to_string())?;
            if read == 0 {
                return Err(format!(
                    "Unexpected end of compressed data while seeking to {}",
                    entry.file
                ));
            }
            offset += read as i64;
        }

        let mut remaining = entry.size as usize;
        let mut out = std::fs::File::create(&extract_path).map_err(|e| e.to_string())?;
        while remaining > 0 {
            let to_read = std::cmp::min(remaining, buffer.len());
            let read = decompressor.read(&mut buffer[..to_read]).map_err(|e| e.to_string())?;
            if read == 0 {
                return Err(format!(
                    "Error extracting {}: {} bytes left to read and 0 bytes read from source",
                    extract_path.display(),
                    remaining
                ));
            }
            std::io::Write::write_all(&mut out, &buffer[..read]).map_err(|e| e.to_string())?;
            remaining -= read;
            offset += read as i64;
        }
    }

    if create_yaml {
        let title = properties
            .get(TITLE_VALUE)
            .cloned()
            .unwrap_or_else(|| {
                path.file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            });
        let yaml_path = folder.join(format!("{}.yaml", settings::get_safe_filename(&title)));

        let details = ModDetails {
            author: properties.get(AUTHOR_VALUE).cloned().unwrap_or_default(),
            title: properties.get(TITLE_VALUE).cloned().unwrap_or_default(),
            notes: properties.get(NOTES_VALUE).cloned().unwrap_or_default(),
            preview_path: properties.get(PREVIEW_PATH_VALUE).cloned().unwrap_or_default(),
            files: entries.iter().map(|e| e.file.clone()).collect(),
            tags: properties
                .get(TAGS_VALUE)
                .map(|t| {
                    t.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
        };
        details.save_yaml_file(&yaml_path)?;
    }

    update_progress(100.0);
    Ok(())
}
