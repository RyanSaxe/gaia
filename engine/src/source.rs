//! Reads one file's own facts from its text: its language and kind, lines,
//! leading comment, exported symbols with their doc comments, the modules it
//! imports, rough complexity and debt markers. A careful line-based first
//! pass for TypeScript, JavaScript and Rust, not a parser: a small lexer
//! keeps comments and strings apart from code, so braces in a GLSL template
//! or a URL in a string never count. Other languages get lines and kind.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Symbol {
    pub name: String,
    pub kind: &'static str,
    pub exported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc: Option<String>,
}

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Complexity {
    pub functions: u32,
    pub longest_function: u32,
    pub max_nesting: u32,
}

/// What one file says about itself, before the project links files together.
#[derive(Debug, Default)]
pub struct Source {
    pub language: &'static str,
    pub kind: &'static str,
    pub lines: u32,
    pub doc: Option<String>,
    pub symbols: Vec<Symbol>,
    /// Import specifiers as written, such as "./walk.ts" or "@gaia/schema"; for Rust, `mod` names.
    pub specifiers: Vec<String>,
    /// Specifiers of `export * from "…"`, whose exports this file passes on.
    pub reexports: Vec<String>,
    pub complexity: Complexity,
    pub debt_markers: u32,
    /// Rust: a `#[cfg(test)]` module, so the file tests itself.
    pub inline_tests: bool,
}

/// The language a path is written in, by its extension or name.
pub fn language_of(path: &str) -> &'static str {
    let name = path.rsplit('/').next().unwrap_or(path);
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    match ext {
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "rs" => "rust",
        "py" => "python",
        "go" => "go",
        "md" | "mdx" => "markdown",
        "json" => "json",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "html" => "html",
        "css" => "css",
        "glsl" | "vert" | "frag" => "glsl",
        "sh" => "shell",
        "svg" => "svg",
        "txt" => "text",
        _ if name == "pre-commit" || name.ends_with("rc") => "shell",
        _ => "other",
    }
}

/// What part a file plays: source, test, config, data, docs or script.
pub fn kind_of(path: &str, language: &str) -> &'static str {
    let name = path.rsplit('/').next().unwrap_or(path);
    let in_dir = |d: &str| path.starts_with(&format!("{d}/")) || path.contains(&format!("/{d}/"));
    if name.contains(".test.")
        || name.contains(".spec.")
        || name.ends_with("_test.rs")
        || in_dir("test")
        || in_dir("tests")
        || in_dir("__tests__")
    {
        return "test";
    }
    if name.ends_with(".lock")
        || name.ends_with("-lock.yaml")
        || name.ends_with("-lock.json")
        || in_dir("fixtures")
    {
        return "data";
    }
    match language {
        "markdown" | "text" => "docs",
        "json" | "toml" | "yaml" => "config",
        "shell" => "script",
        _ if name.contains(".config.") || name.starts_with('.') => "config",
        "typescript" | "javascript" | "rust" | "python" | "go" | "glsl" | "html" | "css" => {
            "source"
        }
        _ => "data",
    }
}

/// One line split into its code (strings blanked) and its comment text.
struct Lexed {
    code: String,
    comment: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Code,
    Block,
    Template,
}

/// A lexer that carries block comments and template strings across lines.
struct Lexer {
    mode: Mode,
    rust: bool,
}

impl Lexer {
    fn line(&mut self, line: &str) -> Lexed {
        let chars: Vec<char> = line.chars().collect();
        let mut code = String::new();
        let mut comment = String::new();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            let next = chars.get(i + 1).copied();
            match self.mode {
                Mode::Block => {
                    if c == '*' && next == Some('/') {
                        self.mode = Mode::Code;
                        i += 2;
                    } else {
                        comment.push(c);
                        i += 1;
                    }
                }
                Mode::Template => {
                    if c == '\\' {
                        i += 2;
                    } else {
                        if c == '`' {
                            self.mode = Mode::Code;
                            code.push('`');
                        }
                        i += 1;
                    }
                }
                Mode::Code => {
                    if c == '/' && next == Some('/') {
                        comment.extend(&chars[i + 2..]);
                        break;
                    } else if c == '/' && next == Some('*') {
                        self.mode = Mode::Block;
                        i += 2;
                    } else if c == '`' && !self.rust {
                        self.mode = Mode::Template;
                        code.push('`');
                        i += 1;
                    } else if c == '"' || (c == '\'' && !self.rust) {
                        // A string's text is kept (imports read it) but its braces never count.
                        code.push(c);
                        i += 1;
                        while i < chars.len() && chars[i] != c {
                            if chars[i] == '\\' {
                                i += 1;
                            } else if chars[i] != '{' && chars[i] != '}' {
                                code.push(chars[i]);
                            }
                            i += 1;
                        }
                        code.push(c);
                        i += 1;
                    } else if c == '\'' && self.rust {
                        // A char literal such as '{' or '\n'; otherwise a lifetime.
                        if chars.get(i + 2) == Some(&'\'') {
                            i += 3;
                        } else if next == Some('\\') {
                            i += 2;
                            while i < chars.len() && chars[i] != '\'' {
                                i += 1;
                            }
                            i += 1;
                        } else {
                            i += 1;
                        }
                    } else {
                        code.push(c);
                        i += 1;
                    }
                }
            }
        }
        Lexed { code, comment }
    }
}

const DEBT: [&str; 4] = ["TODO", "FIXME", "XXX", "HACK"];
const DOC_CAP: usize = 400;

/// Joins comment lines into one paragraph, trimmed and capped.
fn paragraph(lines: &[String]) -> Option<String> {
    let text = lines
        .iter()
        .map(|l| l.trim().trim_start_matches('*').trim())
        .filter(|l| !l.is_empty() && !l.starts_with('@'))
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        return None;
    }
    if text.chars().count() <= DOC_CAP {
        return Some(text);
    }
    let cut: String = text.chars().take(DOC_CAP).collect();
    Some(format!("{}…", cut.trim_end()))
}

/// The first identifier in `s`.
fn ident(s: &str) -> Option<String> {
    let name: String = s
        .trim_start()
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$')
        .collect();
    if name.is_empty() { None } else { Some(name) }
}

/// The quoted text after `marker` in `code`, such as the specifier after `from `.
fn quoted_after(code: &str, marker: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = code;
    while let Some(at) = rest.find(marker) {
        rest = &rest[at + marker.len()..];
        let trimmed = rest.trim_start();
        if let Some(q) = trimmed.chars().next().filter(|c| *c == '"' || *c == '\'')
            && let Some(end) = trimmed[1..].find(q)
        {
            out.push(trimmed[1..1 + end].to_string());
        }
    }
    out
}

/// A TypeScript or JavaScript export on one line of code, with its kind.
fn ts_export(code: &str) -> Vec<(String, &'static str)> {
    let Some(rest) = code.trim_start().strip_prefix("export ") else {
        return Vec::new();
    };
    let mut rest = rest.trim_start();
    for word in ["default ", "declare ", "async ", "abstract "] {
        rest = rest.strip_prefix(word).unwrap_or(rest).trim_start();
    }
    let pick = |word: &str, kind: &'static str| {
        rest.strip_prefix(word)
            .and_then(ident)
            .map(|n| vec![(n, kind)])
    };
    if let Some(found) = pick("function* ", "function")
        .or_else(|| pick("function ", "function"))
        .or_else(|| pick("class ", "class"))
        .or_else(|| pick("interface ", "type"))
        .or_else(|| pick("enum ", "type"))
        .or_else(|| pick("namespace ", "module"))
    {
        return found;
    }
    if let Some(after) = rest.strip_prefix("type ") {
        if !after.trim_start().starts_with('{') {
            return ident(after).map(|n| vec![(n, "type")]).unwrap_or_default();
        }
        rest = after.trim_start();
    }
    for word in ["const ", "let ", "var "] {
        if let Some(after) = rest.strip_prefix(word) {
            let Some(name) = ident(after) else {
                return Vec::new();
            };
            let value = after
                .split_once('=')
                .map(|(_, v)| v.trim_start())
                .unwrap_or("");
            let kind = if value.starts_with("(")
                || value.starts_with("async")
                || value.starts_with("function")
            {
                "function"
            } else {
                "constant"
            };
            return vec![(name, kind)];
        }
    }
    // `export { a, b as c }` and `export type { A } from "…"`: each name it passes on.
    if let Some(list) = rest.strip_prefix('{') {
        let inner = list.split('}').next().unwrap_or("");
        return inner
            .split(',')
            .filter_map(|part| {
                let part = part.trim().trim_start_matches("type ").trim();
                let name = part.rsplit(" as ").next().unwrap_or(part);
                ident(name)
                    .filter(|n| n != "default")
                    .map(|n| (n, "constant"))
            })
            .collect();
    }
    Vec::new()
}

/// A Rust `pub` item on one line of code, with its kind.
fn rust_pub(code: &str) -> Option<(String, &'static str)> {
    let rest = code.trim_start().strip_prefix("pub ")?;
    let mut rest = rest.trim_start();
    if let Some(after) = rest.strip_prefix("const fn ") {
        return ident(after).map(|n| (n, "function"));
    }
    for word in ["async ", "unsafe ", "extern \"C\" "] {
        rest = rest.strip_prefix(word).unwrap_or(rest);
    }
    for (word, kind) in [
        ("fn ", "function"),
        ("struct ", "class"),
        ("enum ", "type"),
        ("trait ", "type"),
        ("type ", "type"),
        ("const ", "constant"),
        ("static ", "constant"),
        ("mod ", "module"),
    ] {
        if let Some(after) = rest.strip_prefix(word) {
            return ident(after).map(|n| (n, kind));
        }
    }
    None
}

/// Reads one file's facts from its path and text.
pub fn read(path: &str, text: &str) -> Source {
    let language = language_of(path);
    let kind = kind_of(path, language);
    let lines = text.lines().count() as u32;
    let mut out = Source {
        language,
        kind,
        lines,
        ..Source::default()
    };
    let rust = language == "rust";
    if !(rust || language == "typescript" || language == "javascript") {
        out.doc = leading_hash_comment(text);
        return out;
    }

    let mut lexer = Lexer {
        mode: Mode::Code,
        rust,
    };
    let mut leading: Vec<String> = Vec::new();
    let mut leading_open = true;
    let mut leading_jsdoc = false;
    // Doc comment lines waiting for the item they describe.
    let mut pending: Vec<String> = Vec::new();
    let mut in_doc_block = false;
    let mut depth: i64 = 0;
    // Each open function: the depth it opened at and its first line.
    let mut open: Vec<(i64, usize)> = Vec::new();
    let mut fn_waiting: Option<usize> = None;

    for (n, raw) in text.lines().enumerate() {
        let trimmed = raw.trim_start();
        let was_block = lexer.mode == Mode::Block;
        let lexed = lexer.line(raw);

        // The file's leading comment: its first run of comment lines.
        if leading_open {
            if n == 0 && trimmed.starts_with("#!") {
                continue;
            }
            let is_comment = lexed.code.trim().is_empty()
                && (was_block || trimmed.starts_with("//") || trimmed.starts_with("/*"));
            if is_comment && !(rust && trimmed.starts_with("///")) {
                leading_jsdoc |= leading.is_empty() && trimmed.starts_with("/**");
                leading.push(
                    lexed
                        .comment
                        .trim_start_matches(['!', '/', '*'])
                        .to_string(),
                );
                continue;
            }
            if !(trimmed.is_empty() && leading.is_empty()) {
                leading_open = false;
                // A doc block right above the first item is that item's doc, not the file's.
                if leading_jsdoc && !trimmed.is_empty() {
                    pending = std::mem::take(&mut leading);
                }
            }
        }

        out.debt_markers += DEBT
            .iter()
            .map(|m| lexed.comment.matches(m).count() as u32)
            .sum::<u32>();

        // Doc comments: `/** … */` blocks, and `///` lines in Rust.
        if trimmed.starts_with("/**") || (in_doc_block && was_block) {
            if trimmed.starts_with("/**") {
                pending.clear();
            }
            in_doc_block = lexer.mode == Mode::Block;
            pending.push(lexed.comment.trim_start_matches('*').to_string());
            if lexed.code.trim().is_empty() {
                continue;
            }
        } else if rust && trimmed.starts_with("///") {
            pending.push(lexed.comment.trim_start_matches('/').to_string());
            continue;
        }
        let code = lexed.code;
        let stripped = code.trim();
        if stripped.is_empty() {
            continue;
        }

        // Symbols and imports.
        if rust {
            if let Some((name, kind)) = rust_pub(&code) {
                out.symbols.push(Symbol {
                    name,
                    kind,
                    exported: true,
                    doc: paragraph(&pending),
                });
            }
            if stripped.starts_with("#[cfg(test)]") {
                out.inline_tests = true;
            }
            let decl = stripped.strip_prefix("pub ").unwrap_or(stripped);
            if let Some(m) = decl.strip_prefix("mod ").and_then(|r| r.strip_suffix(';')) {
                out.specifiers.push(m.trim().to_string());
            }
        } else {
            for (name, kind) in ts_export(&code) {
                out.symbols.push(Symbol {
                    name,
                    kind,
                    exported: true,
                    doc: paragraph(&pending),
                });
            }
            let mut found = quoted_after(&code, " from ");
            found.extend(quoted_after(&code, "}from "));
            found.extend(quoted_after(&code, "import("));
            if stripped.starts_with("import ") {
                found.extend(quoted_after(stripped, "import "));
            }
            if stripped.starts_with("export *") {
                out.reexports.extend(quoted_after(&code, " from "));
            }
            out.specifiers.extend(
                found
                    .into_iter()
                    .map(|s| s.split('?').next().unwrap_or("").to_string()),
            );
        }
        if !stripped.starts_with('@') && !stripped.starts_with("#[") {
            pending.clear();
        }

        // Functions, how long each runs and how deep its braces nest.
        let starts_fn = if rust {
            code.split("fn ").nth(1).and_then(ident).is_some()
        } else {
            code.contains("function") || code.contains("=>")
        };
        if starts_fn {
            out.complexity.functions += 1;
            fn_waiting = Some(n);
        }
        for c in code.chars() {
            match c {
                '{' => {
                    if let Some(start) = fn_waiting.take() {
                        open.push((depth, start));
                    }
                    depth += 1;
                    if let Some((base, _)) = open.first() {
                        out.complexity.max_nesting = out
                            .complexity
                            .max_nesting
                            .max((depth - base - 1).max(0) as u32);
                    }
                }
                '}' => {
                    depth -= 1;
                    if let Some(&(base, start)) = open.last()
                        && depth == base
                    {
                        open.pop();
                        out.complexity.longest_function =
                            out.complexity.longest_function.max((n - start + 1) as u32);
                    }
                }
                ';' => fn_waiting = None,
                _ => {}
            }
        }
        // An arrow function without a body, such as an argument, opens nothing.
        if stripped.ends_with(',') || stripped.ends_with(';') {
            fn_waiting = None;
        }
    }
    out.doc = paragraph(&leading);
    out.specifiers.sort();
    out.specifiers.dedup();
    out
}

/// A shell script's or config's leading `#` comment.
fn leading_hash_comment(text: &str) -> Option<String> {
    let lines: Vec<String> = text
        .lines()
        .skip_while(|l| l.starts_with("#!"))
        .take_while(|l| l.trim_start().starts_with('#') && !l.trim_start().starts_with("#["))
        .map(|l| l.trim_start().trim_start_matches('#').to_string())
        .collect();
    paragraph(&lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_typescript_module() {
        let text = r#"// Walking and wading: every step is pure,
// so tests check each one.

import { rand } from "@gaia/schema";
import type { Lattice } from "./lattice.ts";
import {
  a,
  b,
} from './multi.ts';
export * from "./more.ts";
const GLSL = `
void main() { if (x) { y(); } }
`;

/** How fast a person walks, meters per second. */
export const PACE = 1.4;

/**
 * Takes one step.
 * @param t the terrain
 */
export function step(t: number): number {
  if (t > 0) {
    // TODO: wade
    return t;
  }
  return "{".length;
}
export { step as walkStep, PACE as pace };
"#;
        let s = read("packages/terrain/src/walk.ts", text);
        assert_eq!(s.language, "typescript");
        assert_eq!(s.kind, "source");
        assert_eq!(
            s.doc.as_deref(),
            Some("Walking and wading: every step is pure, so tests check each one.")
        );
        assert_eq!(
            s.specifiers,
            vec!["./lattice.ts", "./more.ts", "./multi.ts", "@gaia/schema"]
        );
        assert_eq!(s.reexports, vec!["./more.ts"]);
        let names: Vec<_> = s
            .symbols
            .iter()
            .map(|s| (s.name.as_str(), s.kind))
            .collect();
        assert_eq!(
            names,
            vec![
                ("PACE", "constant"),
                ("step", "function"),
                ("walkStep", "constant"),
                ("pace", "constant")
            ]
        );
        assert_eq!(
            s.symbols[0].doc.as_deref(),
            Some("How fast a person walks, meters per second.")
        );
        assert_eq!(s.symbols[1].doc.as_deref(), Some("Takes one step."));
        assert_eq!(s.debt_markers, 1);
        // The braces in the GLSL template and the string never count.
        assert_eq!(s.complexity.longest_function, 7);
        assert_eq!(s.complexity.max_nesting, 1);
    }

    #[test]
    fn reads_a_rust_module() {
        let text = r#"//! The engine protocol.
//! Newline-delimited JSON-RPC.

mod rpc;
pub mod source;

/// The engine's version.
pub const VERSION: &str = "1";

pub fn handle<'a>(line: &'a str) -> char {
    if line.is_empty() { return '{'; }
    '}'
}

#[cfg(test)]
mod tests {}
"#;
        let s = read("engine/src/main.rs", text);
        assert_eq!(
            s.doc.as_deref(),
            Some("The engine protocol. Newline-delimited JSON-RPC.")
        );
        assert_eq!(s.specifiers, vec!["rpc", "source"]);
        let names: Vec<_> = s
            .symbols
            .iter()
            .map(|s| (s.name.as_str(), s.kind))
            .collect();
        assert_eq!(
            names,
            vec![
                ("source", "module"),
                ("VERSION", "constant"),
                ("handle", "function")
            ]
        );
        assert_eq!(s.symbols[1].doc.as_deref(), Some("The engine's version."));
        assert!(s.inline_tests);
        assert_eq!(s.complexity.longest_function, 4);
    }

    #[test]
    fn sorts_files_by_the_part_they_play() {
        assert_eq!(
            kind_of("packages/world/test/planner.test.ts", "typescript"),
            "test"
        );
        assert_eq!(kind_of("engine/tests/cli.rs", "rust"), "test");
        assert_eq!(kind_of("docs/architecture.md", "markdown"), "docs");
        assert_eq!(kind_of("pnpm-lock.yaml", "yaml"), "data");
        assert_eq!(kind_of("package.json", "json"), "config");
        assert_eq!(kind_of("eslint.config.js", "javascript"), "config");
        assert_eq!(kind_of(".githooks/pre-commit", "shell"), "script");
    }
}
