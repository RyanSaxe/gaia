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
function commentsOf(path: string): {
  readonly line: string;
  readonly block: boolean;
} {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["py", "toml", "sh", "yml", "yaml", "rb"].includes(ext)) {
    return { line: "#", block: false };
  }
  if (["css"].includes(ext)) return { line: "", block: true };
  return { line: "//", block: true };
}

// Sticky regexes match at the current position, so a long definition is scanned in one pass.
const NUMBER = /\d[\d_]*(?:\.\d+)?/y;
const WORD = /[A-Za-z_$][\w$]*/y;
const CALLED = /\s*(?:\(|<[^>\n]*>\(|!\()/y;

function matchAt(text: string, re: RegExp, k: number): string | null {
  re.lastIndex = k;
  return re.exec(text)?.[0] ?? null;
}

function charBefore(text: string, k: number): string {
  let b = k - 1;
  while (b >= 0 && /\s/.test(text[b] as string)) b--;
  return text[b] ?? "";
}

function scanComment(
  text: string,
  i: number,
  comments: { readonly line: string; readonly block: boolean },
): string | null {
  if (comments.line !== "" && text.startsWith(comments.line, i)) {
    const end = text.indexOf("\n", i);
    return text.slice(i, end < 0 ? text.length : end);
  }
  if (comments.block && text.startsWith("/*", i)) {
    const end = text.indexOf("*/", i + 2);
    return text.slice(i, end < 0 ? text.length : end + 2);
  }
  return null;
}

function scanString(text: string, start: number, quote: string): string {
  const allowNewline = quote === "`";
  let j = start + 1;
  while (j < text.length) {
    const ch = text[j] as string;
    if (ch === quote || (!allowNewline && ch === "\n")) break;
    j += ch === "\\" ? 2 : 1;
  }
  return text.slice(start, Math.min(text.length, j + 1));
}

function wordInk(text: string, i: number, w: string): Ink | undefined {
  if (KEYWORDS.has(w)) return "kw";
  if (matchAt(text, CALLED, i + w.length) !== null) return "fn";
  if (/^[A-Z]/.test(w)) return "type";
  if (charBefore(text, i) === ".") return "prop";
  return undefined;
}

function scanNext(
  text: string,
  i: number,
  comments: { readonly line: string; readonly block: boolean },
): Piece {
  const comment = scanComment(text, i, comments);
  if (comment !== null) return { text: comment, ink: "com" };
  const c = text[i] as string;
  if (c === '"' || c === "'" || c === "`") {
    return { text: scanString(text, i, c), ink: "str" };
  }
  const number = /[\w$]/.test(text[i - 1] ?? "")
    ? null
    : matchAt(text, NUMBER, i);
  if (number !== null) return { text: number, ink: "num" };
  const w = matchAt(text, WORD, i);
  if (w !== null) {
    const ink = wordInk(text, i, w);
    return ink === undefined ? { text: w } : { text: w, ink };
  }
  return { text: c };
}

function splitIntoLines(
  pieces: readonly Piece[],
  lineCount: number,
): Piece[][] {
  // Splits the pieces back into lines. A piece that spans a line break is split there, and each part keeps its ink.
  const out: Piece[][] = [[]];
  for (const p of pieces) {
    p.text.split("\n").forEach((part, k) => {
      if (k > 0) out.push([]);
      if (part !== "") {
        (out[out.length - 1] as Piece[]).push(
          p.ink === undefined ? { text: part } : { text: part, ink: p.ink },
        );
      }
    });
  }
  while (out.length < lineCount) out.push([]);
  return out;
}

/** Splits `lines` of the file at `path` into highlighted pieces, one array per line. */
export function highlight(lines: readonly string[], path: string): Piece[][] {
  const comments = commentsOf(path);
  const text = lines.join("\n");
  const pieces: Piece[] = [];
  const push = (piece: Piece): void => {
    if (piece.text === "") return;
    const last = pieces[pieces.length - 1];
    // Merges adjacent plain text into one piece.
    if (
      piece.ink === undefined &&
      last !== undefined &&
      last.ink === undefined
    ) {
      pieces[pieces.length - 1] = { text: last.text + piece.text };
    } else pieces.push(piece);
  };
  let i = 0;
  while (i < text.length) {
    const piece = scanNext(text, i, comments);
    push(piece);
    i += piece.text.length;
  }
  return splitIntoLines(pieces, lines.length);
}
