//! The app-data store: what Gaia keeps per project between runs, such as
//! Jev's answers and the person's consent to a live run. Each project has one
//! JSON file of tables, each table a map from key to value, under
//! `<data>/projects/<project id>/store.json`. A write replaces the whole file
//! through a rename, so a crash never leaves it half-written. `<data>` is
//! `GAIA_DATA_DIR` (the app passes its user-data folder) or, failing that,
//! `~/Library/Application Support/Gaia`.

use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;

/// The tables a project's store holds. `EngineMethods`' `StoreTable` names the same.
pub const TABLES: &[&str] = &[
    "answers",
    "blueprints",
    "document",
    "placements",
    "settings",
];

fn data_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("GAIA_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let home =
        std::env::var("HOME").map_err(|_| "No GAIA_DATA_DIR and no HOME to keep the store in.")?;
    Ok(PathBuf::from(home).join("Library/Application Support/Gaia"))
}

/// The store file of one project. A project ID is a commit hash or a content
/// hash, so anything else (a path, a dot) is refused.
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

/// Writes records, each `{ table, key, value }`, all at once or not at all.
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
