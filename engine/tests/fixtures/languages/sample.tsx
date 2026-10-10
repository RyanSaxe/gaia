import { Walker } from "./sample";

/** Shows a walk. */
export function Listing({ root, depth }: { root: string; depth: number }) {
  let names: string[] = [];
  try {
    names = new Walker(root).walk();
  } catch (error) {
    names = [];
  }
  for (const name of names) {
    if (name === "" && depth > 0) {
      continue;
    } else if (name.length > 5) {
      names.push(name.slice(0, 5));
    } else {
      break;
    }
  }
  const style = {
    margin: 0,
    padding: 0,
  };
  switch (depth) {
    case 0:
      return <p>{"public/empty.svg"}</p>;
    default:
      return (
        <ul style={style}>
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      );
  }
}
