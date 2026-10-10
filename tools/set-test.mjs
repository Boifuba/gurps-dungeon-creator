// Teste do planejamento de cenas ligadas (mesma lógica de createDungeonSet, sem Foundry):
//   node tools/set-test.mjs
// Para cada combinação confere: ligações que couberam dos dois lados, alinhamento das saídas
// (mesma linha em leste/oeste, mesma coluna em sul/norte) e se a saída é alcançável a pé.
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateDungeon, CELL } from "../scripts/generator.js";
import { createTopology, createGrid } from "../scripts/topology.js";
import { planLinkedSet } from "../scripts/set-planner.js";

Math.SQRT3 = 1.7320508075688772;
Math.SQRT1_3 = 0.5773502691896257;
const foundryCommon = process.env.FOUNDRY_COMMON
  ?? path.join(os.homedir(), "AppData/Local/Programs/Foundry Virtual Tabletop/resources/app/common");
const load = f => import(pathToFileURL(path.join(foundryCommon, "grid", f)).href);
const { default: SquareGrid } = await load("square.mjs");
const { default: HexagonalGrid } = await load("hexagonal.mjs");

let failures = 0, totalLinks = 0, okLinksTotal = 0, misaligned = 0;
for (const count of [2, 4, 9]) {
  for (const gridType of [4, 2, 1]) {
    for (const wallStyle of ["straight", "grid"]) {
      for (const seed of ["a", "b", "c", "d"]) {
        const { plans, links } = planLinkedSet(count, seed, (k, s, exits) => {
          const topo = createTopology(createGrid(gridType, 100, { SquareGrid, HexagonalGrid }), 50, 36, wallStyle);
          return generateDungeon(topo, { seed: s, exits });
        });
        const exitOf = (k, id) => plans[k].exits.find(ex => ex.id === id);
        for (const l of links) {
          totalLinks++;
          const ea = exitOf(l.a, l.id), eb = exitOf(l.b, l.id);
          if (!ea || !eb) continue;
          okLinksTotal++;
          const ta = plans[l.a].topology, tb = plans[l.b].topology;
          const pa = ta.ij(ea.cell), pb = tb.ij(eb.cell);
          const off = l.sideA === "east" ? Math.abs(pa.i - pb.i) : Math.abs(pa.j - pb.j);
          if (off > 1) { misaligned++; if (process.env.DEBUG) console.log("desvio", off, l.sideA, gridType, wallStyle); }
        }
        // Saídas alcançáveis a partir da sala 1
        for (const d of plans) {
          const topo = d.topology;
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
          if (d.exits.some(ex => !seen.has(ex.cell))) failures++;
        }
      }
    }
  }
}
console.log(`ligações que couberam: ${okLinksTotal}/${totalLinks} · desalinhadas: ${misaligned} · saídas inalcançáveis: ${failures}`);
if (failures || misaligned) process.exit(1);
