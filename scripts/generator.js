/**
 * Algoritmo de geração de dungeons (salas + corredores).
 * Funciona sobre qualquer Topology (quadrado ou hexágono) — ver topology.js.
 */
import { RNG, randomSeed } from "./rng.js";

export const CELL = Object.freeze({ WALL: 0, ROOM: 1, CORRIDOR: 2 });

export const DEFAULT_OPTIONS = Object.freeze({
  width: 50,          // colunas
  height: 36,         // linhas
  rooms: 10,          // nº de salas desejado
  roomMin: 4,         // menor lado de sala (células)
  roomMax: 9,         // maior lado de sala (células)
  extraLoops: 0.15,   // fração de conexões extras (cria caminhos alternativos)
  doorChance: 0.7,    // chance de cada entrada de sala ter porta
  corridorWidth: 1,   // largura dos corredores em células (1–3)
  secretRooms: 1,     // salas atrás de uma porta secreta (passagem estreita)
  teleportRooms: 1,   // salas sem nenhum acesso a pé, alcançáveis só por teleporte
  exits: [],          // saídas pela borda: [{id, side: "north"|"south"|"east"|"west", pos: 0–1}]
  seed: ""
});

/**
 * Gera uma dungeon sobre a topologia dada.
 * @param {import("./topology.js").Topology} topo
 */
export function generateDungeon(topo, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const seed = String(opts.seed || randomSeed());
  const rng = new RNG(seed);
  const { cols, rows } = topo;
  const cells = new Uint8Array(topo.count); // tudo WALL
  const isFloor = id => id >= 0 && cells[id] !== CELL.WALL;

  // 1. Salas (retângulos em coordenadas de linha/coluna) --------------------
  const rooms = [];
  const maxAttempts = opts.rooms * 40;
  for (let attempt = 0; attempt < maxAttempts && rooms.length < opts.rooms; attempt++) {
    const w = rng.int(opts.roomMin, opts.roomMax);
    const h = rng.int(opts.roomMin, opts.roomMax);
    if (w > cols - 2 || h > rows - 2) continue;
    const x = rng.int(1, cols - w - 1);
    const y = rng.int(1, rows - h - 1);
    // Rejeita sobreposição (com 2 células de margem para sobrar parede entre salas)
    const overlaps = rooms.some(r =>
      x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y);
    if (overlaps) continue;
    const id = rooms.length + 1;
    const centerCell = topo.id(y + Math.floor(h / 2), x + Math.floor(w / 2));
    rooms.push({ id, x, y, w, h, centerCell });
  }
  const roomOf = new Int16Array(topo.count); // 0 = nenhuma sala
  for (const r of rooms) {
    for (let i = r.y; i < r.y + r.h; i++) {
      for (let j = r.x; j < r.x + r.w; j++) {
        cells[topo.id(i, j)] = CELL.ROOM;
        roomOf[topo.id(i, j)] = r.id;
      }
    }
  }

  // 2. Salas especiais — sempre sobram pelo menos 2 salas comuns (a sala 1 é sempre comum)
  //    r.secret   = atrás de porta secreta (ligada por passagem própria, no passo 5b)
  //    r.isolated = sem acesso a pé, só por teleporte (passo 6)
  const secretWanted = Math.max(0, Number(opts.secretRooms) || 0);
  const teleportWanted = Math.max(0, Number(opts.teleportRooms) || 0);
  const specialCount = Math.min(secretWanted + teleportWanted, rooms.length - 2);
  const margin = r => {
    const out = [];
    for (let i = r.y - 1; i <= r.y + r.h; i++) {
      for (let j = r.x - 1; j <= r.x + r.w; j++) if (topo.inBounds(i, j)) out.push(topo.id(i, j));
    }
    return out;
  };
  // Salas coladas no ponto ideal de uma saída de borda não viram especiais
  // (a margem delas empurraria a saída para longe da posição combinada com a cena vizinha)
  const idealExits = new Set((opts.exits ?? [])
    .map(ex => pickEdgeCell(topo, ex.side, ex.pos, new Set(), cells)).filter(c => c !== null));
  const nearExit = r => margin(r).some(id => idealExits.has(id));
  rng.shuffle(rooms.slice(1)).filter(r => !nearExit(r)).slice(0, Math.max(0, specialCount)).forEach((r, k) => {
    if (k < secretWanted) r.secret = true;
    else r.isolated = true;
  });
  const isSpecial = r => r.secret || r.isolated;
  const linked = rooms.filter(r => !isSpecial(r));

  // Corredores comuns não podem tocar salas especiais (nem a borda delas)
  const blocked = new Set();
  for (const r of rooms) if (isSpecial(r)) margin(r).forEach(id => blocked.add(id));

  // 3. Conexões: árvore geradora mínima (Prim) + algumas arestas extras ------
  const dist = (a, b) => topo.distance(a.centerCell, b.centerCell);
  const edges = [];
  if (linked.length > 1) {
    const inTree = new Set([0]);
    while (inTree.size < linked.length) {
      let best = null;
      for (const i of inTree) {
        for (let j = 0; j < linked.length; j++) {
          if (inTree.has(j)) continue;
          const d = dist(linked[i], linked[j]);
          if (!best || d < best.d) best = { a: i, b: j, d };
        }
      }
      edges.push(best);
      inTree.add(best.b);
    }
    const candidates = [];
    for (let i = 0; i < linked.length; i++) {
      for (let j = i + 1; j < linked.length; j++) {
        if (edges.some(e => (e.a === i && e.b === j) || (e.a === j && e.b === i))) continue;
        candidates.push({ a: i, b: j, d: dist(linked[i], linked[j]) });
      }
    }
    candidates.sort((p, q) => p.d - q.d);
    const extra = Math.round(linked.length * opts.extraLoops);
    for (const c of candidates.slice(0, extra * 2)) {
      if (edges.length >= linked.length - 1 + extra) break;
      if (rng.chance(0.5)) edges.push(c);
    }
  }

  // 4. Corredores ----------------------------------------------------------
  const corridorWidth = Math.min(3, Math.max(1, Math.round(Number(opts.corridorWidth) || 1)));
  const entrances = []; // {outer, inner, prev}: corredor que encosta na sala
  const carvePath = path => {
    const carve = [...path, ...widenPath(topo, path, corridorWidth, blocked)];
    for (const id of carve) if (!roomOf[id]) cells[id] = CELL.CORRIDOR;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k];
      if (!roomOf[a] && roomOf[b]) entrances.push({ outer: a, inner: b, prev: path[k - 2] });
      if (roomOf[a] && !roomOf[b]) entrances.push({ outer: b, inner: a, prev: path[k + 1] });
    }
  };
  for (const e of edges) {
    const from = linked[e.a].centerCell, to = linked[e.b].centerCell;
    let path = topo.isHex ? hexPath(topo, from, to, rng) : squarePath(topo, from, to, rng);
    if (path.some(id => blocked.has(id))) path = aStarPath(topo, from, to, blocked);
    if (path) carvePath(path);
  }

  // 4b. Saídas pela borda: corredor da sala comum mais próxima até a borda do mapa.
  //     O fim do corredor vira um teleporte para outra cena (ver scene-builder).
  const exits = [];
  for (const ex of opts.exits ?? []) {
    const cell = pickEdgeCell(topo, ex.side, ex.pos, blocked, cells);
    if (cell === null || !linked.length) continue;
    const target = linked.reduce((best, r) =>
      topo.distance(cell, r.centerCell) < topo.distance(cell, best.centerCell) ? r : best);
    // O corredor não pode andar pela borda do mapa (só a célula da saída fica nela)
    const avoid = new Set(blocked);
    for (let i = 0; i < topo.rows; i++) for (let j = 0; j < topo.cols; j++) {
      if (i === 0 || j === 0 || i === topo.rows - 1 || j === topo.cols - 1) avoid.add(topo.id(i, j));
    }
    avoid.delete(cell);
    // Sai reto da borda e vira uma vez ("L"); se esbarrar em algo proibido, usa o caminho mais curto
    const firstAxis = ex.side === "east" || ex.side === "west" ? "j" : "i";
    let path = topo.isHex
      ? hexPath(topo, cell, target.centerCell, rng)
      : squarePath(topo, cell, target.centerCell, rng, firstAxis);
    if (path.slice(1).some(id => avoid.has(id))) path = aStarPath(topo, cell, target.centerCell, avoid);
    if (!path) continue;
    carvePath(path);
    exits.push({ id: ex.id, side: ex.side, cell });
  }

  // 5. Portas: fecham a "boca" inteira do corredor na entrada da sala ---------
  //    Uma porta = lista de arestas (corredor|sala) que juntas bloqueiam a passagem.
  const doors = [];
  const used = new Set();
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const en of entrances) {
    const room = roomOf[en.inner];
    const candidates = [mouthEdges(topo, cells, roomOf, en.outer, room, corridorWidth)];
    if (corridorWidth === 1 && en.prev !== undefined && cells[en.prev] === CELL.CORRIDOR) {
      candidates.push([[en.prev, en.outer]]);
    }
    for (const doorEdges of candidates) {
      if (!doorEdges.length) continue;
      const keys = doorEdges.map(([a, b]) => edgeKey(a, b));
      if (keys.some(k => used.has(k))) break;
      const closed = new Set(keys);
      const [a0, b0] = doorEdges[0];
      const outside = roomOf[a0] ? b0 : a0;
      const inside = outside === a0 ? b0 : a0;
      const reaches = roomOf[inside] ? (id => roomOf[id] === room) : (id => id === inside);
      if (!blocksLocally(topo, isFloor, outside, closed, edgeKey, reaches, 6 + corridorWidth * 2)) continue;
      keys.forEach(k => used.add(k));
      if (rng.chance(opts.doorChance)) doors.push({ edges: doorEdges, room });
      break;
    }
  }

  // 5b. Salas secretas: passagem estreita da sala secreta até a parede de uma sala comum,
  //     fechada por uma porta secreta (no Foundry, parece parede para os jogadores).
  const roomById = new Map(rooms.map(r => [r.id, r]));
  const isLinkedRoomCell = id => id >= 0 && roomOf[id] > 0 && !isSpecial(roomById.get(roomOf[id]));
  for (const r of rooms) {
    if (!r.secret) continue;
    const forbidden = new Set();
    for (const o of rooms) if (o !== r && isSpecial(o)) margin(o).forEach(id => forbidden.add(id));
    const passage = secretPassage(topo, cells, roomOf, r, isLinkedRoomCell, forbidden, rng);
    if (!passage) {
      // Sem caminho possível: a sala some do mapa
      r.removed = true;
      for (let i = r.y; i < r.y + r.h; i++) {
        for (let j = r.x; j < r.x + r.w; j++) { cells[topo.id(i, j)] = CELL.WALL; roomOf[topo.id(i, j)] = 0; }
      }
      continue;
    }
    for (const id of passage.path) cells[id] = CELL.CORRIDOR;
    const doorRoom = roomOf[passage.doorEdges[0][1]];
    r.secretDoorRoom = doorRoom;
    doors.push({ edges: passage.doorEdges, room: doorRoom, secret: true, secretRoom: r.id });
  }

  // 6. Teleportes: cada sala isolada ganha um par de círculos (ida e volta) ---
  const interiorCell = r => {
    if (r.w < 3 || r.h < 3) return r.centerCell;
    let id;
    do id = topo.id(rng.int(r.y + 1, r.y + r.h - 2), rng.int(r.x + 1, r.x + r.w - 2));
    while (id === r.centerCell && (r.w > 3 || r.h > 3));
    return id;
  };
  const teleports = [];
  const usedPads = new Set();
  for (const r of rooms) {
    if (!r.isolated) continue;
    const source = rng.pick(linked);
    let padA;
    for (let k = 0; k < 20; k++) { padA = interiorCell(source); if (!usedPads.has(padA)) break; }
    usedPads.add(padA);
    teleports.push({ fromRoom: source.id, toRoom: r.id, padA, padB: r.centerCell });
  }

  return { seed, topology: topo, cells, rooms: rooms.filter(r => !r.removed), doors, teleports, exits, options: opts };
}

/**
 * Célula na borda do mapa para uma saída: o hex precisa estar inteiro dentro da cena,
 * livre, e o mais perto possível da posição pedida (0 = início do lado, 1 = fim).
 */
function pickEdgeCell(topo, side, pos, blocked, cells) {
  const { rows, cols } = topo;
  const list = [];
  if (side === "east" || side === "west") {
    const j = side === "east" ? cols - 1 : 0;
    for (let i = 1; i < rows - 1; i++) list.push({ id: topo.id(i, j), k: (i - 1) / Math.max(1, rows - 3) });
  } else {
    const i = side === "south" ? rows - 1 : 0;
    for (let j = 1; j < cols - 1; j++) list.push({ id: topo.id(i, j), k: (j - 1) / Math.max(1, cols - 3) });
  }
  const m = topo.size * 0.45;
  const ok = list.filter(({ id }) => {
    if (blocked.has(id) || cells[id] !== CELL.WALL) return false;
    const c = topo.hexCenter(id);
    return c.x >= m && c.y >= m && c.x <= topo.width - m && c.y <= topo.height - m;
  });
  if (!ok.length) return null;
  const p = Math.min(1, Math.max(0, Number(pos) || 0.5));
  return ok.reduce((best, c) => (Math.abs(c.k - p) < Math.abs(best.k - p) ? c : best)).id;
}

/**
 * Passagem secreta: busca em largura a partir da sala secreta, só por rocha, sem encostar
 * em corredores nem em outras salas, até chegar ao lado da parede de uma sala comum.
 * A porta secreta fica entre a última célula da passagem e a sala comum.
 * @returns {{path:number[], doorEdges:number[][]}|null}
 */
function secretPassage(topo, cells, roomOf, room, isLinkedRoomCell, forbidden, rng, maxLength = 40) {
  const own = id => id >= 0 && roomOf[id] === room.id;
  const passable = id => {
    if (id < 0 || cells[id] !== CELL.WALL || forbidden.has(id)) return false;
    const { i, j } = topo.ij(id);
    return i > 0 && j > 0 && i < topo.rows - 1 && j < topo.cols - 1;
  };
  const parent = new Map();
  let frontier = [];
  for (let i = room.y; i < room.y + room.h; i++) {
    for (let j = room.x; j < room.x + room.w; j++) {
      const id = topo.id(i, j);
      parent.set(id, -1);
      frontier.push(id);
    }
  }
  for (let depth = 0; depth < maxLength && frontier.length; depth++) {
    const next = [];
    const terminals = [];
    for (const c of frontier) {
      for (const n of topo.neighbors(c)) {
        if (parent.has(n.id) || !passable(n.id)) continue;
        let linkedRooms = 0, bad = false;
        for (const m of topo.neighbors(n.id)) {
          if (m.id < 0 || cells[m.id] === CELL.WALL || own(m.id)) continue;
          if (isLinkedRoomCell(m.id)) linkedRooms++;
          else bad = true; // corredor ou outra sala: abriria uma segunda entrada
        }
        if (bad) continue;
        parent.set(n.id, c);
        if (linkedRooms) terminals.push({ id: n.id, linkedRooms });
        else next.push(n.id);
      }
    }
    if (terminals.length) {
      // Prefere encostar em uma única célula da sala (porta reta, no meio da parede)
      const fewest = Math.min(...terminals.map(t => t.linkedRooms));
      const end = rng.pick(terminals.filter(t => t.linkedRooms === fewest)).id;
      const path = [];
      for (let c = end; c !== -1 && !own(c); c = parent.get(c)) path.push(c);
      const doorEdges = topo.neighbors(end).filter(m => isLinkedRoomCell(m.id)).map(m => [end, m.id]);
      return { path, doorEdges };
    }
    frontier = next;
  }
  return null;
}

/** Caminho mais curto (A*) evitando células bloqueadas. */
function aStarPath(topo, from, to, blocked) {
  const g = new Map([[from, 0]]);
  const came = new Map();
  const open = [{ id: from, f: topo.distance(from, to) }];
  const closed = new Set();
  while (open.length) {
    open.sort((p, q) => p.f - q.f);
    const { id: cur } = open.shift();
    if (cur === to) {
      const path = [cur];
      while (came.has(path[0])) path.unshift(came.get(path[0]));
      return path;
    }
    if (closed.has(cur)) continue;
    closed.add(cur);
    for (const n of topo.neighbors(cur)) {
      if (n.id < 0 || closed.has(n.id) || (blocked.has(n.id) && n.id !== to)) continue;
      const ng = g.get(cur) + 1;
      if (ng >= (g.get(n.id) ?? Infinity)) continue;
      g.set(n.id, ng);
      came.set(n.id, cur);
      open.push({ id: n.id, f: ng + topo.distance(n.id, to) });
    }
  }
  return null;
}

/** Corredor em "L" no quadrado. firstAxis força o primeiro trecho ("i" = vertical, "j" = horizontal). */
function squarePath(topo, from, to, rng, firstAxis) {
  let { i, j } = topo.ij(from);
  const t = topo.ij(to);
  const path = [from];
  const stepJ = () => { while (j !== t.j) { j += Math.sign(t.j - j); path.push(topo.id(i, j)); } };
  const stepI = () => { while (i !== t.i) { i += Math.sign(t.i - i); path.push(topo.id(i, j)); } };
  const horizontalFirst = firstAxis ? firstAxis === "j" : rng.chance(0.5);
  if (horizontalFirst) { stepJ(); stepI(); } else { stepI(); stepJ(); }
  return path;
}

/** Corredor no hexágono: anda sempre para o vizinho mais próximo do destino (linha reta de hexes). */
function hexPath(topo, from, to, rng) {
  const path = [from];
  let cur = from;
  for (let guard = 0; cur !== to && guard < topo.count; guard++) {
    let best = null, bestD = Infinity;
    for (const n of topo.neighbors(cur)) {
      if (n.id < 0) continue;
      const d = topo.distance(n.id, to) + rng.next() * 1e-3; // desempate aleatório
      if (d < bestD) { bestD = d; best = n.id; }
    }
    if (best === null) break;
    cur = best;
    path.push(cur);
  }
  return path;
}

/**
 * Com as arestas da porta fechadas, ainda dá para chegar ao outro lado andando por perto?
 * Se não dá, a porta realmente bloqueia a passagem.
 */
export function blocksLocally(topo, isFloor, start, closed, edgeKey, reaches, maxDepth) {
  const seen = new Set([start]);
  let frontier = [start];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    for (const c of frontier) {
      for (const n of topo.neighbors(c)) {
        if (!isFloor(n.id) || seen.has(n.id) || closed.has(edgeKey(c, n.id))) continue;
        if (reaches(n.id)) return false;
        seen.add(n.id);
        next.push(n.id);
      }
    }
    frontier = next;
  }
  return true;
}

/**
 * Alarga um corredor: para cada célula do caminho, adiciona vizinhos para os lados
 * (perpendicular à direção do caminho). Largura 2 = um lado; 3 = os dois lados.
 */
function widenPath(topo, path, width, blocked) {
  if (width <= 1 || path.length < 2) return [];
  const sides = width === 2 ? [1] : [1, -1];
  const extra = [];
  const allowed = id => {
    if (id < 0 || blocked.has(id)) return false;
    const { i, j } = topo.ij(id);
    return i > 0 && j > 0 && i < topo.rows - 1 && j < topo.cols - 1; // borda do mapa fica rocha
  };
  for (let k = 0; k < path.length; k++) {
    const p = topo.center(path[Math.max(0, k - 1)]);
    const q = topo.center(path[Math.min(path.length - 1, k + 1)]);
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (!len) continue;
    const px = -(q.y - p.y) / len, py = (q.x - p.x) / len; // perpendicular
    const c = topo.center(path[k]);
    for (const side of sides) {
      const tx = c.x + px * side * topo.size, ty = c.y + py * side * topo.size;
      let best = null, bestD = Infinity;
      for (const n of topo.neighbors(path[k])) {
        if (n.id < 0) continue;
        const nc = topo.center(n.id);
        const d = Math.hypot(nc.x - tx, nc.y - ty);
        if (d < bestD) { bestD = d; best = n.id; }
      }
      if (best !== null && allowed(best)) extra.push(best);
    }
  }
  return extra;
}

/**
 * Arestas entre o corredor e a sala ao redor da entrada (a "boca" do corredor).
 */
function mouthEdges(topo, cells, roomOf, outer, room, width) {
  const edges = [];
  const seen = new Set([outer]);
  let frontier = [outer];
  for (let depth = 0; depth < width && frontier.length; depth++) {
    const next = [];
    for (const c of frontier) {
      for (const n of topo.neighbors(c)) {
        if (n.id < 0) continue;
        if (roomOf[n.id] === room) edges.push([c, n.id]);
        else if (cells[n.id] === CELL.CORRIDOR && !seen.has(n.id)) { seen.add(n.id); next.push(n.id); }
      }
    }
    frontier = next;
  }
  return edges;
}

/** Desenha a dungeon em texto (para testes no terminal). Hexes deslocados meia célula. */
export function toAscii(d) {
  const topo = d.topology;
  const doorCells = new Set(d.doors.flatMap(o => o.edges.flat()));
  const pads = new Set(d.teleports.flatMap(t => [t.padA, t.padB]));
  let out = "";
  for (let i = 0; i < topo.rows; i++) {
    let line = "";
    for (let j = 0; j < topo.cols; j++) {
      const id = topo.id(i, j);
      const c = d.cells[id];
      line += pads.has(id) ? "T" : doorCells.has(id) && c === CELL.CORRIDOR ? "+" : c === CELL.WALL ? "#" : c === CELL.ROOM ? "." : ",";
    }
    out += line + "\n";
  }
  return out;
}
