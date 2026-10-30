import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyVitality } from "@gaia/realize";
import type { Part } from "@gaia/schema";
import { DROOP_CELLS, type FarCards, type FarTurn, type InstanceSpot, createFarCards, createSceneLight, crownsOf, droopField, farChoice, farLevels, farSlotBytes, goneness, placesOf } from "@gaia/render";

const TURN: FarTurn = { band: 1.25, leave: 1.15, gone: { start: 8, end: 4 } };
const SWAP = 128;

describe("a copy's form by its crown's size on a pass's screen", () => {
  it("draws its full form alone above the band, its card coming in across it, and its card alone once the full form has dissolved", () => {
    expect(farChoice(SWAP * TURN.band * 1.01, SWAP, TURN, false)).toEqual({ full: true, card: 0 });
    const band = farChoice(SWAP * 1.12, SWAP, TURN, false);
    expect(band.full).toBe(true);
    expect(band.card).toBeGreaterThan(0);
    expect(band.card).toBeLessThan(1);
    // Past the band's end the full form still dissolves under a card that looks opaque.
    const leaving = farChoice(SWAP * 0.93, SWAP, TURN, false);
    expect(leaving.full).toBe(true);
    expect(leaving.card).toBeGreaterThan(0.99);
    expect(leaving.card).toBeLessThan(1);
    expect(farChoice((SWAP / TURN.leave) * 0.95, SWAP, TURN, false)).toEqual({ full: false, card: 1 });
    // A crown too small to see dissolves across its own band, whatever its form, and draws in no form once it is gone.
    expect(goneness(TURN.gone.start + 1, TURN.gone)).toBe(0);
    expect(goneness((TURN.gone.start + TURN.gone.end) / 2, TURN.gone)).toBeCloseTo(0.5, 6);
    expect(goneness(TURN.gone.end, TURN.gone)).toBe(1);
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
    // Each plant's copies occupy a stretch of their own, marked with their member. Spare room belongs to no member.
    const xs = (member: number): number[] => Array.from({ length: solid.geometry.instanceCount }, (_, i) => i).filter((i) => more[i * 4 + 3] === member).map((i) => spot[i * 4] as number);
    const members = [...new Set(Array.from({ length: solid.geometry.instanceCount }, (_, i) => more[i * 4 + 3] as number))].filter((m) => m > 0);
    expect(members).toHaveLength(2);
    expect(members.map((m) => xs(m).length).sort((a, b) => a - b)).toEqual([2, 40]);
    expect(members.map(xs).find((x) => x.length === 40)).toEqual(many.map((s) => s.x));
  });
});

describe("a set's far forms in memory", () => {
  it("hold 24 tree forms in 768 MiB, with every mip level a card reads and each form's droop field", () => {
    const MiB = 2 ** 20;
    expect(farSlotBytes(128, TURN.gone.end, 24)).toBeLessThanOrEqual(768 * MiB);
    // A phone's trees bake at half the size, a quarter of the memory.
    expect(farSlotBytes(64, TURN.gone.end, 24)).toBeLessThanOrEqual(192 * MiB);
    // The coarsest level held draws a view no wider than a crown that is gone, so no card reads past it.
    for (const frame of [32, 64, 128]) expect(frame >> (farLevels(frame, TURN.gone.end) - 1)).toBeLessThanOrEqual(TURN.gone.end);
  });
});

describe("a far form's droop field", () => {
  /** A trunk point that never sags and a bough's tip that sags about its joint on the trunk, as a primitive writes them. */
  const plant = (tipDroop: number): Part => {
    const positions = new Float32Array([0, 2, 0, 3, 4, 0]);
    const zeros = (k: number): Float32Array => new Float32Array(2 * k);
    return {
      swatch: "bark",
      positions,
      normals: new Float32Array([1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array(0),
      shade: zeros(1),
      tint: zeros(1),
      cutout: zeros(3),
      piece: zeros(2),
      collision: "none",
      channels: { loss: zeros(1), droop: new Float32Array([0, tipDroop]), wither: zeros(1), glow: zeros(1), pivot: positions.slice(), bough: new Float32Array([0, 0, 0, 0, 4, 0]), twig: new Float32Array([0, 0, 0, 0, 4, 0]), close: zeros(1) },
    };
  };
  const center = new THREE.Vector3(0, 3, 0);
  const radius = 5;
  /** The movement the field holds in the cell at `cell`. */
  const read = (field: ReturnType<typeof droopField>, [x, y, z]: readonly [number, number, number]): number[] => {
    const at = ((z * DROOP_CELLS + y) * DROOP_CELLS + x) * 4;
    return [0, 1, 2].map((a) => ((field.cells[at + a] as number) / 127.5 - 1) * field.scale);
  };
  const cellOf = (p: readonly number[]): [number, number, number] => [0, 1, 2].map((a) => Math.floor((((p[a] as number) - center.getComponent(a)) / (2 * radius) + 0.5) * DROOP_CELLS)) as [number, number, number];

  it("holds where each point moves as its boughs sag all the way, as the plant's own droop moves it", () => {
    const part = plant(0.2);
    const field = droopField([part], center, radius);
    const sagged = applyVitality(part, 0).positions;
    const moved = [0, 1, 2].map((a) => (sagged[3 + a] as number) - (part.positions[3 + a] as number));
    expect(moved[1]).toBeLessThan(-0.1);
    const tolerance = field.scale / 127;
    read(field, cellOf([3, 4, 0])).forEach((m, a) => expect(Math.abs(m - (moved[a] as number))).toBeLessThanOrEqual(tolerance));
    read(field, cellOf([0, 2, 0])).forEach((m) => expect(Math.abs(m)).toBeLessThanOrEqual(tolerance));
    expect(field.reach).toBeCloseTo(Math.hypot(...moved), 5);
    // A cell holding no vertex takes the movement of the boughs beside it.
    const [x, y, z] = cellOf([3, 4, 0]);
    read(field, [x + 1, y, z]).forEach((m, a) => expect(Math.abs(m - (moved[a] as number))).toBeLessThanOrEqual(tolerance));
    // A plant that never sags moves nothing.
    const still = droopField([plant(0)], center, radius);
    expect(still.scale).toBe(0);
    expect(still.reach).toBe(0);
  });
});
