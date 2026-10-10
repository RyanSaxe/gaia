//! Mutations for the calibration set: definitions made worse on purpose in
//! one way each, so Jev's answers about the copy can be compared with its
//! answers about the original. Each mutation names the question it should
//! move and the questions it should leave alone:
//!
//! - `names`: every parameter renamed to a single letter; naming drops.
//! - `doc`: the doc comment replaced with another definition's; doc drops.
//! - `handler`: every error handler's body emptied; errors become "swallows".
//!
//! For each kind, `<out>/<kind>/original` and `<out>/<kind>/mutant` hold the
//! same files, each with one definition mutated in the mutant, and
//! `<out>/mutations.json` lists them. Which definitions are chosen follows
//! a hash of their ids, so the same repository gives the same mutations.

use super::languages;
use super::parse::{self, FileParse, Sites};
use super::walk::{self, content_hash};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;

/// Letters a renamed parameter takes, skipping ones that read as words.
const LETTERS: &[&str] = &[
    "a", "b", "c", "d", "e", "f", "g", "h", "k", "m", "n", "p", "q", "r", "s", "t", "u", "v", "w",
    "x", "y", "z",
];

struct Parsed {
    path: String,
    text: String,
    empty_block: Option<String>,
    family: String,
    parse: FileParse,
    sites: Vec<Sites>,
}

/// One definition made worse, as the manifest lists it.
struct Mutation {
    kind: &'static str,
    file: usize,
    def: usize,
    edits: Vec<(usize, usize, String)>,
}

/// Writes each kind's original and mutant copies under `out`, with up to
/// `per_kind` definitions each, and returns the manifest.
pub fn run(root: &Path, out: &Path, per_kind: usize) -> Result<Value, String> {
    let mut files: Vec<Parsed> = Vec::new();
    for f in walk::walk(root) {
        let (Some(text), Some(spec)) = (f.text, languages::of_path(&f.path)) else {
            continue;
        };
        if spec.data {
            continue;
        }
        let Ok(loaded) = languages::load(&spec.name) else {
            continue;
        };
        let (parse, sites) = parse::parse_with_sites(&loaded, &text)?;
        files.push(Parsed {
            path: f.path,
            text,
            empty_block: spec.empty_block.clone(),
            family: spec.family.clone(),
            parse,
            sites,
        });
    }

    let id = |f: &Parsed, k: usize| format!("def:{}#{}", f.path, f.parse.defs[k].qualified);
    // The same repository gives the same order.
    let ordered = |kind: &str| -> Vec<(usize, usize)> {
        let mut all: Vec<(String, usize, usize)> = files
            .iter()
            .enumerate()
            .flat_map(|(fi, f)| (0..f.parse.defs.len()).map(move |k| (fi, k)))
            .map(|(fi, k)| {
                (
                    content_hash(format!("{kind}|{}", id(&files[fi], k)).as_bytes()),
                    fi,
                    k,
                )
            })
            .collect();
        all.sort();
        all.into_iter().map(|(_, fi, k)| (fi, k)).collect()
    };

    let mut chosen: Vec<Mutation> = Vec::new();
    for kind in ["names", "doc", "handler"] {
        let mut used: HashSet<usize> = HashSet::new();
        for (fi, k) in ordered(kind) {
            if chosen.iter().filter(|m| m.kind == kind).count() >= per_kind {
                break;
            }
            if used.contains(&fi) {
                continue;
            }
            let f = &files[fi];
            let edits = match kind {
                "names" => rename(f, k),
                "doc" => swap_doc(&files, fi, k),
                _ => empty_handlers(f, k),
            };
            if let Some(edits) = edits {
                used.insert(fi);
                chosen.push(Mutation {
                    kind,
                    file: fi,
                    def: k,
                    edits,
                });
            }
        }
    }

    let mut manifest: Vec<Value> = Vec::new();
    let mut written: BTreeMap<&str, BTreeSet<usize>> = BTreeMap::new();
    for m in &chosen {
        let f = &files[m.file];
        let mut text = f.text.clone();
        let mut edits = m.edits.clone();
        edits.sort_by_key(|e| std::cmp::Reverse(e.0));
        for (start, end, with) in edits {
            text.replace_range(start..end, &with);
        }
        let dir = out.join(m.kind);
        write(&dir.join("original").join(&f.path), &f.text)?;
        write(&dir.join("mutant").join(&f.path), &text)?;
        written.entry(m.kind).or_default().insert(m.file);
        let (moves, toward, leaves): (&str, &str, &[&str]) = match m.kind {
            "names" => (
                "quality.naming",
                "lower",
                &["quality.doc", "quality.errors", "quality.change"],
            ),
            "doc" => (
                "quality.doc",
                "lower",
                &[
                    "quality.readability",
                    "quality.naming",
                    "quality.errors",
                    "quality.change",
                ],
            ),
            _ => (
                "quality.errors",
                "swallows",
                &["quality.naming", "quality.doc"],
            ),
        };
        manifest.push(json!({
            "kind": m.kind,
            "def": id(f, m.def),
            "file": f.path,
            "moves": moves,
            "toward": toward,
            "leaves": leaves,
        }));
    }
    let manifest = json!({ "mutations": manifest });
    let pretty = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    write(&out.join("mutations.json"), &pretty)?;
    Ok(manifest)
}

fn write(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Every parameter renamed to a letter no word in the definition uses, for
/// a definition with at least two parameters used in its body.
fn rename(f: &Parsed, k: usize) -> Option<Vec<(usize, usize, String)>> {
    let d = &f.parse.defs[k];
    let s = &f.sites[k];
    let used: Vec<&(String, Vec<(usize, usize)>)> = s
        .params
        .iter()
        .filter(|(_, uses)| uses.len() >= 2)
        .collect();
    if used.len() < 2 || d.measures.lines < 5 {
        return None;
    }
    let (start, end) = (
        s.params.iter().flat_map(|(_, u)| u).map(|u| u.0).min()?,
        s.params.iter().flat_map(|(_, u)| u).map(|u| u.1).max()?,
    );
    let words: HashSet<&str> = f.text[start..end]
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .collect();
    let mut free = LETTERS.iter().filter(|l| !words.contains(**l));
    let mut edits = Vec::new();
    for (name, uses) in &s.params {
        if name.len() == 1 {
            continue;
        }
        let letter = free.next()?;
        edits.extend(uses.iter().map(|&(a, b)| (a, b, letter.to_string())));
    }
    (!edits.is_empty()).then_some(edits)
}

/// The doc comment replaced with that of another definition of the same
/// language family, from another file, whose doc says something else.
fn swap_doc(files: &[Parsed], fi: usize, k: usize) -> Option<Vec<(usize, usize, String)>> {
    let f = &files[fi];
    let (start, end) = f.sites[k].doc?;
    let d = &f.parse.defs[k];
    if !d.callable || d.measures.lines < 5 {
        return None;
    }
    let own = &f.text[start..end];
    let quoted = own.starts_with(['"', '\'']);
    let donors: Vec<&str> = files
        .iter()
        .enumerate()
        .filter(|(oi, o)| *oi != fi && o.family == f.family)
        .flat_map(|(_, o)| {
            o.sites
                .iter()
                .filter_map(move |s| s.doc.map(|(a, b)| &o.text[a..b]))
        })
        // A docstring takes a docstring and a comment a comment.
        .filter(|t| t.starts_with(['"', '\'']) == quoted && *t != own && t.len() >= 40)
        .collect();
    // Each definition takes its own donor, picked by a hash of where it is.
    let pick = content_hash(format!("{}|{}", f.path, d.qualified).as_bytes());
    let n = u64::from_str_radix(pick.get(..12)?, 16).ok()? as usize;
    let donor = donors.get(n % donors.len().max(1))?;
    Some(vec![(start, end, donor.to_string())])
}

/// Every error handler's body emptied, for a definition whose handlers
/// act on what they catch: one that only returns a default already
/// swallows it, so emptying it would change nothing.
fn empty_handlers(f: &Parsed, k: usize) -> Option<Vec<(usize, usize, String)>> {
    let handlers = &f.sites[k].handlers;
    let acts = |body: &str| body.contains('(') || body.contains("raise") || body.contains("throw");
    if handlers.is_empty() || !handlers.iter().all(|&(a, b, _)| acts(&f.text[a..b])) {
        return None;
    }
    handlers
        .iter()
        .map(|&(a, b, braced)| {
            let empty = if braced {
                Some("{}".to_string())
            } else {
                f.empty_block.clone()
            };
            empty.map(|e| (a, b, e))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_mutation_changes_only_what_it_targets_and_still_parses() {
        let root = std::env::temp_dir().join(format!("gaia-mutate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let python = "def load(path_name, retries):\n    \"\"\"Reads the file at path_name, trying again up to retries times.\"\"\"\n    for attempt in range(retries):\n        try:\n            return open(path_name).read()\n        except OSError as error:\n            raise RuntimeError(path_name) from error\n    return None\n";
        let other = "def save(text, target):\n    \"\"\"Writes text to the file named target and returns how many bytes it wrote.\"\"\"\n    with open(target, \"w\") as out:\n        written = out.write(text)\n        out.flush()\n        return written\n";
        let ts = "/** Splits the input on slashes and joins the trimmed parts with dashes. */\nexport function slug(input: string, separator: string): string {\n  try {\n    return input.split(separator).map((p) => p.trim()).join(\"-\");\n  } catch (error) {\n    throw new Error(String(error));\n  }\n}\n";
        for (path, text) in [("a.py", python), ("b.py", other), ("c.ts", ts)] {
            write(&root.join(path), text).unwrap();
        }
        let out = root.join("out");
        let manifest = run(&root.join("."), &out, 5).unwrap();
        let kinds: BTreeSet<&str> = manifest["mutations"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|m| m["kind"].as_str())
            .collect();
        assert_eq!(kinds, ["doc", "handler", "names"].into_iter().collect());
        for m in manifest["mutations"].as_array().unwrap() {
            let (kind, file) = (m["kind"].as_str().unwrap(), m["file"].as_str().unwrap());
            let source = std::fs::read_to_string(root.join(file)).unwrap();
            let original =
                std::fs::read_to_string(out.join(kind).join("original").join(file)).unwrap();
            let mutant = std::fs::read_to_string(out.join(kind).join("mutant").join(file)).unwrap();
            assert_eq!(original, source, "the original copy is untouched");
            assert_ne!(mutant, source, "{kind} changed {file}");
            let spec = languages::of_path(file).unwrap();
            let parsed = parse::parse(&languages::load(&spec.name).unwrap(), &mutant).unwrap();
            assert_eq!(parsed.unparsed, 0, "{kind} of {file} still parses");
            match kind {
                "names" => {
                    // A doc's words stay; the signature's names go.
                    let signature = |t: &str| {
                        t.lines()
                            .find(|l| l.starts_with("def ") || l.contains("function "))
                            .unwrap_or("")
                            .to_string()
                    };
                    let renamed = signature(&mutant);
                    assert!(
                        [
                            "path_name",
                            "retries",
                            "text",
                            "target",
                            "input",
                            "separator"
                        ]
                        .iter()
                        .all(|p| !renamed.contains(&format!("{p}:"))
                            && !renamed.contains(&format!("{p},"))
                            && !renamed.contains(&format!("{p})")))
                    );
                }
                "doc" => assert!(!mutant.contains(source.lines().nth(1).unwrap().trim())),
                _ => assert!(!mutant.contains("raise") && !mutant.contains("throw")),
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
