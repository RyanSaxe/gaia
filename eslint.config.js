// Guardrails that keep the packages honest. Each rule protects a property the
// architecture depends on; the reason sits next to the rule.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

const PURE = ["packages/schema/src/**", "packages/primitives/src/**", "packages/kinds/src/**", "packages/world/src/**", "packages/realize/src/**", "packages/terrain/src/**"];

const restrict = (paths, patterns) => ({ "no-restricted-imports": ["error", { paths, patterns }] });
const gaia = (name, message) => ({ group: [`@gaia/${name}`, `@gaia/${name}/*`], message });
const three = { group: ["three", "three/*"], message: "Only @gaia/render and the app draw. Everything else stays plain data so workers and tests run without a GPU." };
const node = { group: ["node:*", "fs", "path", "os", "child_process"], message: "This code runs in workers and the renderer. Files and processes belong to the Rust engine." };

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/out/**", "engine/target/**", "tools/**/*.html"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Determinism: the same inputs must give the same world on every machine.
  {
    files: PURE,
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use ctx.rand or rand(seed): unseeded randomness reshuffles the world on every run." },
        { object: "Date", property: "now", message: "Time is not an input to the world. Pass it in explicitly if a feature needs it." },
        { object: "performance", property: "now", message: "Time is not an input to the world." },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "fetch"],
    },
  },

  // Package boundaries.
  {
    files: ["packages/schema/src/**"],
    rules: restrict([], [{ group: ["@gaia/*"], message: "schema is the bottom layer and imports no other package." }, three, node]),
  },
  {
    files: ["packages/primitives/src/**"],
    rules: {
      ...restrict([], [
        three,
        node,
        gaia("world", "Primitives build geometry; they never ask Jev or touch the world document."),
        gaia("realize", "The realizer calls primitives, not the other way round."),
        gaia("kinds", "Primitives do not know which kinds use them."),
      ]),
      // Every component shares one material family; primitives write channels, never shaders.
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/gl_FragColor|gl_Position|void main\\s*\\(/]", message: "Primitives never ship GLSL. Pick a swatch and write vitality channels." },
        { selector: "TemplateElement[value.raw=/gl_FragColor|gl_Position|void main\\s*\\(/]", message: "Primitives never ship GLSL. Pick a swatch and write vitality channels." },
      ],
    },
  },
  {
    files: ["packages/kinds/src/**"],
    rules: restrict([], [
      three,
      node,
      gaia("primitives", "Kinds name roles, never primitives, so Jev stays free to choose any primitive that fits a slot."),
      gaia("world", "Kinds are declarations; the world service uses them."),
    ]),
  },
  {
    files: ["packages/world/src/**"],
    rules: restrict([], [three, node, gaia("render", "The world service never draws."), gaia("realize", "The world service sends documents; the renderer realizes them.")]),
  },
  {
    files: ["packages/terrain/src/**"],
    rules: restrict([], [three, node, gaia("world", "Terrain is baked from a document; it never asks Jev."), gaia("render", "Terrain is plain data; the renderer draws it.")]),
  },
  {
    files: ["packages/realize/src/**"],
    rules: restrict([], [three, node, gaia("world", "Realizing is a pure function of a blueprint; it never asks Jev.")]),
  },

  // Tests: few and strong. They check behavior through public entry points,
  // so changing an internal never breaks a test that should not care.
  {
    files: ["packages/*/test/**", "app/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src", "**/src/**"],
              message: "Test through the package's entry point (@gaia/<name>), never its internals.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name=/^(toMatchSnapshot|toMatchInlineSnapshot|toThrowErrorMatchingSnapshot|toThrowErrorMatchingInlineSnapshot)$/]",
          message: "No snapshots: they freeze whatever the code printed. Assert the behavior that matters.",
        },
      ],
    },
  },
);
