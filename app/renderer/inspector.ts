// The inspector is generated from the declarations: slots from the kind,
// primitives from the library, controls from each field's type. Nothing
// here knows about trees.

import type { AnyKind, Blueprint, Field, FilledSlot, Library, PrimitiveId } from "@gaia/schema";
import { slotOrder } from "@gaia/schema";
import { defaultParams } from "@gaia/world";

type StoredValue = string | boolean | readonly string[];

export interface InspectorProps {
  readonly kind: AnyKind;
  readonly lib: Library;
  readonly blueprint: Blueprint;
  readonly onChange: (slots: Record<string, FilledSlot>) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls !== undefined) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function renderInspector(root: HTMLElement, props: InspectorProps): void {
  const { kind, lib, blueprint } = props;
  const scroll = root.scrollTop;
  root.replaceChildren();
  const slots: Record<string, FilledSlot> = { ...blueprint.slots };
  const commit = (): void => props.onChange(slots);

  for (const name of slotOrder(kind)) {
    const slot = kind.slots[name];
    if (slot === undefined) continue;
    const filled = slots[name];
    const section = el("section", "slot");
    const head = el("div", "slot-head");
    const title = el("div", "slot-title");
    title.append(el("span", "slot-name", name), el("span", "slot-role", slot.role));
    head.append(title);
    const sourceMissing = slot.on !== undefined && slots[slot.on] === undefined;

    if (slot.optional) {
      const toggle = el("label", "switch");
      const box = el("input");
      box.type = "checkbox";
      box.checked = filled !== undefined;
      box.disabled = sourceMissing;
      box.addEventListener("change", () => {
        if (box.checked) {
          const p = lib.forRole(slot.role)[0];
          if (p !== undefined) slots[name] = { use: p.id, params: defaultParams(p) };
        } else {
          delete slots[name];
        }
        commit();
      });
      toggle.append(box, el("span", "switch-track"));
      toggle.title = `Should it have a ${name}?`;
      head.append(toggle);
    }
    section.append(head);

    if (sourceMissing) {
      section.append(el("p", "slot-note", `Grows on ${slot.on}, which is absent.`));
      root.append(section);
      continue;
    }
    if (filled === undefined) {
      section.classList.add("absent");
      root.append(section);
      continue;
    }

    const candidates = lib.forRole(slot.role);
    const current = lib.get(filled.use);
    if (candidates.length > 1) {
      const select = el("select", "primitive");
      for (const p of candidates) {
        const option = el("option", undefined, p.id);
        option.value = p.id;
        option.title = p.doc;
        option.selected = p.id === current.id;
        select.append(option);
      }
      select.addEventListener("change", () => {
        const p = lib.get(select.value);
        slots[name] = { use: p.id as PrimitiveId, params: defaultParams(p) };
        commit();
      });
      section.append(select);
    } else {
      section.append(el("div", "primitive fixed", current.id));
    }
    section.append(el("p", "doc", current.doc));

    for (const [param, field] of Object.entries(current.params)) {
      section.append(
        control(param, field, filled.params[param], (value) => {
          slots[name] = { ...filled, params: { ...filled.params, [param]: value } };
          commit();
        }),
      );
    }
    root.append(section);
  }
  root.scrollTop = scroll;
}

function control(name: string, field: Field, value: StoredValue | undefined, set: (v: StoredValue) => void): HTMLElement {
  const row = el("div", "param");
  const label = el("div", "param-label", name);
  label.title = field.ask;
  row.append(label);
  row.append(el("div", "param-ask", field.ask));
  switch (field.type) {
    case "scale": {
      const group = el("div", "segmented");
      group.setAttribute("role", "radiogroup");
      for (const level of field.levels) {
        const b = el("button", level.words === value ? "seg on" : "seg", level.words);
        b.type = "button";
        b.setAttribute("aria-pressed", String(level.words === value));
        b.addEventListener("click", () => set(level.words));
        group.append(b);
      }
      row.append(group);
      break;
    }
    case "choice": {
      const select = el("select");
      for (const [key, desc] of Object.entries(field.options as Record<string, string>)) {
        const option = el("option", undefined, key);
        option.value = key;
        option.title = desc;
        option.selected = key === value;
        select.append(option);
      }
      select.addEventListener("change", () => set(select.value));
      row.append(select);
      const desc = (field.options as Record<string, string>)[String(value)];
      if (desc !== undefined) row.append(el("div", "param-desc", desc));
      break;
    }
    case "flag": {
      const box = el("input");
      box.type = "checkbox";
      box.checked = value === true;
      box.addEventListener("change", () => set(box.checked));
      const l = el("label", "check");
      l.append(box, document.createTextNode(value === true ? field.yes : field.no));
      row.append(l);
      break;
    }
    case "set": {
      const chosen = new Set(Array.isArray(value) ? value : []);
      const list = el("div", "checks");
      for (const [member, desc] of Object.entries(field.members as Record<string, string>)) {
        const box = el("input");
        box.type = "checkbox";
        box.checked = chosen.has(member);
        box.addEventListener("change", () => {
          if (box.checked) chosen.add(member);
          else chosen.delete(member);
          set([...chosen]);
        });
        const l = el("label", "check");
        l.title = desc;
        l.append(box, document.createTextNode(member));
        list.append(l);
      }
      row.append(list);
      break;
    }
  }
  return row;
}

