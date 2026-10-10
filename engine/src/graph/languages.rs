//! The language table (`engine/languages.toml`), and each language's grammar
//! and queries, loaded once and shared.

use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use tree_sitter::{Language, Query};

const TABLE: &str = include_str!("../../languages.toml");

#[derive(Deserialize)]
struct Entry {
    extensions: Vec<String>,
    grammar: Grammar,
    #[serde(default)]
    inline: Option<InlineEntry>,
    #[serde(default)]
    conventions: Vec<ConventionEntry>,
}

#[derive(Deserialize)]
struct Grammar {
    #[serde(rename = "crate")]
    krate: String,
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
    pub grammar_crate: String,
    extensions: Vec<String>,
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
/// it ships one, our query file, and the inline grammar run over some of its
/// nodes, if any.
pub struct Loaded {
    pub language: Language,
    pub tags: Option<Query>,
    pub ours: Query,
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
                    grammar_crate: e.grammar.krate,
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

/// The language named in the table, loaded and cached. Fails when the
/// table names a grammar the engine does not have, or a query does not
/// compile, which the language contract test catches first.
pub fn load(name: &str) -> Result<Arc<Loaded>, String> {
    static LOADED: OnceLock<Mutex<HashMap<String, Arc<Loaded>>>> = OnceLock::new();
    let cache = LOADED.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(l) = cache.lock().map_err(|e| e.to_string())?.get(name) {
        return Ok(l.clone());
    }
    let (language, tags, ours) = compiled(name).ok_or_else(|| {
        let krate = table()
            .get(name)
            .map_or("no crate", |s| s.grammar_crate.as_str());
        format!("No grammar for {name} ({krate}) is compiled in.")
    })?;
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
    let loaded = Arc::new(Loaded {
        language,
        tags,
        ours,
        inline,
    });
    cache
        .lock()
        .map_err(|e| e.to_string())?
        .insert(name.to_string(), loaded.clone());
    Ok(loaded)
}
