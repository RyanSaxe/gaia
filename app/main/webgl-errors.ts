// The WebGL errors among a page's console messages, which `pnpm shots` and
// `pnpm probe` fail on. A draw WebGL rejects draws nothing and throws nothing:
// Chromium only reports it on the page's console, as a warning, and stops
// after 256 for a context. The far bake drew blank behind such an error for
// three rounds before anyone saw it.

/** A GL error, from the GPU process or WebGL's own checks, or a shader three could not build. */
const WEBGL_ERROR = /\bGL_INVALID_[A-Z_]+|\bGL_OUT_OF_MEMORY\b|^WebGL: (INVALID_[A-Z_]+|OUT_OF_MEMORY)|^THREE\.WebGLProgram: Shader Error/;
/** Chromium's last line for a context whose errors it stops reporting. */
const TOO_MANY = "WebGL: too many errors";
/** How many distinct errors a summary quotes. */
const QUOTED = 3;

export interface WebGLErrors {
  /** Counts `message` when it reports a WebGL error. */
  note(message: string): void;
  count(): number;
  /** A line for the run's output: how many errors there were, and the first few that differ. */
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
      // Chromium names the context by its address ("[.WebGL-0x…]"), which differs from page to page.
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
