// Syntax highlighting for the journal's code: splits each line into keywords,
// strings, numbers, called names, types, properties and comments. It scans a
// definition's lines as one text, so a multi-line comment or string is one
// piece, and it tells languages apart only by their comment syntax.

export type Ink = "kw" | "str" | "num" | "fn" | "type" | "prop" | "com";

export interface Piece {
  readonly text: string;
  readonly ink?: Ink;
}

const KEYWORDS = new Set(
  (
    "const let var if else for while do return await async function new of in typeof instanceof export import from default type interface " +
    "class extends implements throw try catch finally break continue switch case as this super null undefined true false void yield static " +
    "readonly private protected public enum declare namespace keyof satisfies fn mut pub impl struct trait match use mod self Self crate " +
    "where loop move ref dyn unsafe def elif lambda pass raise with None True False and or not is"
  ).split(" "),
);

/** A file's comment syntax by extension: the line comment marker, and whether it has block comments. */
function commentsOf(path: string): { readonly line: string; readonly block: boolean } {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["py", "toml", "sh", "yml", "yaml", "rb"].includes(ext)) return { line: "#", block: false };
  if (["css"].includes(ext)) return { line: "", block: true };
  return { line: "//", block: true };
}

/** Splits `lines` of the file at `path` into highlighted pieces, one array per line. */
export function highlight(lines: readonly string[], path: string): Piece[][] {
  const comments = commentsOf(path);
  const text = lines.join("\n");
  const pieces: Piece[] = [];
  const push = (t: string, ink?: Ink): void => {
    if (t === "") return;
    const last = pieces[pieces.length - 1];
    // Merges adjacent plain text into one piece.
    if (ink === undefined && last !== undefined && last.ink === undefined) pieces[pieces.length - 1] = { text: last.text + t };
    else pieces.push(ink === undefined ? { text: t } : { text: t, ink });
  };
  // Sticky regexes match at the current position, so a long definition is scanned in one pass.
  const at = (re: RegExp, k: number): string | null => {
    re.lastIndex = k;
    return re.exec(text)?.[0] ?? null;
  };
  const NUMBER = /\d[\d_]*(?:\.\d+)?/y;
  const WORD = /[A-Za-z_$][\w$]*/y;
  const CALLED = /\s*(?:\(|<[^>\n]*>\(|!\()/y;
  /** The last non-space character before `k`. */
  const before = (k: number): string => {
    let b = k - 1;
    while (b >= 0 && /\s/.test(text[b] as string)) b--;
    return text[b] ?? "";
  };
  let i = 0;
  while (i < text.length) {
    if (comments.line !== "" && text.startsWith(comments.line, i)) {
      const end = text.indexOf("\n", i);
      const t = text.slice(i, end < 0 ? text.length : end);
      push(t, "com");
      i += t.length;
      continue;
    }
    if (comments.block && text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const t = text.slice(i, end < 0 ? text.length : end + 2);
      push(t, "com");
      i += t.length;
      continue;
    }
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && (c === "`" || text[j] !== "\n")) j += text[j] === "\\" ? 2 : 1;
      const t = text.slice(i, Math.min(text.length, j + 1));
      push(t, "str");
      i += t.length;
      continue;
    }
    const number = /[\w$]/.test(text[i - 1] ?? "") ? null : at(NUMBER, i);
    if (number !== null) {
      push(number, "num");
      i += number.length;
      continue;
    }
    const w = at(WORD, i);
    if (w !== null) {
      const ink: Ink | undefined = KEYWORDS.has(w) ? "kw" : at(CALLED, i + w.length) !== null ? "fn" : /^[A-Z]/.test(w) ? "type" : before(i) === "." ? "prop" : undefined;
      push(w, ink);
      i += w.length;
      continue;
    }
    push(c);
    i += 1;
  }
  // Splits the pieces back into lines. A piece that spans a line break is split there, and each part keeps its ink.
  const out: Piece[][] = [[]];
  for (const p of pieces) {
    p.text.split("\n").forEach((part, k) => {
      if (k > 0) out.push([]);
      if (part !== "") (out[out.length - 1] as Piece[]).push(p.ink === undefined ? { text: part } : { text: part, ink: p.ink });
    });
  }
  while (out.length < lines.length) out.push([]);
  return out;
}
