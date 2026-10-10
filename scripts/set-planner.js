/**
 * Planejamento de cenas ligadas (puro JavaScript, sem Foundry).
 *
 * As cenas ficam numa grade (4 = 2×2, 9 = 3×3). Cada par de vizinhas é ligado por uma saída
 * na borda: leste ↔ oeste (mesma linha) ou sul ↔ norte (mesma coluna). Se uma ligação não
 * couber em alguma das duas cenas, tenta outra posição na borda e replaneja só essas cenas.
 */
import { RNG } from "./rng.js";

/**
 * @param {number} count                 Número de cenas
 * @param {string} baseSeed
 * @param {(k:number, seed:string, exits:object[]) => object} planOne
 *        Gera a cena k (deve devolver um objeto com .dungeon.exits ou .exits)
 * @param {number} [maxTries]
 * @returns {{plans:object[], links:object[], okLinks:object[], gridCols:number}}
 */
export function planLinkedSet(count, baseSeed, planOne, maxTries = 6) {
  const gridCols = Math.ceil(Math.sqrt(count));
  const rng = new RNG(`${baseSeed}:links`);
  const newPos = () => 0.15 + rng.next() * 0.7;

  const links = [];
  for (let k = 0; k < count; k++) {
    const right = k + 1, down = k + gridCols;
    if (right % gridCols !== 0 && right < count) {
      links.push({ id: `L${links.length}`, a: k, b: right, sideA: "east", sideB: "west", pos: newPos() });
    }
    if (down < count) {
      links.push({ id: `L${links.length}`, a: k, b: down, sideA: "south", sideB: "north", pos: newPos() });
    }
  }
  const exitsOf = k => links.flatMap(l =>
    l.a === k ? [{ id: l.id, side: l.sideA, pos: l.pos }] : l.b === k ? [{ id: l.id, side: l.sideB, pos: l.pos }] : []);
  const exitsIn = plan => (plan.dungeon ?? plan).exits;
  const seedOf = k => `${baseSeed}-${k + 1}`;

  const plans = [];
  for (let k = 0; k < count; k++) plans.push(planOne(k, seedOf(k), exitsOf(k)));
  const fits = l => exitsIn(plans[l.a]).some(ex => ex.id === l.id) && exitsIn(plans[l.b]).some(ex => ex.id === l.id);

  for (let attempt = 1; attempt < maxTries; attempt++) {
    const failed = links.filter(l => !fits(l));
    if (!failed.length) break;
    const touched = new Set();
    for (const l of failed) {
      l.pos = newPos();
      touched.add(l.a);
      touched.add(l.b);
    }
    for (const k of touched) plans[k] = planOne(k, seedOf(k), exitsOf(k));
  }

  return { plans, links, okLinks: links.filter(fits), gridCols };
}
