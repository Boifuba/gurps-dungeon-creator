/**
 * Onde ficam as mesas (puro JavaScript, sem Foundry).
 *
 * Cada sala comum ganha até 2 mesas, conforme a área: precisam de espaço livre ao redor,
 * ficam longe de portas, entrada, teleportes, armadilhas, pilastras e do centro da sala
 * (onde ficam o braseiro e a nota do diário), e alinhadas com o lado maior da sala.
 */
import { CELL, roomCells } from "./generator.js";
import { RNG } from "./rng.js";

/**
 * @param {object} d        Dungeon gerada
 * @param {{src:string, width:number, height:number}[]} tables  Imagens disponíveis (tamanho natural em px)
 * @param {object} [options]
 * @param {number} [options.chance]       Chance de cada mesa possível aparecer
 * @param {number} [options.pxPerYard]    Pixels do asset por jarda (padrão dos assets: 120)
 * @returns {{src:string, x:number, y:number, width:number, height:number, rotation:number, room:number}[]}
 *   x, y = canto superior esquerdo em pixels da cena (a rotação é em torno do centro).
 */
export function placeFurniture(d, tables, { chance = 0.7, pxPerYard = 120 } = {}) {
  if (!tables.length) return [];
  const topo = d.topology;
  const rng = new RNG(`${d.seed}:furniture`);
  const scale = topo.size / pxPerYard;

  const avoid = new Set([
    ...(d.teleports ?? []).flatMap(t => [t.padA, t.padB]),
    ...(d.traps ?? []).map(t => t.cell),
    ...d.doors.flatMap(o => o.edges.flat()),
    ...(d.entrance ? [d.entrance.cell] : [])
  ]);
  const near = (id, rings) => {
    const out = new Set([id]);
    for (let r = 0; r < rings; r++) {
      for (const c of [...out]) for (const n of topo.neighbors(c)) if (n.id >= 0) out.add(n.id);
    }
    return out;
  };

  const placed = [];
  for (const room of d.rooms) {
    if (room.isolated) continue;
    const cells = new Set(roomCells(topo, room).filter(c => d.cells[c] === CELL.ROOM));
    const max = Math.min(2, Math.floor(cells.size / 25));
    if (!max) continue;
    // Cabe uma mesa: dois anéis de chão da própria sala ao redor, nada para evitar por perto
    const spots = rng.shuffle([...cells].filter(c => {
      if (c === room.centerCell) return false;
      const area = near(c, 2);
      return [...area].every(a => cells.has(a) && !avoid.has(a));
    }));
    const chosen = [];
    for (const c of spots) {
      if (chosen.length >= max) break;
      if (chosen.some(o => topo.distance(o, c) < 4) || topo.distance(c, room.centerCell) < 2) continue;
      if (!rng.chance(chance)) continue;
      chosen.push(c);
    }
    for (const c of chosen) {
      const t = rng.pick(tables);
      const width = Math.round(t.width * scale), height = Math.round(t.height * scale);
      const center = topo.hexCenter(c);
      const along = room.w >= room.h ? 0 : 90; // lado maior da mesa no lado maior da sala
      placed.push({
        src: t.src,
        x: Math.round(center.x - width / 2),
        y: Math.round(center.y - height / 2),
        width, height,
        rotation: along + (rng.chance(0.5) ? 180 : 0),
        room: room.id,
        cell: c
      });
    }
  }
  return placed;
}
