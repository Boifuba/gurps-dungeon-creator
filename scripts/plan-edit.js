/**
 * Planta editável (puro JavaScript, sem Foundry).
 *
 * Depois que o Mestre pinta a planta, as salas deixam de ser retângulos: aqui elas são
 * reconstruídas a partir das células (cada grupo de células de SALA vira uma sala),
 * as portas antigas que continuam válidas são mantidas e as entradas novas ganham porta.
 */
import { CELL, blocksLocally } from "./generator.js";

/** Células → texto compacto ("0012…") para guardar nos flags da cena. */
export function encodeCells(cells) {
  return Array.from(cells).join("");
}

export function decodeCells(text) {
  return Uint8Array.from(text, ch => ch.charCodeAt(0) - 48);
}

const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Reconstrói salas e portas a partir das células editadas.
 * @param {object} base     Dungeon antes da edição ({topology, seed, rooms, doors, teleports, exits, options})
 * @param {Uint8Array} cells Células depois da edição
 * @param {object} [opts]
 * @param {Set<number>} [opts.changed]   Células alteradas nesta edição (só elas ganham portas novas)
 * @param {boolean} [opts.autoDoors]     Colocar porta nas entradas novas de salas
 * @returns {object} Nova dungeon, no mesmo formato de generateDungeon
 */
export function rebuildDungeon(base, cells, { changed = new Set(), autoDoors = true } = {}) {
  const topo = base.topology;
  const isFloor = id => id >= 0 && cells[id] !== CELL.WALL;

  // 1. Salas = grupos conectados de células de SALA ------------------------------
  const roomOf = new Int32Array(topo.count);
  const components = [];
  for (let id = 0; id < topo.count; id++) {
    if (cells[id] !== CELL.ROOM || roomOf[id]) continue;
    const tag = components.length + 1;
    const list = [id];
    roomOf[id] = tag;
    for (let k = 0; k < list.length; k++) {
      for (const n of topo.neighbors(list[k])) {
        if (n.id < 0 || roomOf[n.id] || cells[n.id] !== CELL.ROOM) continue;
        roomOf[n.id] = tag;
        list.push(n.id);
      }
    }
    components.push(list);
  }

  // Cada grupo herda a sala antiga cujo centro ele contém (mantém número, secreta, teleporte...)
  const rooms = [];
  const usedOld = new Set();
  let nextId = Math.max(0, ...base.rooms.map(r => r.id)) + 1;
  const tagToId = new Map();
  for (let t = 0; t < components.length; t++) {
    const list = components[t];
    const members = new Set(list);
    const old = base.rooms.find(r => !usedOld.has(r.id) && members.has(r.centerCell));
    if (old) usedOld.add(old.id);
    const id = old?.id ?? nextId++;
    tagToId.set(t + 1, id);

    let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity, cx = 0, cy = 0;
    for (const c of list) {
      const { i, j } = topo.ij(c);
      iMin = Math.min(iMin, i); iMax = Math.max(iMax, i);
      jMin = Math.min(jMin, j); jMax = Math.max(jMax, j);
      const p = topo.center(c);
      cx += p.x; cy += p.y;
    }
    cx /= list.length; cy /= list.length;
    const centerCell = old && members.has(old.centerCell) ? old.centerCell
      : list.reduce((best, c) => {
        const p = topo.center(c), q = topo.center(best);
        return Math.hypot(p.x - cx, p.y - cy) < Math.hypot(q.x - cx, q.y - cy) ? c : best;
      });
    rooms.push({
      ...(old ?? {}),
      id, x: jMin, y: iMin, w: jMax - jMin + 1, h: iMax - iMin + 1,
      centerCell, cells: list, isNew: !old
    });
  }
  const roomIdOf = id => (id >= 0 && roomOf[id] ? tagToId.get(roomOf[id]) : 0);

  // 2. Portas antigas que continuam de pé (todas as células da porta ainda são chão) -------
  const doors = [];
  const usedEdges = new Set();
  for (const door of base.doors) {
    if (!door.edges.every(([a, b]) => isFloor(a) && isFloor(b))) continue;
    const roomCell = door.edges.flat().find(c => cells[c] === CELL.ROOM);
    doors.push({ ...door, room: roomCell !== undefined ? roomIdOf(roomCell) : door.room });
    door.edges.forEach(([a, b]) => usedEdges.add(edgeKey(a, b)));
  }

  // 3. Entradas novas: corredor encostando numa sala, perto de algo que foi pintado agora ---
  if (autoDoors) {
    for (const room of rooms) {
      if (room.isolated) continue;
      const members = new Set(room.cells);
      // Células de corredor encostadas nesta sala
      const touching = new Set();
      for (const c of room.cells) {
        for (const n of topo.neighbors(c)) if (n.id >= 0 && cells[n.id] === CELL.CORRIDOR) touching.add(n.id);
      }
      // Agrupa as que se tocam: cada grupo é uma "boca" de corredor
      const seen = new Set();
      for (const start of touching) {
        if (seen.has(start)) continue;
        const group = [start];
        seen.add(start);
        for (let k = 0; k < group.length; k++) {
          for (const n of topo.neighbors(group[k])) {
            if (touching.has(n.id) && !seen.has(n.id)) { seen.add(n.id); group.push(n.id); }
          }
        }
        if (group.length > 3) continue; // corredor colado na parede da sala: não é uma entrada
        const edges = [];
        for (const c of group) {
          for (const n of topo.neighbors(c)) if (members.has(n.id)) edges.push([c, n.id]);
        }
        if (edges.some(([a, b]) => usedEdges.has(edgeKey(a, b)))) continue;
        const isNew = edges.some(([a, b]) => changed.has(a) || changed.has(b));
        if (!isNew) continue; // entradas antigas sem porta continuam sem porta
        const closed = new Set(edges.map(([a, b]) => edgeKey(a, b)));
        if (!blocksLocally(topo, isFloor, group[0], closed, edgeKey, id => members.has(id), 10)) continue;
        doors.push({ edges, room: room.id });
        closed.forEach(k => usedEdges.add(k));
      }
    }
  }

  return { ...base, cells, rooms, doors };
}
