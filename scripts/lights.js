/**
 * Posiciona as fontes de luz das salas (puro JavaScript, sem Foundry).
 *
 * "wall":   tochas presas nas paredes, quantidade sorteada conforme o tamanho da sala,
 *           espalhadas pelo perímetro e longe de portas/entradas de corredor.
 * "center": um braseiro no meio da sala.
 */
import { CELL } from "./generator.js";
import { RNG } from "./rng.js";

/**
 * @returns {{room:number, kind:"torch"|"brazier", x:number, y:number, nx:number, ny:number, wall?:number[], radius:number}[]}
 *   (x, y) = ponto da luz em pixels; (nx, ny) = direção da parede para dentro da sala;
 *   radius = alcance em células (multiplicar pela distância da grade).
 * @param {(room:object) => boolean|undefined} [isLit]  Força uma sala acesa/apagada (ex.: ao editar a planta,
 *   mantém as salas que já estavam iluminadas); undefined = sorteia com lightChance.
 */
export function placeLights(d, { lightChance = 0.6, placement = "wall", isLit } = {}) {
  const topo = d.topology;
  const rng = new RNG(`${d.seed}:lights`);
  const pads = new Set((d.teleports ?? []).flatMap(t => [t.padA, t.padB]));
  for (const c of d.entrance?.cells ?? (d.entrance ? [d.entrance.cell] : [])) pads.add(c); // nada de tocha sobre a escada
  const lights = [];

  for (const room of d.rooms) {
    const rolled = rng.chance(lightChance);
    if (!(isLit?.(room) ?? rolled)) continue;
    const maxSide = Math.max(room.w, room.h);

    const torches = placement === "wall" ? wallTorches(topo, d.cells, room, pads, rng) : [];
    if (torches.length) {
      // Várias tochas dividem o trabalho: alcance menor que um braseiro central
      const radius = Math.min(10, Math.max(3, maxSide * 0.7));
      for (const t of torches) lights.push({ room: room.id, kind: "torch", radius, ...t });
      continue;
    }

    const c = topo.hexCenter(room.centerCell);
    lights.push({ room: room.id, kind: "brazier", x: c.x, y: c.y, nx: 0, ny: 0, radius: maxSide / 2 + 1 });
  }
  return lights;
}

/** Células de uma sala retangular. */
function rectCells(topo, room) {
  const out = [];
  for (let i = room.y; i < room.y + room.h; i++) {
    for (let j = room.x; j < room.x + room.w; j++) out.push(topo.id(i, j));
  }
  return out;
}

/** Escolhe pontos de parede da sala e devolve as tochas. */
function wallTorches(topo, cells, room, pads, rng) {
  // Salas geradas são retângulos; salas editadas na planta podem ter qualquer formato (room.cells)
  const roomCells = room.cells ?? rectCells(topo, room);
  const members = new Set(roomCells);
  const inRoom = id => members.has(id);

  // Candidatos: cada aresta entre uma célula da sala e a rocha.
  // Pula células que encostam em corredor (entradas/portas) e os círculos de teleporte.
  const candidates = [];
  for (const id of roomCells) {
    if (pads.has(id)) continue;
    const neighbors = topo.neighbors(id);
    if (neighbors.some(n => n.id >= 0 && !inRoom(n.id) && cells[n.id] !== CELL.WALL)) continue;
    for (const n of neighbors) {
      if (n.id >= 0 && cells[n.id] !== CELL.WALL) continue;
      const [x1, y1, x2, y2] = n.edge;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const c = topo.center(id);
      const len = Math.hypot(c.x - mx, c.y - my) || 1;
      const nx = (c.x - mx) / len, ny = (c.y - my) / len; // aponta da parede para dentro
      const inset = topo.size * 0.2;
      candidates.push({ x: mx + nx * inset, y: my + ny * inset, nx, ny, wall: n.edge });
    }
  }
  if (!candidates.length) return [];

  // Quantidade conforme o perímetro: 3×3 → 1–2 · 6×6 → 2–3 · 9×9 → 3–4
  const base = Math.max(1, Math.floor((2 * (room.w + room.h)) / 12));
  const count = Math.min(4, rng.int(base, base + 1), candidates.length);

  // Amostragem pelo ponto mais distante: espalha as tochas pelo perímetro
  const chosen = [rng.pick(candidates)];
  const minGap = topo.size * 2;
  while (chosen.length < count) {
    let best = null, bestD = -1;
    for (const c of candidates) {
      const d = Math.min(...chosen.map(o => Math.hypot(o.x - c.x, o.y - c.y))) + rng.next() * topo.size * 0.1;
      if (d > bestD) { bestD = d; best = c; }
    }
    if (bestD < minGap) break;
    chosen.push(best);
  }
  return chosen;
}
