import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { type FarForm, type FarTurn, type InstanceSpot, createFarCards, createSceneLight, crownsOf, farChoice, placesOf } from "@gaia/render";

const TURN: FarTurn = { band: 1.25, leave: 1.15 };
const SWAP = 128;

/** A form with one-texel atlases: enough for its cards to stand and choose, with nothing to bake. */
function formOf(radius: number): FarForm {
  const layers = [0, 1, 2, 3].map(() => new THREE.DataTexture(new Uint8Array(4), 1, 1));
  return {
    bounds: { center: new THREE.Vector3(0, radius, 0), radius, height: radius * 2 },
    bytes: 16,
    ms: 0,
    atlas: { layers, frame: 1, sway: 0, frequency: 1 },
    dispose: () => undefined,
  };
}

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
});

describe("a plant's far cards", () => {
  const spots: InstanceSpot[] = [
    { x: 10, y: 1, z: -40, yaw: 0.3, scale: 1.2, vitality: 0.7 },
    { x: -30, y: 2, z: 80, yaw: 2, scale: 0.8 },
  ];
  const crown = new THREE.Sphere(new THREE.Vector3(0.2, 3, -0.1), 4);

  it("stand in buffers written when the copies are placed, which no pass writes again", () => {
    const cards = createFarCards([formOf(4)], createSceneLight(), [SWAP], TURN);
    const copies = cards.copies(0);
    copies.place(placesOf(spots), crownsOf(spots, crown));
    const mesh = copies.object.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>;
    const geometry = mesh.geometry;
    expect(geometry.instanceCount).toBe(2);
    // Each copy's place, and its crown measured as the woods measure it.
    expect(Array.from(geometry.getAttribute("aSpot").array.slice(0, 4))).toEqual(Array.from(new Float32Array([10, 1, -40, 0.3])));
    expect(Array.from(geometry.getAttribute("aMore").array.slice(0, 2))).toEqual(Array.from(new Float32Array([1.2, 0.7])));
    expect(Array.from(geometry.getAttribute("aCrown").array.slice(4, 8))).toEqual(Array.from(new Float32Array([-30 + 0.2 * 0.8, 2 + 3 * 0.8, 80 - 0.1 * 0.8, 4 * 0.8])));
    const versions = (): number[] => ["aSpot", "aMore", "aCrown"].map((name) => (geometry.getAttribute(name) as THREE.InstancedBufferAttribute).version);
    const placed = versions();
    // Passes only set the pass's size; the copies' buffers stay as they were.
    for (const [focal, ortho] of [[900, false], [450, false], [40, true]] as const) cards.pass(focal, ortho);
    expect(versions()).toEqual(placed);
    // A vitality change rewrites the copy's vitality alone; standing the copies elsewhere rewrites them all.
    copies.setVitalityAt(1, 0.25);
    expect(geometry.getAttribute("aMore").array[5]).toBe(0.25);
    copies.place(placesOf(spots.slice(0, 1)), crownsOf(spots.slice(0, 1), crown));
    expect(geometry.instanceCount).toBe(1);
    expect(versions().every((v, i) => v > (placed[i] as number))).toBe(true);
  });

  it("grow their buffers when more copies stand than they hold, every copy kept", () => {
    const cards = createFarCards([formOf(4)], createSceneLight(), [SWAP], TURN);
    const copies = cards.copies(0);
    copies.place(placesOf(spots.slice(0, 1)), crownsOf(spots.slice(0, 1), crown));
    const many = Array.from({ length: 40 }, (_, k): InstanceSpot => ({ x: k, y: 0, z: -k, yaw: 0, scale: 1 }));
    copies.place(placesOf(many), crownsOf(many, crown));
    const geometry = (copies.object.children[0] as THREE.Mesh<THREE.InstancedBufferGeometry>).geometry;
    expect(geometry.instanceCount).toBe(40);
    expect(geometry.getAttribute("aSpot").array[39 * 4]).toBe(39);
    // The solid and the fading set read the same copies.
    expect((copies.object.children[1] as THREE.Mesh).geometry).toBe(geometry);
  });

  it("cast into the sun's shadow only where a card stands alone", () => {
    const cards = createFarCards([formOf(4)], createSceneLight(), [SWAP], TURN);
    const copies = cards.copies(0);
    const [solid, fading] = copies.object.children as [THREE.Mesh, THREE.Mesh];
    const color = solid.material;
    copies.useDepth(true);
    expect(solid.material).not.toBe(color);
    expect(fading.visible).toBe(false);
    copies.useDepth(false);
    expect(solid.material).toBe(color);
    expect(fading.visible).toBe(true);
  });

  it("refuse a size for each form other than one apiece", () => {
    expect(() => createFarCards([formOf(4)], createSceneLight(), [], TURN)).toThrow();
  });
});
