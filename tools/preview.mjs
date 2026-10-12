// Teste fora do Foundry:  node tools/preview.mjs [seed] [gridType]
// gridType: 1 = quadrado, 2 = hex linhas, 4 = hex colunas (padrão)
// Terceiro argumento opcional: largura dos corredores (1–3)
// Quarto argumento opcional: estilo das paredes ("straight" padrão, ou "grid")
// Usa as classes de grade do próprio Foundry instalado.
// Mostra a dungeon em ASCII e confere se todas as salas são alcançáveis.
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateDungeon, toAscii, CELL } from "../scripts/generator.js";
import { buildWallSegments } from "../scripts/walls.js";
import { placeLights } from "../scripts/lights.js";
import { createTopology, createGrid } from "../scripts/topology.js";

// Constantes que o Foundry adiciona ao Math
Math.SQRT3 = 1.7320508075688772;
Math.SQRT1_3 = 0.5773502691896257;

const foundryCommon = process.env.FOUNDRY_COMMON
  ?? path.join(os.homedir(), "AppData/Local/Programs/Foundry Virtual Tabletop/resources/app/common");
const load = f => import(pathToFileURL(path.join(foundryCommon, "grid", f)).href);
const { default: SquareGrid } = await load("square.mjs");
const { default: HexagonalGrid } = await load("hexagonal.mjs");

const seed = process.argv[2] || "teste";
const gridType = Number(process.argv[3] || 4);
const grid = createGrid(gridType, 100, { SquareGrid, HexagonalGrid });
const wallStyle = process.argv[5] || "straight";
const topo = createTopology(grid, 50, 36, wallStyle);
const corridorWidth = Number(process.argv[4] || 1);
const d = generateDungeon(topo, {
  seed, corridorWidth,
  secretRooms: Number(process.env.SECRET ?? 1),
  teleportRooms: Number(process.env.TELE ?? 1),
  layout: process.env.LAYOUT ?? "rooms",
  traps: Number(process.env.TRAPS ?? 2),
  // EXITS="east:0.5,west:0.3" — saídas pela borda
  exits: (process.env.EXITS ?? "").split(",").filter(Boolean).map((e, k) => {
    const [side, pos] = e.split(":");
    return { id: "x" + k, side, pos: Number(pos) };
  })
});
if (!process.env.QUIET) console.log(toAscii(d));

// Flood-fill a partir da primeira sala
const seen = new Set([d.rooms[0].centerCell]);
const stack = [d.rooms[0].centerCell];
while (stack.length) {
  const c = stack.pop();
  for (const n of topo.neighbors(c)) {
    if (n.id < 0 || seen.has(n.id) || d.cells[n.id] === CELL.WALL) continue;
    seen.add(n.id);
    stack.push(n.id);
  }
}
const unreachable = d.rooms.filter(r => !r.isolated && !seen.has(r.centerCell));
const leaking = d.rooms.filter(r => r.isolated && seen.has(r.centerCell)); // sala isolada com acesso a pé = erro
const { walls, doors: openDoors, lockedDoors, secretDoors } = buildWallSegments(d);
const doors = [...openDoors, ...lockedDoors];

// Nenhum centro de hex de chão pode ficar a menos de 1/4 de hex de uma parede/porta
const segDist = (px, py, [x1, y1, x2, y2]) => {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};
let minDist = Infinity;
for (let id = 0; id < topo.count; id++) {
  if (d.cells[id] === CELL.WALL) continue;
  const c = topo.hexCenter(id);
  for (const seg of [...walls, ...doors, ...secretDoors]) minDist = Math.min(minDist, segDist(c.x, c.y, seg) / topo.size);
}
// Tochas: dentro da área de chão da sala, a ~0,2 hex de uma parede, e nunca em cima de uma porta
const pointInPoly = (x, y, poly) => {
  let ins = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const pa = poly[a], pb = poly[b];
    if ((pa.y > y) !== (pb.y > y) && x < ((pb.x - pa.x) * (y - pa.y)) / (pb.y - pa.y) + pa.x) ins = !ins;
  }
  return ins;
};
const lights = placeLights(d, { lightChance: 1, placement: "wall" });
let badTorch = 0;
for (const l of lights.filter(l => l.kind === "torch")) {
  const room = d.rooms.find(r => r.id === l.room);
  let inside = false;
  for (let i = room.y; i < room.y + room.h && !inside; i++) {
    for (let j = room.x; j < room.x + room.w && !inside; j++) inside = pointInPoly(l.x, l.y, topo.vertices(topo.id(i, j)));
  }
  const wallD = Math.min(...walls.map(s => segDist(l.x, l.y, s))) / topo.size;
  const doorD = doors.length ? Math.min(...doors.map(s => segDist(l.x, l.y, s))) / topo.size : 9;
  if (!inside || wallD > 0.25 || doorD < 0.4) { badTorch++; if (process.env.DEBUG) console.log("tocha ruim", { room: l.room, inside, wallD: wallD.toFixed(2), doorD: doorD.toFixed(2) }); }
}
const torchCount = lights.filter(l => l.kind === "torch").length;
// Salas secretas: alcançáveis a pé, mas só atravessando a porta secreta
const secretEdge = new Set(d.doors.filter(o => o.secret).flatMap(o => o.edges.map(([a, b]) => a < b ? a + "|" + b : b + "|" + a)));
const seen2 = new Set([d.rooms[0].centerCell]);
const stack2 = [d.rooms[0].centerCell];
while (stack2.length) {
  const c = stack2.pop();
  for (const n of topo.neighbors(c)) {
    if (n.id < 0 || seen2.has(n.id) || d.cells[n.id] === CELL.WALL) continue;
    if (secretEdge.has(c < n.id ? c + "|" + n.id : n.id + "|" + c)) continue;
    seen2.add(n.id);
    stack2.push(n.id);
  }
}
const secretRooms = d.rooms.filter(r => r.secret);
// Armadilhas no chão alcançável; entrada dentro da sala 1
const trapsBad = d.traps.filter(t => d.cells[t.cell] === CELL.WALL || !seen.has(t.cell)).length;
const entranceBad = d.entrance && d.entrance.room !== d.rooms[0].id ? 1 : 0;
const exitsBad = d.exits.filter(x => !seen.has(x.cell)).length;
const exitsWanted = (process.env.EXITS ?? "").split(",").filter(Boolean).length;
const secretBad = secretRooms.filter(r => !seen.has(r.centerCell) || seen2.has(r.centerCell)).length;
console.log(`estilo=${wallStyle} distMin=${minDist.toFixed(2)} grid=${gridType} largura=${corridorWidth} seed=${d.seed} cena=${topo.width}x${topo.height}px salas=${d.rooms.length} portas=${doors.length} paredes=${walls.length} tochas=${torchCount} tochasRuins=${badTorch} inalcançáveis=${unreachable.length} secretas=${secretRooms.length}/${secretDoors.length}p secretasRuins=${secretBad} armadilhas=${d.traps.length} armadilhasRuins=${trapsBad} entradaRuim=${entranceBad} trancadas=${d.doors.filter(o => o.locked).length} saídas=${d.exits.length}/${exitsWanted} saídasRuins=${exitsBad} teleportes=${d.teleports.length} isoladas-com-acesso=${leaking.length}`);
if (unreachable.length || leaking.length || badTorch || secretBad || trapsBad || entranceBad || exitsBad || d.exits.length < exitsWanted) process.exit(1);
