import { describe, expect, it } from "vitest";
import { type Board, letter } from "./lettering.ts";

// A serif's letters are about half as wide as they are tall; capitals and wide letters more.
const measure = (text: string, size: number): number => [...text].reduce((w, c) => w + (/[A-Z@mw]/.test(c) ? 0.72 : 0.5), 0) * size;
const SIGNBOARD: Board = { width: 456, height: 150, size: 92, least: 52, twoLines: true, widen: 1.45 };
const STONE: Board = { width: 442, height: 140, size: 74, least: 40, twoLines: false, widen: 1 };

const NAMES = ["main", "world-service", "@gaia/primitives", "electron.vite.config.ts", "createPlantInstances", "rpc_answers_each_line_and_exits_when_stdin_closes", "Supercalifragilisticexpialidocious"];

describe("lettering on a board", () => {
  it("never cuts a name off: every line fits the board as it stands, and every letter is there", () => {
    for (const board of [SIGNBOARD, STONE]) {
      for (const name of NAMES) {
        const l = letter(name, board, measure);
        for (const line of l.lines) expect(measure(line, l.size)).toBeLessThanOrEqual(board.width * l.widen + 1e-6);
        expect(l.lines.join("").replace(/\s/g, "")).toBe(name.replace(/\s/g, ""));
        expect(l.widen).toBeGreaterThanOrEqual(1);
        expect(l.widen).toBeLessThanOrEqual(board.widen);
      }
    }
  });

  it("keeps a short name on one line at full size, and breaks a long one where a person would", () => {
    expect(letter("main", SIGNBOARD, measure)).toEqual({ lines: ["main"], size: 92, widen: 1 });
    const config = letter("electron.vite.config.ts", SIGNBOARD, measure);
    expect(config.lines).toHaveLength(2);
    expect(config.lines[0]).toMatch(/[./-]$/);
    expect(config.size).toBeGreaterThanOrEqual(SIGNBOARD.least);
    expect(letter("createPlantInstances", SIGNBOARD, measure).lines).toEqual(["createPlant", "Instances"]);
  });
});
