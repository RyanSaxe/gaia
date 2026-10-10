const path = require("./paths");
import { readAll } from "./sample";

/** Counts entries. */
export function count(root, depth) {
  let n = 0;
  while (n < depth) {
    n += 1;
  }
  if (root === "" || depth < 0) {
    return 0;
  } else if (depth > 9) {
    n = 9;
  } else {
    n += 1;
  }
  const limits = [
    1,
    2,
  ];
  try {
    n += readAll(path.join(root, "src/main.js"), depth).filter((name) => name !== "").length;
  } catch (error) {
    n = limits[0];
  }
  switch (n) {
    case 0:
      return <span>{n}</span>;
    default:
      return (
        <div>
          <b>{n}</b>
        </div>
      );
  }
}
