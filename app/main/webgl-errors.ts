// Counts WebGL errors among a page's console messages, which fail `pnpm shots`
// and `pnpm probe`. WebGL draws nothing and throws nothing for a draw call it
// rejects. Chromium only logs a console warning, and stops after 256 errors per
// context.

/** Matches a GL error from the GPU process, a WebGL validation error, or a shader that three.js failed to compile. */
const WEBGL_ERROR = /\bGL_INVALID_[A-Z_]+|\bGL_OUT_OF_MEMORY\b|^WebGL: (INVALID_[A-Z_]+|OUT_OF_MEMORY)|^THREE\.WebGLProgram: Shader Error/;
/** The start of the message Chromium logs when it stops reporting a context's errors. */
const TOO_MANY = "WebGL: too many errors";
/** How many distinct errors a summary quotes. */
const QUOTED = 3;

export interface WebGLErrors {
  /** Counts `message` when it reports a WebGL error. */
  note(message: string): void;
  count(): number;
  /** The error count and the first `QUOTED` distinct errors, for the run's output. */
  summary(): string;
}

export function webglErrors(): WebGLErrors {
  let count = 0;
  let capped = false;
  const quoted: string[] = [];
  return {
    note(message) {
      if (message.startsWith(TOO_MANY)) capped = true;
      if (!WEBGL_ERROR.test(message)) return;
      count++;
      // Chromium prefixes each message with the context's address, such as `[.WebGL-0x…]`, which differs between pages.
      // Removing it lets the same error match across pages.
      const text = (message.replace(/^\[\.WebGL-0x[0-9a-f]+\]\s*/, "").split("\n")[0] ?? "").slice(0, 240);
      if (quoted.length < QUOTED && !quoted.includes(text)) quoted.push(text);
    },
    count: () => count,
    summary: () =>
      count === 0
        ? "WebGL errors: none."
        : `WebGL errors: ${count}${capped ? " or more (Chromium stops reporting them after 256 for a context)" : ""}. First:\n${quoted.map((q) => `  ${q}`).join("\n")}`,
  };
}
