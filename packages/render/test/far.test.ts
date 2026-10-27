import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { shownVitality } from "@gaia/realize";
import { type FarCards, type FarTurn, type InstanceSpot, createFarCards, createSceneLight, crownsOf, farChoice, goneness, placesOf, settleVitality } from "@gaia/render";

const TURN: FarTurn = { band: 1.25, leave: 1.15, gone: { start: 8, end: 4 } };
const SWAP = 128;

describe("a copy's form by its crown's size on a pass's screen", () => {
  it("draws its full form alone above the band, its card coming in across it, and its card alone once the full form has dissolved", () => {
    expect(farChoice(SWAP * TURN.band * 1.01, SWAP, TURN, false)).toEqual({ full: true, card: 0 });
    const band = farChoice(SWAP * 1.12, SWAP, TURN, false);
    expect(band.full).toBe(true);
    expect(band.card).toBeGreaterThan(0);
    expect(band.card).toBeLessThan(1);
    // Past the band's end the full form still dissolves under a card drawn whole to the eye.
    const leaving = farChoice(SWAP * 0.93, SWAP, TURN, false);
    expect(leaving.full).toBe(true);
    expect(leaving.card).toBeGreaterThan(0.99);
    expect(leaving.card).toBeLessThan(1);
    expect(farChoice((SWAP / TURN.leave) * 0.95, SWAP, TURN, false)).toEqual({ full: false, card: 1 });
  });

  it("in a flat pass (the sun's shadow), keeps the full form only to the band's end", () => {
    expect(farChoice(SWAP * 0.93, SWAP, TURN, true)).toEqual({ full: false, card: 1 });
    expect(farChoice(SWAP * 1.12, SWAP, TURN, true).full).toBe(true);
  });

  it("dissolves a crown too small to see across its band, whatever its form, and draws nothing once it is gone", () => {
    expect(goneness(TURN.gone.start + 1, TURN.gone)).toBe(0);
    expect(goneness((TURN.gone.start + TURN.gone.end) / 2, TURN.gone)).toBeCloseTo(0.5, 6);
    expect(goneness(TURN.gone.end, TURN.gone)).toBe(1);
    // A crown dissolving draws as it otherwise would; gone, it draws in no form.
    expect(farChoice(6, SWAP, TURN, false)).toEqual({ full: false, card: 1 });
    expect(farChoice(6, 1000, TURN, false).full).toBe(false);
    expect(farChoice(TURN.gone.end, SWAP, TURN, false)).toEqual({ full: false, card: 0 });
    // A form that never turns far keeps its full form until it is gone.
    expect(farChoice(TURN.gone.end + 0.1, 0, TURN, false).full).toBe(true);
  });
});

describe("a set's far cards", () => {
  const spots: InstanceSpot[] = [
    { x: 10, y: 1, z: -40, yaw: 0.3, scale: 1.2, vitality: 0.7 },
    { x: -30, y: 2, z: 80, yaw: 2, scale: 0.8 },
  ];
  const crown = new THREE.Sphere(new THREE.Vector3(0.2, 3, -0.1), 4);
  const meshesOf = (cards: FarCards): [THREE.Mesh<THREE.InstancedBufferGeometry>, THREE.Mesh<THREE.InstancedBufferGeometry>] => cards.object.children as [THREE.Mesh<THREE.InstancedBufferGeometry>, THREE.Mesh<THREE.InstancedBufferGeometry>];

  it("stand each plant's copies in buffers written when they are placed, which no pass writes again", () => {
    const cards = createFarCards(createSceneLight(), TURN, 2);
    const copies = cards.copies(new THREE.Group());
    copies.place(placesOf(spots), crownsOf(spots, crown));
    const geometry = meshesOf(cards)[0].geometry;
    expect(geometry.instanceCount).toBeGreaterThanOrEqual(2);
    // Each copy's place, and its crown measured as the woods measure it.
    expect(Array.from(geometry.getAttribute("aSpot").array.slice(0, 4))).toEqual(Array.from(new Float32Array([10, 1, -40, 0.3])));
    expect(Array.from(geometry.getAttribute("aMore").array.slice(0, 2))).toEqual(Array.from(new Float32Array([1.2, shownVitality(0.7)])));
    expect(Array.from(geometry.getAttribute("aCrown").array.slice(4, 8))).toEqual(Array.from(new Float32Array([-30 + 0.2 * 0.8, 2 + 3 * 0.8, 80 - 0.1 * 0.8, 4 * 0.8])));
    const versions = (): number[] => ["aSpot", "aMore", "aCrown"].map((name) => (geometry.getAttribute(name) as THREE.InstancedBufferAttribute).version);
    const placed = versions();
    // Passes only set the pass's size; the copies' buffers stay as they were.
    for (const [focal, ortho] of [[900, false], [450, false], [40, true]] as const) cards.pass(focal, ortho);
    expect(versions()).toEqual(placed);
    // A vitality change eases in as the near form's does, rewriting how the copy's vitality shows and nothing else,
    // and comes to rest exactly; standing the copies elsewhere rewrites them all.
    copies.setVitalityAt(1, 0.25);
    settleVitality();
    expect(geometry.getAttribute("aMore").array[5]).toBeCloseTo(shownVitality(0.25), 6);
    copies.place(placesOf(spots.slice(0, 1)), crownsOf(spots.slice(0, 1), crown));
    expect(versions().every((v, i) => v > (placed[i] as number))).toBe(true);
  });

  it("draw every plant's copies in one batch, two draws whatever forms they show, every copy kept as they grow", () => {
    const cards = createFarCards(createSceneLight(), TURN, 2);
    const one = cards.copies(new THREE.Group());
    const other = cards.copies(new THREE.Group());
    one.place(placesOf(spots.slice(0, 1)), crownsOf(spots.slice(0, 1), crown));
    other.place(placesOf(spots), crownsOf(spots, crown));
    const many = Array.from({ length: 40 }, (_, k): InstanceSpot => ({ x: k, y: 0, z: -k, yaw: 0, scale: 1 }));
    one.place(placesOf(many), crownsOf(many, crown));
    expect(cards.object.children).toHaveLength(2);
    const [solid, fading] = meshesOf(cards);
    // The solid and the fading set read the same copies.
    expect(fading.geometry).toBe(solid.geometry);
    const spot = solid.geometry.getAttribute("aSpot").array;
    const more = solid.geometry.getAttribute("aMore").array;
    // Each plant's copies stand in a stretch of their own, marked with whose they are; spare room is nobody's.
    const xs = (member: number): number[] => Array.from({ length: solid.geometry.instanceCount }, (_, i) => i).filter((i) => more[i * 4 + 3] === member).map((i) => spot[i * 4] as number);
    const members = [...new Set(Array.from({ length: solid.geometry.instanceCount }, (_, i) => more[i * 4 + 3] as number))].filter((m) => m > 0);
    expect(members).toHaveLength(2);
    expect(members.map((m) => xs(m).length).sort((a, b) => a - b)).toEqual([2, 40]);
    expect(members.map(xs).find((x) => x.length === 40)).toEqual(many.map((s) => s.x));
  });

  it("draw only while some plant whose form holds a slot shows, and cast into the sun's shadow only where a card stands alone", () => {
    const cards = createFarCards(createSceneLight(), TURN, 2);
    const anchor = new THREE.Group();
    const copies = cards.copies(anchor);
    copies.place(placesOf(spots), crownsOf(spots, crown));
    const [solid, fading] = meshesOf(cards);
    cards.pass(900, false);
    expect(solid.visible).toBe(false);
    copies.slot = 1;
    cards.pass(900, false);
    expect(solid.visible && fading.visible).toBe(true);
    // Hiding the plant hides its cards.
    anchor.visible = false;
    cards.pass(900, false);
    expect(solid.visible).toBe(false);
    anchor.visible = true;
    const color = solid.material;
    copies.useDepth(true);
    cards.pass(40, true);
    expect(solid.material).not.toBe(color);
    expect(fading.visible).toBe(false);
    copies.useDepth(false);
    cards.pass(900, false);
    expect(solid.material).toBe(color);
    expect(fading.visible).toBe(true);
  });

  it("hold at least one form", () => {
    expect(() => createFarCards(createSceneLight(), TURN, 0)).toThrow();
  });
});
