// Prints the Jev request the planner builds for one file, exactly as it would
// go to OpenRouter. Nothing is sent. Usage: pnpm print-request [structure|details]

import { Library } from "@gaia/schema";
import { PRIMITIVES } from "@gaia/primitives";
import { flora } from "@gaia/kinds";
import { planDetails, planStructure } from "@gaia/world";
import { SCANNER } from "@gaia/world/testing";

const lib = new Library(PRIMITIVES);
const target = {
  id: SCANNER.path,
  state: {
    region: { path: "src-tauri/src", biome: "A quiet birch wood of small, careful utilities." },
    file: {
      path: SCANNER.path,
      doc: SCANNER.doc,
      exports: SCANNER.symbols.filter((s) => s.exported).map((s) => (s.doc ? `${s.name}: ${s.doc}` : s.name)),
      size: "medium",
    },
  },
};

const wave =
  process.argv[2] === "details"
    ? planDetails(flora, lib, { form: "branching@1", bark: "bark@1", crown: "leaf-strands@1", motion: "sway@1", palette: "palette@1" }, target)
    : planStructure(flora, lib, target);
console.log(JSON.stringify(wave.request, null, 2));
