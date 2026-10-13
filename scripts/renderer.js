/**
 * Desenha a dungeon em uma imagem (OffscreenCanvas → Blob webp).
 * Funciona para quadrado e hexágono: cada célula é desenhada pelo seu polígono.
 * Sem texturas configuradas, tudo é procedural (cores + ruído).
 */
import { CELL } from "./generator.js";
import { RNG } from "./rng.js";

const COLORS = {
  rock: "#2b2824",
  rockSpeck: ["#24211e", "#34302b", "#3a352f"],
  floor: ["#a89c86", "#b0a48d", "#a39780", "#ad9f88"],
  seam: "rgba(60, 50, 40, 0.35)",
  wallLine: "#141210",
  door: "#6b4423",
  doorEdge: "#2a1a0c"
};

async function loadPattern(ctx, src) {
  if (!src) return null;
  try {
    const blob = await (await fetch(src)).blob();
    const bitmap = await createImageBitmap(blob);
    return ctx.createPattern(bitmap, "repeat");
  } catch (err) {
    console.warn(`gurps-dungeon-creator | Não consegui carregar a textura ${src}`, err);
    return null;
  }
}

function polygon(path, verts) {
  path.moveTo(verts[0].x, verts[0].y);
  for (let k = 1; k < verts.length; k++) path.lineTo(verts[k].x, verts[k].y);
  path.closePath();
}

/**
 * @param {object} d      Resultado de generateDungeon
 * @param {object} segs   Resultado de buildWallSegments (pixels)
 * @returns {Promise<Blob>}
 */
export async function renderDungeon(d, segs, { floorTexture, rockTexture, lights, exits } = {}) {
  const topo = d.topology;
  const S = topo.size;
  const W = topo.width, H = topo.height;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const rng = new RNG(`${d.seed}:render`);

  const floorPattern = await loadPattern(ctx, floorTexture);
  const rockPattern = await loadPattern(ctx, rockTexture);

  const floorIds = [];
  for (let id = 0; id < topo.count; id++) if (d.cells[id] !== CELL.WALL) floorIds.push(id);

  // 1. Rocha em toda a imagem ------------------------------------------------
  ctx.fillStyle = rockPattern ?? COLORS.rock;
  ctx.fillRect(0, 0, W, H);
  if (!rockPattern) {
    const specks = Math.floor((W * H) / (S * S) * 6);
    for (let k = 0; k < specks; k++) {
      ctx.fillStyle = rng.pick(COLORS.rockSpeck);
      ctx.beginPath();
      ctx.arc(rng.next() * W, rng.next() * H, S * (0.03 + rng.next() * 0.08), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 2. Chão ------------------------------------------------------------------
  //    floorPath = a planta (hexes, quadrados ou caixas retas, conforme o estilo).
  //    As lajotas seguem sempre a grade da cena e são recortadas pela planta.
  const floorPath = new Path2D();
  for (const id of floorIds) polygon(floorPath, topo.vertices(id));
  ctx.save();
  ctx.clip(floorPath);
  if (floorPattern) {
    ctx.fillStyle = floorPattern;
    ctx.fillRect(0, 0, W, H);
  } else {
    const seams = new Path2D();
    for (let id = 0; id < topo.count; id++) {
      const tile = new Path2D();
      polygon(tile, topo.outline(id));
      ctx.fillStyle = rng.pick(COLORS.floor);
      ctx.fill(tile);
      polygon(seams, topo.outline(id));
    }
    ctx.strokeStyle = COLORS.seam;
    ctx.lineWidth = Math.max(1, S * 0.025);
    ctx.stroke(seams);
  }
  ctx.restore();

  // 3. Sombra das paredes sobre o chão --------------------------------------
  ctx.save();
  ctx.clip(floorPath);
  const rockFrame = new Path2D();
  rockFrame.rect(-S, -S, W + 2 * S, H + 2 * S);
  rockFrame.addPath(floorPath);
  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
  ctx.shadowBlur = S * 0.35;
  ctx.fillStyle = "#000";
  ctx.fill(rockFrame, "evenodd"); // só a sombra cai dentro do recorte do chão
  ctx.restore();

  // 4. Contorno das paredes ---------------------------------------------------
  ctx.strokeStyle = COLORS.wallLine;
  ctx.lineWidth = S * 0.1;
  ctx.lineCap = topo.isStraight ? "square" : "round";
  ctx.beginPath();
  // Portas secretas são desenhadas como parede comum: a imagem não entrega o segredo
  for (const [x1, y1, x2, y2] of [...segs.walls, ...(segs.secretDoors ?? [])]) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();

  // 5. Portas (retângulo de madeira ao longo da aresta) ----------------------
  const locked = new Set((segs.lockedDoors ?? []).map(s => s.join(",")));
  for (const [x1, y1, x2, y2] of [...segs.doors, ...(segs.lockedDoors ?? [])]) {
    const len = Math.hypot(x2 - x1, y2 - y1) * 0.9;
    const thick = S * 0.22;
    ctx.save();
    ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
    ctx.rotate(Math.atan2(y2 - y1, x2 - x1));
    ctx.fillStyle = COLORS.door;
    ctx.fillRect(-len / 2, -thick / 2, len, thick);
    ctx.strokeStyle = COLORS.doorEdge;
    ctx.lineWidth = S * 0.04;
    ctx.strokeRect(-len / 2, -thick / 2, len, thick);
    if (locked.has([x1, y1, x2, y2].join(","))) {
      // Porta trancada: duas faixas de ferro e o buraco da fechadura
      ctx.fillStyle = "#2b2b2e";
      for (const at of [-0.3, 0.3]) ctx.fillRect(at * len - S * 0.03, -thick / 2, S * 0.06, thick);
      ctx.fillStyle = "#c9a227";
      ctx.beginPath();
      ctx.arc(0, 0, S * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 5b. Saídas para outras cenas: corredor escurecendo até a borda + setas -----
  for (const ex of exits ?? []) drawExit(ctx, topo, ex, S);

  // 6. Tochas e braseiros ------------------------------------------------------
  for (const light of lights ?? []) {
    if (light.kind === "torch") drawTorch(ctx, light, S);
    else drawBrazier(ctx, light, S);
  }

  // 6a. Pilastras: coluna de pedra redonda sobre o hex (só se ainda for rocha após edições)
  for (const p of d.pillars ?? []) if (d.cells[p.cell] === CELL.WALL) drawPillar(ctx, topo.hexCenter(p.cell), S);

  // 6b. Escada de entrada ------------------------------------------------------
  if (d.entrance) drawStairs(ctx, topo, d.entrance, S);

  // 7. Círculos de teleporte ---------------------------------------------------
  for (const t of d.teleports ?? []) {
    for (const pad of [t.padA, t.padB]) drawRuneCircle(ctx, topo.hexCenter(pad), S * 0.42, rng);
  }

  return canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
}

const SIDE_DIR = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] };

/** Saída de cena: a célula escurece em direção à borda, com duas setas apontando para fora. */
function drawExit(ctx, topo, { cell, side }, S) {
  const [dx, dy] = SIDE_DIR[side];
  const c = topo.hexCenter(cell);
  const area = new Path2D();
  polygon(area, topo.vertices(cell));
  ctx.save();
  ctx.clip(area);
  const grad = ctx.createLinearGradient(c.x - dx * S * 0.6, c.y - dy * S * 0.6, c.x + dx * S * 0.6, c.y + dy * S * 0.6);
  grad.addColorStop(0, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0.85)");
  ctx.fillStyle = grad;
  ctx.fillRect(c.x - S, c.y - S, S * 2, S * 2);
  ctx.restore();

  // Setas (chevrons) apontando para a borda
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(Math.atan2(dy, dx));
  ctx.strokeStyle = "rgba(235, 220, 180, 0.8)";
  ctx.lineWidth = S * 0.06;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const off of [-0.14, 0.08]) {
    ctx.beginPath();
    ctx.moveTo((off - 0.08) * S, -0.14 * S);
    ctx.lineTo((off + 0.06) * S, 0);
    ctx.lineTo((off - 0.08) * S, 0.14 * S);
    ctx.stroke();
  }
  ctx.restore();
}

/** Pilastra: coluna de pedra vista de cima, com sombra no chão. */
function drawPillar(ctx, { x, y }, S) {
  const r = S * 0.38;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.beginPath();
  ctx.arc(x + S * 0.06, y + S * 0.08, r * 1.08, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "#9a948a");
  g.addColorStop(1, "#4d4842");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1e1b18";
  ctx.lineWidth = S * 0.06;
  ctx.stroke();
  ctx.strokeStyle = "rgba(30, 27, 24, 0.5)";
  ctx.lineWidth = S * 0.025;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Escada de entrada: degraus saindo da parede para dentro da sala, cada vez mais claros. */
function drawStairs(ctx, topo, { cell, edge }, S) {
  const c = topo.hexCenter(cell);
  let mx = c.x, my = c.y - S * 0.4;
  if (edge) { mx = (edge[0] + edge[2]) / 2; my = (edge[1] + edge[3]) / 2; }
  const len = Math.hypot(c.x - mx, c.y - my) || 1;
  const nx = (c.x - mx) / len, ny = (c.y - my) / len;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(Math.atan2(ny, nx));
  const steps = 4, depth = S * 0.16, width = S * 0.75;
  for (let k = 0; k < steps; k++) {
    const shade = 70 + k * 30;
    ctx.fillStyle = `rgb(${shade}, ${shade - 8}, ${shade - 18})`;
    ctx.fillRect(k * depth, -width / 2, depth, width);
    ctx.strokeStyle = "rgba(20, 15, 10, 0.8)";
    ctx.lineWidth = S * 0.025;
    ctx.strokeRect(k * depth, -width / 2, depth, width);
  }
  ctx.restore();
}

/** Chama: brilho laranja com miolo amarelo. */
function drawFlame(ctx, x, y, r) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
  glow.addColorStop(0, "rgba(255, 170, 60, 0.55)");
  glow.addColorStop(1, "rgba(255, 140, 40, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff8a2a";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffd966";
  ctx.beginPath();
  ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Tocha de parede: suporte de ferro saindo da parede + chama. */
function drawTorch(ctx, { x, y, nx, ny }, S) {
  const wallX = x - nx * S * 0.2, wallY = y - ny * S * 0.2;
  ctx.save();
  ctx.strokeStyle = "#1c1915";
  ctx.lineCap = "round";
  ctx.lineWidth = S * 0.07;
  ctx.beginPath();
  ctx.moveTo(wallX, wallY);
  ctx.lineTo(x, y);
  ctx.stroke();
  // Placa presa na parede
  ctx.translate(wallX, wallY);
  ctx.rotate(Math.atan2(ny, nx));
  ctx.fillStyle = "#2a2520";
  ctx.fillRect(-S * 0.04, -S * 0.12, S * 0.08, S * 0.24);
  ctx.restore();
  drawFlame(ctx, x, y, S * 0.09);
}

/** Braseiro no centro da sala: bacia de ferro com brasas. */
function drawBrazier(ctx, { x, y }, S) {
  ctx.save();
  ctx.fillStyle = "#2a2520";
  ctx.beginPath();
  ctx.arc(x, y, S * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5a2a12";
  ctx.beginPath();
  ctx.arc(x, y, S * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawFlame(ctx, x, y, S * 0.13);
}

/** Círculo arcano: brilho, dois anéis e marcas de runa ao redor. */
function drawRuneCircle(ctx, { x, y }, radius, rng) {
  ctx.save();
  ctx.translate(x, y);

  const glow = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius * 1.2);
  glow.addColorStop(0, "rgba(120, 200, 255, 0.55)");
  glow.addColorStop(1, "rgba(120, 200, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#5fb4ff";
  ctx.shadowColor = "#5fb4ff";
  ctx.shadowBlur = radius * 0.3;
  ctx.lineWidth = radius * 0.08;
  for (const r of [radius, radius * 0.72]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Runas: tracinhos entre os dois anéis
  ctx.lineWidth = radius * 0.06;
  const marks = 12;
  const spin = rng.next() * Math.PI;
  for (let k = 0; k < marks; k++) {
    const a = spin + (k / marks) * Math.PI * 2;
    const r0 = radius * 0.78, r1 = radius * 0.94;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a + 0.12) * r1, Math.sin(a + 0.12) * r1);
    ctx.stroke();
  }

  // Estrela de 6 pontas no meio
  ctx.lineWidth = radius * 0.05;
  for (const offset of [0, Math.PI / 3]) {
    ctx.beginPath();
    for (let k = 0; k <= 3; k++) {
      const a = offset + (k / 3) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * radius * 0.6, py = Math.sin(a) * radius * 0.6;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}
