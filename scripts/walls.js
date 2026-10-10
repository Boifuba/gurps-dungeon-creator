/**
 * Converte a dungeon em segmentos de parede/porta, em pixels da cena.
 */
import { CELL } from "./generator.js";

/**
 * @returns {{walls: number[][], doors: number[][], secretDoors: number[][]}} Segmentos [x1, y1, x2, y2] em pixels.
 */
export function buildWallSegments(d, { openExits = [] } = {}) {
  const topo = d.topology;
  const isFloor = id => id >= 0 && d.cells[id] !== CELL.WALL;

  // Toda aresta entre chão e rocha (ou borda do mapa) vira parede
  // Saídas ativas (ligadas a outra cena) ficam abertas para fora do mapa
  const open = new Set(openExits);
  const raw = [];
  for (let id = 0; id < topo.count; id++) {
    if (!isFloor(id)) continue;
    for (const n of topo.neighbors(id)) {
      if (n.id < 0 && open.has(id)) continue;
      if (!isFloor(n.id)) raw.push(n.edge);
    }
  }

  const toSegments = door => {
    const edges = door.edges.map(([a, b]) => topo.sharedEdge(a, b));
    const centers = door.edges.flat().map(id => topo.hexCenter(id));
    return doorSegments(edges, centers, topo.size);
  };
  const doors = d.doors.filter(door => !door.secret).flatMap(toSegments);
  const secretDoors = d.doors.filter(door => door.secret).flatMap(toSegments);
  return { walls: mergeCollinear(raw), doors, secretDoors };
}

/**
 * Uma porta pode cobrir várias arestas (corredor largo, ou hex encostando em 2 hexes da sala).
 * Se as arestas formam uma linha contínua, vira uma porta só, reta, de ponta a ponta —
 * desde que essa reta não passe perto do centro de nenhum hex envolvido (onde ficaria um token).
 */
function doorSegments(edges, centers, size) {
  if (edges.length === 1) return edges;
  const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;
  const count = new Map();
  const pts = new Map();
  for (const [x1, y1, x2, y2] of edges) {
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      const k = key(x, y);
      count.set(k, (count.get(k) ?? 0) + 1);
      pts.set(k, [x, y]);
    }
  }
  const ends = [...count].filter(([, n]) => n === 1).map(([k]) => pts.get(k));
  if (ends.length !== 2) return edges; // arestas separadas: uma porta por aresta
  const chord = [...ends[0], ...ends[1]];
  if (centers.some(c => distToSegment(c, chord) < size * 0.2)) return edges;
  return [chord];
}

function distToSegment({ x, y }, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Junta segmentos colineares que se tocam (no quadrado reduz muito o nº de paredes). */
function mergeCollinear(segments) {
  const groups = new Map();
  for (let [x1, y1, x2, y2] of segments) {
    if (x2 < x1 || (x2 === x1 && y2 < y1)) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const offset = x1 * -uy + y1 * ux; // distância da reta à origem
    const key = `${ux.toFixed(3)},${uy.toFixed(3)},${offset.toFixed(1)}`;
    const t1 = x1 * ux + y1 * uy, t2 = x2 * ux + y2 * uy;
    if (!groups.has(key)) groups.set(key, { ux, uy, items: [] });
    groups.get(key).items.push({ t1, t2, x1, y1, x2, y2 });
  }

  const out = [];
  for (const { items } of groups.values()) {
    items.sort((p, q) => p.t1 - q.t1);
    let cur = { ...items[0] };
    for (let k = 1; k < items.length; k++) {
      const s = items[k];
      if (s.t1 <= cur.t2 + 0.5) {
        if (s.t2 > cur.t2) Object.assign(cur, { t2: s.t2, x2: s.x2, y2: s.y2 });
      } else {
        out.push([cur.x1, cur.y1, cur.x2, cur.y2]);
        cur = { ...s };
      }
    }
    out.push([cur.x1, cur.y1, cur.x2, cur.y2]);
  }
  return out;
}
