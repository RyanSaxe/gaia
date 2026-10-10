//! The generic loop: one file's tree and query matches into definitions,
//! blocks, references and literals, with their measures. Nothing here is
//! about one language; everything comes from the capture names on the
//! parse page (`docs/architecture.md`, "The code graph"):
//!
//! - `@definition.<role>` with `@name`; `@owner` with the `@scope` it covers;
//!   `@params` (a list of parameters) or `@param` (each one) where a grammar
//!   has no `parameters` field; `@doc` for a docstring.
//! - `@reference.import`, `.call`, `.send`, `.class`, `.type`, `.interface`
//!   and `.implementation`, each with `@name`.
//! - `@block.<shape>`; `@decide.else`, `.elseif`, `.case`, `.catch` and
//!   `.logic`, which the measures count; `@literal`.

use super::languages::{self, Loaded};
use super::model::{Measures, Span};
use std::collections::{HashMap, HashSet};
use streaming_iterator::StreamingIterator;
use tree_sitter::{Node, Parser, Query, QueryCursor, Range};

/// What one file holds, before ids: indices point into `defs`.
pub struct FileParse {
    pub unparsed: u32,
    pub measures: Measures,
    pub defs: Vec<Def>,
    pub blocks: Vec<Block>,
    pub refs: Vec<Ref>,
    // Read by the names rule, which comes with the import and call rules in step 2.
    #[allow(dead_code)]
    pub literals: Vec<Literal>,
}

pub struct Def {
    pub name: String,
    /// Its name qualified by its enclosing definitions or its owner, with
    /// `~2`, `~3` for a repeat in the same scope.
    pub qualified: String,
    pub role: String,
    pub parent: Option<usize>,
    pub owner: Option<String>,
    pub span: Span,
    pub signature: String,
    pub doc: Option<String>,
    pub measures: Measures,
    /// It takes parameters, or its role says it runs.
    pub callable: bool,
    /// A MinHash of its text's word shingles, for near-duplicates and lineage.
    pub fingerprint: Vec<u16>,
    /// How many distinct shingles its text has.
    pub shingles: usize,
    /// The name its body calls its own receiver by, when a grammar marks it
    /// with `@self`: the `c` of Go's `func (c *Command)`.
    pub self_name: Option<String>,
}

pub struct Block {
    pub def: Option<usize>,
    pub shape: String,
    pub span: Span,
    pub depth: u32,
    /// Its place among the blocks of its definition (or its file), in source order.
    pub index: usize,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RefKind {
    Import,
    Call,
    Reference,
    Implements,
}

pub struct Ref {
    pub kind: RefKind,
    pub text: String,
    pub at: Span,
    pub from: Option<usize>,
    /// What a call names before its own name: `Batch` in `Batch::new`, `self` in `self.push`.
    pub qualifier: Option<String>,
    /// A macro invocation, such as Rust's `format!(…)`, which reaches only a macro.
    pub macro_call: bool,
}

#[allow(dead_code)]
pub struct Literal {
    pub text: String,
    pub at: Span,
    pub from: Option<usize>,
}

/// The number of hashes in a fingerprint.
pub const FINGERPRINT: usize = 64;

fn splitmix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9e37_79b9_7f4a_7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

/// A MinHash of a text's word 3-grams, and how many distinct ones it has.
pub fn fingerprint(text: &str) -> (Vec<u16>, usize) {
    let words: Vec<&str> = text
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|w| !w.is_empty())
        .collect();
    let mut shingles: HashSet<u64> = HashSet::new();
    let width = words.len().clamp(1, 3);
    for w in words.windows(width) {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for part in w {
            for b in part.bytes().chain(std::iter::once(0)) {
                h ^= u64::from(b);
                h = h.wrapping_mul(0x0100_0000_01b3);
            }
        }
        shingles.insert(h);
    }
    let mins = (0..FINGERPRINT as u64)
        .map(|seed| {
            let salt = splitmix(seed);
            shingles
                .iter()
                .map(|h| (splitmix(h ^ salt) >> 48) as u16)
                .min()
                .unwrap_or(u16::MAX)
        })
        .collect();
    (mins, shingles.len())
}

/// The share of hashes two fingerprints agree on: an estimate of their shingles' overlap.
pub fn similarity(a: &[u16], b: &[u16]) -> f64 {
    let same = a.iter().zip(b).filter(|(x, y)| x == y).count();
    same as f64 / FINGERPRINT as f64
}

/// Roles that hold other definitions rather than run.
const CONTAINERS: &[&str] = &[
    "class",
    "interface",
    "module",
    "enum",
    "type",
    "struct",
    "trait",
    "union",
    "object",
    "namespace",
    "impl",
];
/// Roles a definition can run as, even with no list of parameters (Ruby's `def walk`).
const CALLABLES: &[&str] = &["function", "method", "macro", "constructor"];
const MARKERS: &[&str] = &["TODO", "FIXME", "XXX", "HACK"];

/// One query match, reduced to the capture that says what it is.
struct Hit<'t> {
    what: String,
    node: Node<'t>,
    name: Option<Node<'t>>,
    owner: Option<Node<'t>>,
    from_tags: bool,
}

fn collect<'t>(query: &Query, root: Node<'t>, src: &[u8], from_tags: bool, out: &mut Vec<Hit<'t>>) {
    let names = query.capture_names();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(query, root, src);
    while let Some(m) = matches.next() {
        let mut main: Option<(String, Node<'t>)> = None;
        let mut name = None;
        let mut owner = None;
        for c in m.captures {
            let cn = names[c.index as usize];
            match cn {
                "name" => name = Some(c.node),
                "owner" => owner = Some(c.node),
                _ if cn.starts_with('_') => {}
                _ => {
                    // The match's own kind: its first capture that isn't a
                    // helper. A tags query captures a doc comment before the
                    // definition it documents, so a doc yields to anything else.
                    if main.as_ref().is_none_or(|(w, _)| w == "doc") {
                        main = Some((cn.to_string(), c.node));
                    }
                }
            }
        }
        if let Some((what, node)) = main {
            out.push(Hit {
                what,
                node,
                name,
                owner,
                from_tags,
            });
        }
    }
}

/// What a language without our query file still yields, read from node
/// kinds most grammars share: blocks, the decisions the measures count, and
/// definitions too when it has no tags query either.
fn fallback<'t>(root: Node<'t>, definitions: bool, src: &str, out: &mut Vec<Hit<'t>>) {
    let mut stack = vec![root];
    while let Some(n) = stack.pop() {
        let mut c = n.walk();
        stack.extend(n.named_children(&mut c));
        let kind = n.kind();
        let words: Vec<&str> = kind.split('_').collect();
        let has = |w: &[&str]| words.iter().any(|x| w.contains(x));
        let construct =
            kind.ends_with("statement") || kind.ends_with("expression") || words.len() == 1;
        let name = n.child_by_field_name("name");
        let named_definition = kind.ends_with("_definition")
            || kind.ends_with("_declaration")
            || kind.ends_with("_item")
            || matches!(kind, "function" | "method" | "class" | "module");
        let what = if definitions && named_definition && name.is_some() {
            let role = kind
                .trim_end_matches("_definition")
                .trim_end_matches("_declaration")
                .trim_end_matches("_item");
            format!("definition.{role}")
        } else if has(&["elif", "elsif", "elseif"]) || kind == "else_if_clause" {
            "decide.elseif".into()
        } else if matches!(kind, "else" | "else_clause" | "else_statement") {
            "decide.else".into()
        } else if has(&["if"]) && construct {
            "block.branch".into()
        } else if has(&["for", "while", "loop", "repeat", "until"]) && construct {
            "block.loop".into()
        } else if has(&["switch", "match", "case", "when", "select"]) && construct {
            "block.match".into()
        } else if has(&["try"]) && construct {
            "block.try".into()
        } else if has(&["lambda", "closure"])
            || matches!(
                kind,
                "anonymous_function" | "function_expression" | "arrow_function" | "func_literal"
            )
        {
            "block.closure".into()
        } else if has(&["catch", "rescue", "except"]) {
            "decide.catch".into()
        } else if has(&["case", "arm", "alternative"]) && !construct {
            "decide.case".into()
        } else if has(&["binary", "boolean"])
            && matches!(operator(n, src).as_str(), "&&" | "||" | "and" | "or")
        {
            "decide.logic".into()
        } else {
            continue;
        };
        out.push(Hit {
            what,
            node: n,
            name,
            owner: None,
            from_tags: false,
        });
    }
}

fn text<'a>(node: Node, src: &'a str) -> &'a str {
    &src[node.byte_range()]
}

fn span_of(node: Node) -> Span {
    Span {
        start: node.start_position().row as u32 + 1,
        end: node.end_position().row as u32 + 1,
    }
}

fn contains(outer: Node, inner: Node) -> bool {
    outer.start_byte() <= inner.start_byte() && inner.end_byte() <= outer.end_byte()
}

fn is_comment(node: Node) -> bool {
    node.kind().contains("comment")
}

fn has_marker(s: &str) -> bool {
    MARKERS.iter().any(|m| s.contains(m))
}

/// Strips quotes and whitespace around a specifier or literal as written.
fn clean(s: &str) -> String {
    s.trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '`')
        .trim()
        .to_string()
}

/// A method's owner as written, without generics or a pointer: `Batch` from `*Batch` or `Batch<T>`.
fn clean_owner(s: &str) -> String {
    let s = s.trim().trim_start_matches('&').trim_start_matches('*');
    let end = s.find(['<', '[', '(']).unwrap_or(s.len());
    s[..end].trim().to_string()
}

/// The node holding a definition's parameters and body: the definition
/// itself, or a function it wraps, such as `const f = () => {}`. The search
/// stays out of bodies, so a class never finds its methods' parameters.
fn function_node(def: Node) -> Option<Node> {
    let mut queue = vec![(def, 0)];
    while let Some((n, depth)) = queue.pop() {
        if n.child_by_field_name("parameters").is_some() {
            return Some(n);
        }
        if depth >= 2 {
            continue;
        }
        let mut c = n.walk();
        for ch in n.named_children(&mut c) {
            let k = ch.kind();
            if !(k.contains("body") || k.contains("block") || k.contains("list") || is_comment(ch))
            {
                queue.insert(0, (ch, depth + 1));
            }
        }
    }
    None
}

/// Its text up to its body, whitespace collapsed, cut at 240 characters.
fn signature(def: Node, function: Option<Node>, src: &str) -> String {
    let body = def
        .child_by_field_name("body")
        .or_else(|| function.and_then(|f| f.child_by_field_name("body")));
    let raw = match body {
        Some(b) if b.start_byte() > def.start_byte() => &src[def.start_byte()..b.start_byte()],
        _ => text(def, src).lines().next().unwrap_or(""),
    };
    let mut s = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    while s.ends_with('{') || s.ends_with(':') {
        s.pop();
        s = s.trim_end().to_string();
    }
    if s.chars().count() > 240 {
        s = s.chars().take(240).collect();
    }
    s
}

/// A comment's words, without its markers.
fn comment_words(s: &str) -> String {
    s.lines()
        .map(|l| {
            let mut l = l.trim();
            for p in ["///", "//!", "//", "/**", "/*", "#", "--", "<!--", "\"\"\""] {
                if let Some(rest) = l.strip_prefix(p) {
                    l = rest;
                    break;
                }
            }
            for p in ["*/", "-->", "\"\"\""] {
                if let Some(rest) = l.strip_suffix(p) {
                    l = rest;
                }
            }
            l.trim().trim_start_matches('*').trim()
        })
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Comments that only steer a tool, never describe the code.
fn is_directive(words: &str) -> bool {
    [
        "eslint-",
        "@ts-",
        "prettier-ignore",
        "biome-ignore",
        "noqa",
        "type: ignore",
    ]
    .iter()
    .any(|p| words.starts_with(p))
}

/// The run of comments directly above a definition, read through anything
/// wrapping it to its end (an `export`, a decorator) and past attributes.
fn doc_above(def: Node, src: &str) -> Option<String> {
    let mut node = def;
    while let Some(p) = node.parent() {
        if p.end_byte() != def.end_byte() || p.parent().is_none() {
            break;
        }
        node = p;
    }
    let mut lines: Vec<String> = Vec::new();
    let mut top = node.start_position().row;
    let mut prev = node.prev_named_sibling();
    while let Some(p) = prev {
        if p.end_position().row + 1 < top {
            break;
        }
        if is_comment(p) {
            let words = comment_words(text(p, src));
            if !is_directive(&words) {
                lines.push(words);
            }
        } else if !p.kind().contains("attribute") {
            break;
        }
        top = p.start_position().row;
        prev = p.prev_named_sibling();
    }
    lines.reverse();
    let doc = lines.join(" ").trim().to_string();
    (!doc.is_empty()).then_some(doc)
}

/// The operator a logical expression applies, so runs of the same one count once.
fn operator(node: Node, src: &str) -> String {
    if let Some(op) = node.child_by_field_name("operator") {
        return text(op, src).to_string();
    }
    let mut c = node.walk();
    for ch in node.children(&mut c) {
        if !ch.is_named() && matches!(text(ch, src), "&&" | "||" | "and" | "or") {
            return text(ch, src).to_string();
        }
    }
    node.kind().to_string()
}

/// The node ids each kind of decision covers.
#[derive(Default)]
struct Decisions {
    branch: HashSet<usize>,
    loops: HashSet<usize>,
    matches: HashSet<usize>,
    nests: HashSet<usize>,
    elses: HashSet<usize>,
    elseifs: HashSet<usize>,
    cases: HashSet<usize>,
    catches: HashSet<usize>,
    logic: HashSet<usize>,
}

impl Decisions {
    /// An else that only leads into an else-if, which counts itself.
    fn leads_to_elseif(&self, n: Node) -> bool {
        let mut c = n.walk();
        let inside = n
            .named_children(&mut c)
            .any(|ch| self.elseifs.contains(&ch.id()));
        inside
            || n.next_named_sibling()
                .is_some_and(|s| self.elseifs.contains(&s.id()))
    }

    /// True when the node is, or wraps, the next link of an else-if chain.
    fn continues_chain(&self, n: Node) -> bool {
        if self.elses.contains(&n.id()) || self.elseifs.contains(&n.id()) {
            return true;
        }
        let mut c = n.walk();
        n.named_children(&mut c)
            .any(|ch| self.elseifs.contains(&ch.id()))
    }

    /// SonarSource's cognitive complexity of everything under `node`.
    /// `own` are the nodes of the definition being measured, which add no nesting.
    fn cognitive(&self, node: Node, nest: u32, in_function: bool, own: &[usize], src: &str) -> u32 {
        let id = node.id();
        let mut c = node.walk();
        let children: Vec<Node> = node.children(&mut c).collect();
        let walk_all = |nest: u32, in_function: bool| -> u32 {
            children
                .iter()
                .map(|ch| self.cognitive(*ch, nest, in_function, own, src))
                .sum()
        };
        if self.elseifs.contains(&id) {
            // `else if`, `elif`, `elsif`: one, flat; its body nests like the chain's first.
            return 1 + self.chain_children(&children, nest, in_function, own, src);
        }
        if self.branch.contains(&id) {
            return 1 + nest + self.chain_children(&children, nest, in_function, own, src);
        }
        if self.elses.contains(&id) {
            if self.leads_to_elseif(node) {
                return walk_all(nest, in_function);
            }
            return 1 + walk_all(nest + 1, in_function);
        }
        if self.loops.contains(&id) || self.matches.contains(&id) || self.catches.contains(&id) {
            return 1 + nest + walk_all(nest + 1, in_function);
        }
        if self.nests.contains(&id) && !own.contains(&id) {
            return walk_all(if in_function { nest + 1 } else { nest }, true);
        }
        let mut total = 0;
        if self.logic.contains(&id) {
            let mut parent = node.parent();
            while let Some(p) = parent.filter(|p| p.kind().contains("parenthes")) {
                parent = p.parent();
            }
            let same = parent.is_some_and(|p| {
                self.logic.contains(&p.id()) && operator(p, src) == operator(node, src)
            });
            if !same {
                total += 1;
            }
        }
        total + walk_all(nest, in_function)
    }

    /// A branch's children: the next link of its chain stays at its level, the rest nests.
    fn chain_children(
        &self,
        children: &[Node],
        nest: u32,
        in_function: bool,
        own: &[usize],
        src: &str,
    ) -> u32 {
        children
            .iter()
            .map(|ch| {
                let level = if self.continues_chain(*ch) {
                    nest
                } else {
                    nest + 1
                };
                self.cognitive(*ch, level, in_function, own, src)
            })
            .sum()
    }

    /// McCabe's cyclomatic complexity: one, plus every decision under `node`.
    fn cyclomatic(&self, node: Node) -> u32 {
        let mut count = 1;
        let mut stack = vec![node];
        while let Some(n) = stack.pop() {
            let id = n.id();
            if self.branch.contains(&id)
                || self.elseifs.contains(&id)
                || self.loops.contains(&id)
                || self.cases.contains(&id)
                || self.catches.contains(&id)
                || self.logic.contains(&id)
            {
                count += 1;
            }
            let mut c = n.walk();
            stack.extend(n.children(&mut c));
        }
        count
    }
}

fn count_unparsed(node: Node) -> u32 {
    let mut count = 0;
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        if n.is_error() || n.is_missing() {
            count += 1;
        }
        let mut c = n.walk();
        stack.extend(n.children(&mut c));
    }
    count
}

fn comments_in<'t>(node: Node<'t>, out: &mut Vec<Node<'t>>) {
    let mut stack = vec![node];
    while let Some(n) = stack.pop() {
        if is_comment(n) {
            out.push(n);
            continue;
        }
        let mut c = n.walk();
        stack.extend(n.named_children(&mut c));
    }
}

/// Parses one file and reads everything its queries capture.
pub fn parse(lang: &Loaded, src: &str) -> Result<FileParse, String> {
    let mut parser = Parser::new();
    if lang.wasm {
        parser
            .set_wasm_store(languages::wasm_store()?)
            .map_err(|e| e.to_string())?;
    }
    parser
        .set_language(&lang.language)
        .map_err(|e| e.to_string())?;
    let tree = parser
        .parse(src, None)
        .ok_or("tree-sitter returned no tree")?;
    let root = tree.root_node();
    let bytes = src.as_bytes();

    let mut hits = Vec::new();
    if let Some(tags) = &lang.tags {
        collect(tags, root, bytes, true, &mut hits);
    }
    match &lang.ours {
        Some(ours) => collect(ours, root, bytes, false, &mut hits),
        None => fallback(root, lang.tags.is_none(), src, &mut hits),
    }

    // Literals from an inline grammar, such as Markdown's links.
    let mut inline_literals: Vec<(String, Span)> = Vec::new();
    if let Some(inline) = &lang.inline {
        let mut ranges: Vec<Range> = Vec::new();
        let mut stack = vec![root];
        while let Some(n) = stack.pop() {
            if n.kind() == inline.over {
                ranges.push(n.range());
                continue;
            }
            let mut c = n.walk();
            stack.extend(n.named_children(&mut c));
        }
        ranges.sort_by_key(|r| r.start_byte);
        if !ranges.is_empty() {
            let mut p = Parser::new();
            p.set_language(&inline.language)
                .map_err(|e| e.to_string())?;
            p.set_included_ranges(&ranges).map_err(|e| e.to_string())?;
            if let Some(t) = p.parse(src, None) {
                let mut inline_hits = Vec::new();
                collect(&inline.query, t.root_node(), bytes, false, &mut inline_hits);
                for h in inline_hits.iter().filter(|h| h.what == "literal") {
                    inline_literals.push((clean(text(h.node, src)), span_of(h.node)));
                }
            }
        }
    }

    // Definitions, each node once. A node two patterns capture keeps the more specific role.
    let mut found: Vec<(Node, String, String)> = Vec::new();
    let mut seen: HashMap<usize, usize> = HashMap::new();
    for h in hits.iter().filter(|h| h.what.starts_with("definition.")) {
        let role = h.what["definition.".len()..].to_string();
        let Some(name) = h
            .name
            .map(|n| clean(text(n, src)))
            .filter(|n| !n.is_empty())
        else {
            continue;
        };
        match seen.get(&h.node.id()) {
            Some(&i) => {
                if found[i].1 == "function" && role == "method" {
                    found[i].1 = role;
                }
            }
            None => {
                seen.insert(h.node.id(), found.len());
                found.push((h.node, role, name));
            }
        }
    }
    found.sort_by_key(|(n, _, _)| (n.start_byte(), std::cmp::Reverse(n.end_byte())));

    // Parameters a grammar doesn't keep in a `parameters` field.
    let mut param_lists: Vec<Node> = Vec::new();
    let mut single_params: Vec<Node> = Vec::new();
    for h in &hits {
        match h.what.as_str() {
            "params" => param_lists.push(h.node),
            "param" => single_params.push(h.node),
            _ => {}
        }
    }
    let functions: Vec<Option<Node>> = found.iter().map(|(n, _, _)| function_node(*n)).collect();
    let params_of = |i: usize| -> Option<u32> {
        let def = found[i].0;
        if let Some(list) = functions[i].and_then(|f| f.child_by_field_name("parameters")) {
            let mut c = list.walk();
            return Some(
                list.named_children(&mut c)
                    .filter(|n| !is_comment(*n))
                    .count() as u32,
            );
        }
        let inner = |n: &Node| {
            contains(def, *n)
                && !found
                    .iter()
                    .any(|(o, _, _)| o.id() != def.id() && contains(def, *o) && contains(*o, *n))
        };
        if let Some(list) = param_lists.iter().find(|n| inner(n)) {
            let mut c = list.walk();
            return Some(
                list.named_children(&mut c)
                    .filter(|n| !is_comment(*n))
                    .count() as u32,
            );
        }
        let singles = single_params.iter().filter(|n| inner(n)).count() as u32;
        if singles > 0 || CALLABLES.contains(&found[i].1.as_str()) {
            return Some(singles);
        }
        None
    };
    let params: Vec<Option<u32>> = (0..found.len()).map(params_of).collect();

    // Parents, and locals dropped: a definition inside a function is kept
    // only when it runs or holds definitions itself.
    let mut parent: Vec<Option<usize>> = vec![None; found.len()];
    let mut stack: Vec<usize> = Vec::new();
    for i in 0..found.len() {
        while let Some(&top) = stack.last() {
            if contains(found[top].0, found[i].0) {
                break;
            }
            stack.pop();
        }
        parent[i] = stack.last().copied();
        stack.push(i);
    }
    let keep: Vec<bool> = (0..found.len())
        .map(|i| {
            let local = parent[i].is_some_and(|p| params[p].is_some());
            !local || params[i].is_some() || CONTAINERS.contains(&found[i].1.as_str())
        })
        .collect();
    let mut index_of: Vec<Option<usize>> = vec![None; found.len()];
    let mut order: Vec<usize> = Vec::new();
    for i in 0..found.len() {
        if keep[i] {
            index_of[i] = Some(order.len());
            order.push(i);
        }
    }
    // A dropped definition's children belong to its nearest kept ancestor.
    let kept_parent = |mut i: usize| -> Option<usize> {
        while let Some(p) = parent[i] {
            if let Some(k) = index_of[p] {
                return Some(k);
            }
            i = p;
        }
        None
    };

    // Owners from `@owner`/`@scope`, such as a Go receiver or a Rust impl.
    let scopes: Vec<(Node, String)> = hits
        .iter()
        .filter(|h| h.what == "scope")
        .filter_map(|h| h.owner.map(|o| (h.node, clean_owner(text(o, src)))))
        .collect();

    // Decisions and nesting, for the measures.
    let mut d = Decisions::default();
    for h in &hits {
        let id = h.node.id();
        match h.what.as_str() {
            "block.branch" => {
                d.branch.insert(id);
            }
            "block.loop" => {
                d.loops.insert(id);
            }
            "block.match" => {
                d.matches.insert(id);
            }
            "block.closure" => {
                d.nests.insert(id);
            }
            "decide.else" => {
                d.elses.insert(id);
            }
            "decide.elseif" => {
                d.elseifs.insert(id);
            }
            "decide.case" => {
                d.cases.insert(id);
            }
            "decide.catch" => {
                d.catches.insert(id);
            }
            "decide.logic" => {
                d.logic.insert(id);
            }
            _ => {}
        }
    }
    for (i, (n, _, _)) in found.iter().enumerate() {
        if params[i].is_some() {
            d.nests.insert(n.id());
            if let Some(f) = functions[i] {
                d.nests.insert(f.id());
            }
        }
    }

    // Blocks: each node once; a closure that is a definition's own body is
    // not a block; a one-line literal is a value, not a table; and data or
    // markup inside more of the same shape belongs to the outer one.
    let def_nodes: HashSet<usize> = order.iter().map(|&i| found[i].0.id()).collect();
    let mut block_hits: Vec<(Node, String)> = Vec::new();
    let mut block_seen: HashSet<usize> = HashSet::new();
    for h in hits.iter().filter(|h| h.what.starts_with("block.")) {
        if !block_seen.insert(h.node.id()) {
            continue;
        }
        let shape = h.what["block.".len()..].to_string();
        if shape == "closure" {
            let up = h.node.parent();
            let up2 = up.and_then(|p| p.parent());
            if up.is_some_and(|p| def_nodes.contains(&p.id()))
                || up2.is_some_and(|p| def_nodes.contains(&p.id()))
            {
                continue;
            }
        }
        if (shape == "data" || shape == "markup")
            && h.node.start_position().row == h.node.end_position().row
        {
            continue;
        }
        block_hits.push((h.node, shape));
    }
    block_hits.sort_by_key(|(n, _)| (n.start_byte(), std::cmp::Reverse(n.end_byte())));
    let mut kept_blocks: Vec<(Node, String)> = Vec::new();
    for (n, shape) in block_hits {
        let nested_same = (shape == "data" || shape == "markup")
            && kept_blocks
                .iter()
                .any(|(o, s)| *s == shape && contains(*o, n));
        if !nested_same {
            kept_blocks.push((n, shape));
        }
    }
    let innermost_def = |n: Node| -> Option<usize> {
        order
            .iter()
            .enumerate()
            .rev()
            .find(|(_, i)| contains(found[**i].0, n))
            .map(|(k, _)| k)
    };
    let mut blocks: Vec<Block> = Vec::new();
    let mut per_def: HashMap<Option<usize>, usize> = HashMap::new();
    let block_defs: Vec<Option<usize>> =
        kept_blocks.iter().map(|(n, _)| innermost_def(*n)).collect();
    for (k, (n, shape)) in kept_blocks.iter().enumerate() {
        let def = block_defs[k];
        let depth = kept_blocks
            .iter()
            .enumerate()
            .filter(|(j, (o, _))| {
                *j != k && block_defs[*j] == def && contains(*o, *n) && o.id() != n.id()
            })
            .count() as u32;
        let index = per_def.entry(def).or_insert(0);
        blocks.push(Block {
            def,
            shape: shape.clone(),
            span: span_of(*n),
            depth,
            index: *index,
        });
        *index += 1;
    }

    // Comments, for docs and debt markers.
    let mut comments: Vec<Node> = Vec::new();
    comments_in(root, &mut comments);
    let markers_in = |n: Node| {
        comments
            .iter()
            .filter(|c| contains(n, **c) && has_marker(text(**c, src)))
            .count() as u32
    };

    // Definitions, measured and named.
    let docstrings: Vec<Node> = hits
        .iter()
        .filter(|h| h.what == "doc" && !h.from_tags)
        .map(|h| h.node)
        .collect();
    let mut defs: Vec<Def> = Vec::new();
    for (k, &i) in order.iter().enumerate() {
        let (node, role, name) = &found[i];
        let parent_k = kept_parent(i);
        let owner = match parent_k {
            Some(p) if CONTAINERS.contains(&defs[p].role.as_str()) => Some(defs[p].name.clone()),
            Some(_) => None,
            None => scopes
                .iter()
                .filter(|(s, _)| contains(*s, *node))
                .map(|(_, o)| o.clone())
                .next_back(),
        };
        let doc = docstrings
            .iter()
            .find(|n| contains(*node, **n) && innermost_def(**n) == Some(k))
            .map(|n| comment_words(text(*n, src)))
            .or_else(|| doc_above(*node, src));
        let mut measures = Measures {
            lines: span_of(*node).end - span_of(*node).start + 1,
            markers: Some(markers_in(*node)),
            ..Default::default()
        };
        if let Some(p) = params[i] {
            let own: Vec<usize> = std::iter::once(node.id())
                .chain(functions[i].map(|f| f.id()))
                .collect();
            measures.params = Some(p);
            measures.cognitive = Some(d.cognitive(*node, 0, true, &own, src));
            measures.cyclomatic = Some(d.cyclomatic(*node));
            measures.nesting = Some(
                blocks
                    .iter()
                    .filter(|b| b.def == Some(k))
                    .map(|b| b.depth + 1)
                    .max()
                    .unwrap_or(0),
            );
        }
        let qualified = match (parent_k, &owner) {
            (Some(p), _) => format!("{}.{}", defs[p].qualified, name),
            (None, Some(o)) => format!("{o}.{name}"),
            (None, None) => name.clone(),
        };
        // The body alone, so a copy under another name, or the same
        // definition renamed, still matches.
        let body = node
            .child_by_field_name("body")
            .or_else(|| functions[i].and_then(|f| f.child_by_field_name("body")))
            .unwrap_or(*node);
        let (fingerprint, shingles) = fingerprint(text(body, src));
        let self_name = hits
            .iter()
            .find(|h| {
                h.what == "self" && contains(*node, h.node) && innermost_def(h.node) == Some(k)
            })
            .map(|h| text(h.node, src).to_string());
        defs.push(Def {
            self_name,
            callable: params[i].is_some(),
            fingerprint,
            shingles,
            name: name.clone(),
            qualified,
            role: role.clone(),
            parent: parent_k,
            owner,
            span: span_of(*node),
            signature: signature(*node, functions[i], src),
            doc,
            measures,
        });
    }
    // A repeat of a qualified name in the same file is told apart by its order.
    let mut counts: HashMap<String, usize> = HashMap::new();
    for def in &mut defs {
        let n = counts.entry(def.qualified.clone()).or_insert(0);
        *n += 1;
        if *n > 1 {
            def.qualified = format!("{}~{}", def.qualified, n);
        }
    }

    let refs = hits
        .iter()
        .filter_map(|h| {
            let kind = match h.what.as_str() {
                "reference.import" => RefKind::Import,
                "reference.call" | "reference.send" => RefKind::Call,
                "reference.class" | "reference.type" | "reference.interface" => RefKind::Reference,
                "reference.implementation" => RefKind::Implements,
                _ => return None,
            };
            let at = h.name.unwrap_or(h.node);
            // The qualifier is the text before the name in the expression that
            // holds both: the match itself, or, when a tags query captures a
            // call by its arguments, the name's own parent (`ctx.lineTo`).
            let qualifier = h
                .name
                .and_then(|n| {
                    let holder = if n.start_byte() > h.node.start_byte() && contains(h.node, n) {
                        Some(h.node)
                    } else {
                        n.parent().filter(|p| p.start_byte() < n.start_byte())
                    };
                    holder.map(|p| (p, n))
                })
                // Only text that ends in a member or path separator qualifies a
                // name: `ctx.` and `Batch::` do, `new ` and `impl ` don't.
                .map(|(p, n)| src[p.start_byte()..n.start_byte()].trim_end())
                .filter(|q| q.ends_with('.') || q.ends_with("::") || q.ends_with("->"))
                .map(|q| {
                    q.trim_end_matches(|c: char| ".:->?!".contains(c))
                        .trim_end()
                })
                .and_then(|q| q.rsplit(['.', ':', '>', ' ', '(', '&', '*']).next())
                .map(str::to_string)
                .filter(|q| !q.is_empty());
            let text = clean(text(at, src));
            (!text.is_empty()).then(|| Ref {
                kind,
                text,
                at: span_of(at),
                from: innermost_def(h.node),
                qualifier,
                macro_call: h.node.kind().contains("macro"),
            })
        })
        .collect();
    let mut literals: Vec<Literal> = hits
        .iter()
        .filter(|h| h.what == "literal")
        .map(|h| Literal {
            text: clean(text(h.node, src)),
            at: span_of(h.node),
            from: innermost_def(h.node),
        })
        .filter(|l| !l.text.is_empty())
        .collect();
    literals.extend(
        inline_literals
            .into_iter()
            .filter(|(t, _)| !t.is_empty())
            .map(|(text, at)| Literal {
                text,
                at,
                from: None,
            }),
    );

    let own_root: Vec<usize> = Vec::new();
    let measures = Measures {
        lines: src.lines().count() as u32,
        cognitive: Some(d.cognitive(root, 0, false, &own_root, src)),
        markers: Some(markers_in(root)),
        ..Default::default()
    };
    Ok(FileParse {
        unparsed: count_unparsed(root),
        measures,
        defs,
        blocks,
        refs,
        literals,
    })
}
