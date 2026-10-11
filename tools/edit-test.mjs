// Teste do editor de planta (sem Foundry):  node tools/edit-test.mjs
// Simula edições e confere se salas, portas, paredes e tochas continuam coerentes.
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateDungeon, CELL } from "../scripts/generator.js";
import { createTopology, createGrid } from "../scripts/topology.js";
import { rebuildDungeon, encodeCells, decodeCells } from "../scripts/plan-edit.js";
import { buildWallSegments } from "../scripts/walls.js";
import { placeLights } from "../scripts/lights.js";

Math.SQRT3 = 1.7320508075688772;
Math.SQRT1_3 = 0.5773502691896257;
const foundryCommon = process.env.FOUNDRY_COMMON
  ?? path.join(os.homedir(), "AppData/Local/Programs/Foundry Virtual Tabletop/resources/app/common");
const load = f => import(pathToFileURL(path.join(foundryCommon, "grid", f)).href);
const { default: SquareGrid } = await load("square.mjs");
const { default: HexagonalGrid } = await load("hexagonal.mjs");

let failures = 0;
const fail = (msg, ctx) => { failures++; console.log("FALHA:", msg, ctx); };

for (const gridType of [4, 2, 1]) {
  for (const wallStyle of ["straight", "grid"]) {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const ctx = { gridType, wallStyle, seed };
      const topo = createTopology(createGrid(gridType, 100, { SquareGrid, HexagonalGrid }), 50, 36, wallStyle);
      const base = generateDungeon(topo, { seed, secretRooms: 1, teleportRooms: 1 });

      // 0. Sem mudanças: mesmas salas e mesmas portas; células sobrevivem à codificação
      const same = rebuildDungeon(base, Uint8Array.from(base.cells));
      if (same.rooms.length !== base.rooms.length) fail("salas mudaram sem edição", ctx);
      if (same.doors.length !== base.doors.length) fail("portas mudaram sem edição", ctx);
      if (encodeCells(decodeCells(encodeCells(base.cells))) !== encodeCells(base.cells)) fail("codificação", ctx);

      // 1. Corredor novo entre as duas salas comuns mais distantes → deve ganhar porta(s)
      const linked = base.rooms.filter(r => !r.secret && !r.isolated);
      const [ra, rb] = [linked[0], linked.reduce((best, r) =>
        topo.distance(r.centerCell, linked[0].centerCell) > topo.distance(best.centerCell, linked[0].centerCell) ? r : best)];
      const cells = Uint8Array.from(base.cells);
      const changed = new Set();
      let { i, j } = topo.ij(ra.centerCell);
      const t = topo.ij(rb.centerCell);
      const mark = () => {
        const id = topo.id(i, j);
        if (cells[id] === CELL.WALL) { cells[id] = CELL.CORRIDOR; changed.add(id); }
      };
      while (j !== t.j) { j += Math.sign(t.j - j); mark(); }
      while (i !== t.i) { i += Math.sign(t.i - i); mark(); }
      const edited = rebuildDungeon(base, cells, { changed, autoDoors: true });
      const newDoors = edited.doors.length - base.doors.filter(o => o.edges.every(([a, b]) => cells[a] && cells[b])).length;
      const segs = buildWallSegments(edited);
      const lights = placeLights(edited, { lightChance: 1 });
      if (!segs.walls.length) fail("sem paredes depois de editar", ctx);
      if (changed.size && newDoors < 0) fail("perdeu portas", ctx);
      if (process.env.DEBUG) console.log(gridType, wallStyle, seed, "portas novas:", newDoors);
      if (!lights.length) fail("sem luzes depois de editar", ctx);

      // 2. Aumentar uma sala: pinta de SALA uma faixa de rocha colada nela → continua 1 sala só
      const cells2 = Uint8Array.from(base.cells);
      const changed2 = new Set();
      const room = linked[1] ?? linked[0];
      for (let jj = room.x; jj < room.x + room.w; jj++) {
        const id = topo.id(room.y - 1, jj);
        if (room.y - 1 > 0 && cells2[id] === CELL.WALL) { cells2[id] = CELL.ROOM; changed2.add(id); }
      }
      const grown = rebuildDungeon(base, cells2, { changed: changed2 });
      const g = grown.rooms.find(r => r.id === room.id);
      if (!g || g.cells.length < room.w * room.h) fail("sala aumentada não foi reconhecida", ctx);
      if (grown.rooms.length > base.rooms.length) fail("sala aumentada virou duas", ctx);
      placeLights(grown, { lightChance: 1 });
      buildWallSegments(grown);

      // 3. Apagar um corredor inteiro: não pode quebrar nada
      const cells3 = Uint8Array.from(base.cells);
      for (let id = 0; id < topo.count; id++) if (cells3[id] === CELL.CORRIDOR) cells3[id] = CELL.WALL;
      const erased = rebuildDungeon(base, cells3, { changed: new Set() });
      if (erased.doors.some(o => o.edges.some(([a, b]) => !cells3[a] || !cells3[b]))) fail("porta sobrou no vazio", ctx);
      buildWallSegments(erased);
      placeLights(erased, { lightChance: 1 });
    }
  }
}
console.log(failures ? `${failures} falha(s)` : "editor: tudo ok (30 combinações × 4 cenários)");
if (failures) process.exit(1);
