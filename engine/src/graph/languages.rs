//! The language table (`engine/languages.toml`), and each language's grammar
//! and queries, loaded once and shared. A grammar is compiled in, or comes
//! as WebAssembly from its own release, downloaded once, checked against
//! the table's hash and kept in the app's data folder.

use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use tree_sitter::{Language, Query, WasmStore, wasmtime};

const TABLE: &str = include_str!("../../languages.toml");

#[derive(Deserialize)]
struct Entry {
    extensions: Vec<String>,
    grammar: Grammar,
    #[serde(default)]
    tags: Option<Remote>,
    #[serde(default)]
    inline: Option<InlineEntry>,
    #[serde(default)]
    conventions: Vec<ConventionEntry>,
}

/// Where a language's grammar comes from.
#[derive(Deserialize, Clone)]
#[serde(untagged)]
pub enum Grammar {
    Compiled {
        #[serde(rename = "crate")]
        krate: String,
    },
    Wasm {
        wasm: String,
        sha256: String,
    },
}

/// A file a grammar's release publishes, and the SHA-256 it must have.
#[derive(Deserialize, Clone)]
pub struct Remote {
    pub url: String,
    pub sha256: String,
}

#[derive(Deserialize)]
struct InlineEntry {
    grammar: String,
    over: String,
}

#[derive(Deserialize)]
struct ConventionEntry {
    tag: String,
    path: String,
}

/// One language as the table describes it.
pub struct Spec {
    pub name: String,
    pub grammar: Grammar,
    pub tags: Option<Remote>,
    pub extensions: Vec<String>,
    inline: Option<InlineEntry>,
    convention_tags: Vec<String>,
    conventions: GlobSet,
}

impl Spec {
    /// The tags of every convention `path` matches, each once, in table order.
    pub fn conventions_of(&self, path: &str) -> Vec<String> {
        let mut tags: Vec<String> = Vec::new();
        for i in self.conventions.matches(path) {
            let tag = &self.convention_tags[i];
            if !tags.contains(tag) {
                tags.push(tag.clone());
            }
        }
        tags
    }
}

/// A language ready to parse: its grammar, the grammar's own tags query if
/// it ships one, our query file if we wrote one, and the inline grammar run
/// over some of its nodes, if any.
pub struct Loaded {
    pub language: Language,
    /// True for a WebAssembly grammar, which parses only in a parser given a `WasmStore`.
    pub wasm: bool,
    pub tags: Option<Query>,
    pub ours: Option<Query>,
    pub inline: Option<Inline>,
}

pub struct Inline {
    pub language: Language,
    pub query: Query,
    /// The kind of node in the outer tree that the inline grammar reads.
    pub over: String,
}

/// Every language in the table, by name.
pub fn table() -> &'static BTreeMap<String, Spec> {
    static TABLE_SPECS: OnceLock<BTreeMap<String, Spec>> = OnceLock::new();
    TABLE_SPECS.get_or_init(|| {
        let entries: BTreeMap<String, Entry> =
            toml::from_str(TABLE).expect("engine/languages.toml is the language table");
        entries
            .into_iter()
            .map(|(name, e)| {
                let mut globs = GlobSetBuilder::new();
                for c in &e.conventions {
                    globs.add(Glob::new(&c.path).expect("a convention's path is a glob"));
                }
                let spec = Spec {
                    name: name.clone(),
                    grammar: e.grammar,
                    tags: e.tags,
                    extensions: e.extensions,
                    inline: e.inline,
                    convention_tags: e.conventions.into_iter().map(|c| c.tag).collect(),
                    conventions: globs.build().expect("the conventions build"),
                };
                (name, spec)
            })
            .collect()
    })
}

/// The language a path's extension names, if the table has one.
pub fn of_path(path: &str) -> Option<&'static Spec> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let (_, ext) = name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    table().values().find(|s| s.extensions.contains(&ext))
}

/// A compiled grammar, its shipped tags query and our query file, by the table's name.
fn compiled(name: &str) -> Option<(Language, Option<String>, &'static str)> {
    let js_tags = tree_sitter_javascript::TAGS_QUERY;
    Some(match name {
        "typescript" => (
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Some(format!("{js_tags}\n{}", tree_sitter_typescript::TAGS_QUERY)),
            include_str!("../../queries/typescript.scm"),
        ),
        "tsx" => (
            tree_sitter_typescript::LANGUAGE_TSX.into(),
            Some(format!("{js_tags}\n{}", tree_sitter_typescript::TAGS_QUERY)),
            include_str!("../../queries/tsx.scm"),
        ),
        "javascript" => (
            tree_sitter_javascript::LANGUAGE.into(),
            Some(js_tags.to_string()),
            include_str!("../../queries/javascript.scm"),
        ),
        "python" => (
            tree_sitter_python::LANGUAGE.into(),
            Some(tree_sitter_python::TAGS_QUERY.to_string()),
            include_str!("../../queries/python.scm"),
        ),
        "go" => (
            tree_sitter_go::LANGUAGE.into(),
            Some(tree_sitter_go::TAGS_QUERY.to_string()),
            include_str!("../../queries/go.scm"),
        ),
        "rust" => (
            tree_sitter_rust::LANGUAGE.into(),
            Some(tree_sitter_rust::TAGS_QUERY.to_string()),
            include_str!("../../queries/rust.scm"),
        ),
        "java" => (
            tree_sitter_java::LANGUAGE.into(),
            Some(tree_sitter_java::TAGS_QUERY.to_string()),
            include_str!("../../queries/java.scm"),
        ),
        "c" => (
            tree_sitter_c::LANGUAGE.into(),
            Some(tree_sitter_c::TAGS_QUERY.to_string()),
            include_str!("../../queries/c.scm"),
        ),
        "cpp" => (
            tree_sitter_cpp::LANGUAGE.into(),
            Some(tree_sitter_cpp::TAGS_QUERY.to_string()),
            include_str!("../../queries/cpp.scm"),
        ),
        "c-sharp" => (
            tree_sitter_c_sharp::LANGUAGE.into(),
            Some(tree_sitter_c_sharp::TAGS_QUERY.to_string()),
            include_str!("../../queries/c-sharp.scm"),
        ),
        "ruby" => (
            tree_sitter_ruby::LANGUAGE.into(),
            Some(tree_sitter_ruby::TAGS_QUERY.to_string()),
            include_str!("../../queries/ruby.scm"),
        ),
        "php" => (
            tree_sitter_php::LANGUAGE_PHP.into(),
            Some(tree_sitter_php::TAGS_QUERY.to_string()),
            include_str!("../../queries/php.scm"),
        ),
        "swift" => (
            tree_sitter_swift::LANGUAGE.into(),
            Some(tree_sitter_swift::TAGS_QUERY.to_string()),
            include_str!("../../queries/swift.scm"),
        ),
        "kotlin" => (
            tree_sitter_kotlin_ng::LANGUAGE.into(),
            None,
            include_str!("../../queries/kotlin.scm"),
        ),
        "bash" => (
            tree_sitter_bash::LANGUAGE.into(),
            None,
            include_str!("../../queries/bash.scm"),
        ),
        "html" => (
            tree_sitter_html::LANGUAGE.into(),
            None,
            include_str!("../../queries/html.scm"),
        ),
        "css" => (
            tree_sitter_css::LANGUAGE.into(),
            None,
            include_str!("../../queries/css.scm"),
        ),
        "markdown" => (
            tree_sitter_md::LANGUAGE.into(),
            None,
            include_str!("../../queries/markdown.scm"),
        ),
        "markdown-inline" => (
            tree_sitter_md::INLINE_LANGUAGE.into(),
            None,
            include_str!("../../queries/markdown-inline.scm"),
        ),
        "json" => (
            tree_sitter_json::LANGUAGE.into(),
            None,
            include_str!("../../queries/json.scm"),
        ),
        "toml" => (
            tree_sitter_toml_ng::LANGUAGE.into(),
            None,
            include_str!("../../queries/toml.scm"),
        ),
        "yaml" => (
            tree_sitter_yaml::LANGUAGE.into(),
            None,
            include_str!("../../queries/yaml.scm"),
        ),
        _ => return None,
    })
}

fn query(language: &Language, text: &str, what: &str) -> Result<Query, String> {
    Query::new(language, text).map_err(|e| format!("{what} does not compile: {e}"))
}

/// The WebAssembly engine every grammar from a release runs in.
fn wasm_engine() -> &'static wasmtime::Engine {
    static ENGINE: OnceLock<wasmtime::Engine> = OnceLock::new();
    ENGINE.get_or_init(wasmtime::Engine::default)
}

/// A store for one parser, which a WebAssembly grammar needs to parse.
pub fn wasm_store() -> Result<WasmStore, String> {
    WasmStore::new(wasm_engine()).map_err(|e| e.to_string())
}

/// A WebAssembly grammar from its bytes. `name` is the grammar's own, as its
/// file exports it (`tree_sitter_<name>`).
pub fn wasm_language(name: &str, bytes: &[u8]) -> Result<Language, String> {
    let mut store = wasm_store()?;
    store
        .load_language(name, bytes)
        .map_err(|e| format!("{name}'s WebAssembly grammar does not load: {e}"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A release's file, from the data folder or else downloaded, and checked
/// against its hash either way.
fn fetch(url: &str, sha256: &str) -> Result<Vec<u8>, String> {
    let ext = url.rsplit('.').next().unwrap_or("bin");
    let path: PathBuf = crate::store::data_dir()?
        .join("grammars")
        .join(format!("{sha256}.{ext}"));
    if let Ok(bytes) = std::fs::read(&path)
        && sha256_hex(&bytes) == sha256
    {
        return Ok(bytes);
    }
    if !url.starts_with("https://") {
        return Err(format!("A grammar comes only over https: {url}"));
    }
    let dir = path.parent().ok_or("The grammars folder has no parent.")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not make {}: {e}", dir.display()))?;
    let temp = path.with_extension("part");
    let out = Command::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--max-time",
            "120",
            "--output",
        ])
        .arg(&temp)
        .arg(url)
        .output()
        .map_err(|e| format!("Could not start curl: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Could not download {url}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let bytes =
        std::fs::read(&temp).map_err(|e| format!("Could not read {}: {e}", temp.display()))?;
    if sha256_hex(&bytes) != sha256 {
        let _ = std::fs::remove_file(&temp);
        return Err(format!(
            "{url} does not have the SHA-256 the language table names."
        ));
    }
    std::fs::rename(&temp, &path).map_err(|e| format!("Could not keep {}: {e}", path.display()))?;
    Ok(bytes)
}

/// A language from a WebAssembly grammar and its tags query, if it has one.
pub fn from_wasm(name: &str, grammar: &[u8], tags: Option<&str>) -> Result<Loaded, String> {
    let language = wasm_language(name, grammar)?;
    let tags = match tags {
        Some(t) => Some(query(&language, t, &format!("{name}'s tags query"))?),
        None => None,
    };
    Ok(Loaded {
        language,
        wasm: true,
        tags,
        ours: None,
        inline: None,
    })
}

fn load_compiled(name: &str) -> Result<Loaded, String> {
    let (language, tags, ours) =
        compiled(name).ok_or_else(|| format!("No grammar for {name} is compiled in."))?;
    let tags = match tags {
        Some(t) => Some(query(&language, &t, &format!("{name}'s tags query"))?),
        None => None,
    };
    let ours = query(&language, ours, &format!("engine/queries/{name}.scm"))?;
    let inline = match table().get(name).and_then(|s| s.inline.as_ref()) {
        Some(i) => {
            let (language, _, text) = compiled(&i.grammar)
                .ok_or_else(|| format!("No inline grammar {} is compiled in.", i.grammar))?;
            let query = query(
                &language,
                text,
                &format!("engine/queries/{}.scm", i.grammar),
            )?;
            Some(Inline {
                language,
                query,
                over: i.over.clone(),
            })
        }
        None => None,
    };
    Ok(Loaded {
        language,
        wasm: false,
        tags,
        ours: Some(ours),
        inline,
    })
}

/// The language named in the table, loaded and cached. A compiled grammar
/// fails only when its query does not compile, which the language contract
/// test catches first. A grammar from a release fails when it cannot be
/// downloaded, and its files are then read as having no grammar.
pub fn load(name: &str) -> Result<Arc<Loaded>, String> {
    static LOADED: OnceLock<Mutex<HashMap<String, Arc<Loaded>>>> = OnceLock::new();
    let cache = LOADED.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(l) = cache.lock().map_err(|e| e.to_string())?.get(name) {
        return Ok(l.clone());
    }
    let spec = table()
        .get(name)
        .ok_or_else(|| format!("No language {name} in the table."))?;
    let loaded = Arc::new(match &spec.grammar {
        Grammar::Compiled { krate } => load_compiled(name).map_err(|e| format!("{e} ({krate})"))?,
        Grammar::Wasm { wasm, sha256 } => {
            let grammar = fetch(wasm, sha256)?;
            let tags = match &spec.tags {
                Some(t) => Some(String::from_utf8_lossy(&fetch(&t.url, &t.sha256)?).into_owned()),
                None => None,
            };
            from_wasm(name, &grammar, tags.as_deref())?
        }
    });
    cache
        .lock()
        .map_err(|e| e.to_string())?
        .insert(name.to_string(), loaded.clone());
    Ok(loaded)
}
