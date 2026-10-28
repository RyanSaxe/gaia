//! Stores Gaia's per-project data between runs, such as Jev's answers and the
//! person's consent to a live run. A project's tables, each a map from key to
//! value, are stored in one JSON file at `<data>/projects/<project id>/store.json`.
//! `<data>` is `GAIA_DATA_DIR`, which the app sets to its user-data folder, or
//! else the platform's per-user data folder.

use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;

/// The tables in a project's store. `StoreTable` in `packages/schema/src/engine.ts` lists the same names.
pub const TABLES: &[&str] = &["answers", "calls", "held", "lineage", "settings"];

pub(crate) fn data_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("GAIA_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    #[cfg(target_os = "windows")]
    {
        let app_data = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|home| PathBuf::from(home).join("AppData/Roaming"))
            })
            .ok_or("No GAIA_DATA_DIR, APPDATA or USERPROFILE to keep the store in.")?;
        return Ok(app_data.join("Gaia"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or("No GAIA_DATA_DIR or HOME to keep the store in.")?;
        return Ok(home.join("Library/Application Support/Gaia"));
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
            return Ok(PathBuf::from(data_home).join("gaia"));
        }
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or("No GAIA_DATA_DIR, XDG_DATA_HOME or HOME to keep the store in.")?;
        return Ok(home.join(".local/share/gaia"));
    }
    #[allow(unreachable_code)]
    Err("Gaia has no app-data folder for this platform.".into())
}

/// The store file of one project. A project ID is a commit hash or a content
/// hash, so it rejects any ID that is not 1 to 128 ASCII letters, digits, `-`
/// or `_`. A path or a dot can't pass.
fn file_of(project: &str) -> Result<PathBuf, String> {
    let valid = !project.is_empty()
        && project.len() <= 128
        && project
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(format!("Not a project ID: {project:?}"));
    }
    Ok(data_dir()?
        .join("projects")
        .join(project)
        .join("store.json"))
}

fn check_table(table: &str) -> Result<(), String> {
    if TABLES.contains(&table) {
        Ok(())
    } else {
        Err(format!("No store table named {table:?}."))
    }
}

fn load(project: &str) -> Result<Map<String, Value>, String> {
    let path = file_of(project)?;
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("The store at {} is not JSON: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

/// One record, or None when it was never written.
pub fn get(project: &str, table: &str, key: &str) -> Result<Option<Value>, String> {
    check_table(table)?;
    Ok(load(project)?.get(table).and_then(|t| t.get(key)).cloned())
}

/// Every record of one table, as a map from key to value.
pub fn read(project: &str, table: &str) -> Result<Value, String> {
    check_table(table)?;
    Ok(load(project)?
        .remove(table)
        .unwrap_or_else(|| Value::Object(Map::new())))
}

/// Writes records, each `{ table, key, value }`, and writes none if any record
/// is invalid. It replaces the whole file through a rename, so a crash never
/// leaves it half-written.
pub fn put(project: &str, writes: &[Value]) -> Result<(), String> {
    let mut store = load(project)?;
    for w in writes {
        let (Some(table), Some(key), Some(value)) =
            (w["table"].as_str(), w["key"].as_str(), w.get("value"))
        else {
            return Err("Each write needs a table, a key and a value.".into());
        };
        check_table(table)?;
        let entry = store
            .entry(table)
            .or_insert_with(|| Value::Object(Map::new()));
        if let Value::Object(records) = entry {
            records.insert(key.to_string(), value.clone());
        }
    }
    let path = file_of(project)?;
    let dir = path.parent().ok_or("The store has no folder.")?;
    fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    let temp = path.with_extension("json.tmp");
    let text = serde_json::to_vec(&store).map_err(|e| e.to_string())?;
    fs::write(&temp, text).map_err(|e| format!("Could not write {}: {e}", temp.display()))?;
    fs::rename(&temp, &path).map_err(|e| format!("Could not replace {}: {e}", path.display()))
}
