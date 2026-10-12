/**
 * Diário da dungeon (JournalEntry com uma página por sala + notas no mapa) e mapa geral
 * de um conjunto de cenas ligadas.
 */
import { roomCells } from "./generator.js";

const MODULE_ID = "gurps-dungeon-creator";
const t = (key, data) => (data ? game.i18n.format(`GDC.Journal.${key}`, data) : game.i18n.localize(`GDC.Journal.${key}`));
const esc = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Descrição de uma sala em HTML (o Mestre completa o resto). */
function roomPage(room, info) {
  const lines = [];
  lines.push(`<p><strong>${t("Size")}:</strong> ${t("SizeValue", { w: room.w, h: room.h, area: info.area })}</p>`);
  if (room.cave) lines.push(`<p>${t("Cave")}</p>`);
  if (info.entrance) lines.push(`<p><strong>${t("Entrance")}</strong></p>`);
  if (room.secret) lines.push(`<p>${t("SecretRoom", { room: room.secretDoorRoom ?? "?" })}</p>`);
  if (room.isolated) lines.push(`<p>${t("TeleportRoom")}</p>`);
  const doorBits = [];
  if (info.doors) doorBits.push(t("DoorsCount", { n: info.doors }));
  if (info.locked) doorBits.push(t("LockedCount", { n: info.locked }));
  if (info.secretDoors) doorBits.push(t("SecretDoorsCount", { n: info.secretDoors }));
  if (doorBits.length) lines.push(`<p><strong>${t("Doors")}:</strong> ${doorBits.join(" · ")}</p>`);
  if (info.pads) lines.push(`<p>${t("Pads", { n: info.pads })}</p>`);
  lines.push(`<p><strong>${t("Light")}:</strong> ${info.light}</p>`);
  lines.push(`<h3>${t("GmNotes")}</h3><p></p>`);
  return lines.join("\n");
}

/** Dados de cada sala (portas, luz, teleportes, entrada) a partir da dungeon. */
function roomInfo(room, dungeon, roomLights) {
  const doorsHere = dungeon.doors.filter(d => d.room === room.id);
  const pads = (dungeon.teleports ?? []).filter(tp => tp.fromRoom === room.id || tp.toRoom === room.id).length;
  const torches = roomLights.filter(l => l.room === room.id && l.kind === "torch").length;
  const brazier = roomLights.some(l => l.room === room.id && l.kind === "brazier");
  return {
    area: roomCells(dungeon.topology, room).length,
    doors: doorsHere.filter(d => !d.secret && !d.locked).length,
    locked: doorsHere.filter(d => !d.secret && d.locked).length,
    secretDoors: doorsHere.filter(d => d.secret).length,
    pads,
    entrance: dungeon.entrance?.room === room.id,
    light: torches ? t("Torches", { n: torches }) : brazier ? t("Brazier") : t("Dark")
  };
}

/** Página de visão geral: armadilhas, portas, saídas. */
function overviewPage(scene, dungeon, links) {
  const trapName = type => game.i18n.localize(`GDC.Trap.${type}.Name`);
  const parts = [`<p>${t("Seed", { seed: esc(dungeon.seed) })}</p>`];
  parts.push(`<p>${t("Summary", {
    rooms: dungeon.rooms.length,
    doors: dungeon.doors.filter(d => !d.secret).length,
    locked: dungeon.doors.filter(d => d.locked).length,
    secret: dungeon.doors.filter(d => d.secret).length
  })}</p>`);
  if (dungeon.traps?.length) {
    parts.push(`<h3>${t("Traps")}</h3><ul>${dungeon.traps.map(tr => `<li>${trapName(tr.type)}</li>`).join("")}</ul>`);
    parts.push(`<p><em>${t("TrapsHint")}</em></p>`);
  }
  if (links?.length) {
    parts.push(`<h3>${t("Exits")}</h3><ul>${links.map(l => `<li>@UUID[Scene.${l.targetSceneId}]{${esc(l.label)}}</li>`).join("")}</ul>`);
  }
  return parts.join("\n");
}

/**
 * Cria o diário da cena e as notas no mapa (só o Mestre vê: o diário não é compartilhado).
 * @param {object} [options] {folderId, onlyRooms: number[] (só estas salas, ao editar a planta), entry}
 * @returns {Promise<JournalEntry>}
 */
export async function buildJournal(scene, dungeon, roomLights, options = {}) {
  const topo = dungeon.topology;
  const levelId = scene.flags[MODULE_ID]?.levelId;
  const only = options.onlyRooms ? new Set(options.onlyRooms) : null;
  const rooms = dungeon.rooms.filter(r => !only || only.has(r.id));

  const pages = [];
  if (!only) pages.push({ name: t("OverviewPage"), type: "text", text: { content: overviewPage(scene, dungeon, options.links) }, sort: 0 });
  rooms.forEach(room => pages.push({
    name: t("RoomName", { n: room.id }),
    type: "text",
    sort: (room.id + 1) * 100,
    text: { content: roomPage(room, roomInfo(room, dungeon, roomLights)) },
    flags: { [MODULE_ID]: { room: room.id } }
  }));

  let entry = options.entry;
  if (entry) await entry.createEmbeddedDocuments("JournalEntryPage", pages);
  else {
    entry = await JournalEntry.create({
      name: t("Name", { name: scene.name }),
      folder: options.folderId ?? null,
      pages,
      flags: { [MODULE_ID]: { scene: scene.id } }
    });
  }

  // Notas no mapa: número da sala no centro, escada na entrada, perigo nas armadilhas
  const pageOf = id => entry.pages.find(p => p.getFlag(MODULE_ID, "room") === id);
  const note = (cell, extra) => {
    const c = topo.hexCenter(cell);
    return {
      entryId: entry.id, x: Math.round(c.x), y: Math.round(c.y), levels: levelId ? [levelId] : [],
      iconSize: 32, fontSize: 24, flags: { [MODULE_ID]: { generated: true } }, ...extra
    };
  };
  const notes = rooms.map(r => note(r.centerCell, {
    pageId: pageOf(r.id)?.id, text: String(r.id), texture: { src: "icons/svg/book.svg" }
  }));
  if (!only) {
    const overview = entry.pages.find(p => !p.getFlag(MODULE_ID, "room"));
    if (dungeon.entrance) {
      notes.push(note(dungeon.entrance.cell, { pageId: pageOf(dungeon.entrance.room)?.id, text: t("Entrance"), texture: { src: "icons/svg/door-exit.svg" } }));
    }
    for (const tr of dungeon.traps ?? []) {
      notes.push(note(tr.cell, { pageId: overview?.id, text: game.i18n.localize(`GDC.Trap.${tr.type}.Name`), texture: { src: "icons/svg/trap.svg" } }));
    }
  }
  if (notes.length) await scene.createEmbeddedDocuments("Note", notes);
  return entry;
}

/**
 * Mapa geral de um conjunto: miniaturas das cenas lado a lado, com as ligações entre elas,
 * numa imagem; e um diário com essa imagem e links para cada parte.
 */
export async function buildOverview({ name, scenes, links, gridCols, folderId, upload }) {
  const thumbW = 520, gap = 40, pad = 30, labelH = 36;
  const images = [];
  for (const scene of scenes) {
    const src = scene.levels.get(scene.flags[MODULE_ID].levelId)?.background?.src;
    const bitmap = await createImageBitmap(await (await fetch(src)).blob());
    images.push({ scene, bitmap, scale: thumbW / bitmap.width });
  }
  const thumbH = Math.max(...images.map(im => im.bitmap.height * im.scale));
  const rows = Math.ceil(scenes.length / gridCols);
  const W = pad * 2 + gridCols * thumbW + (gridCols - 1) * gap;
  const H = pad * 2 + rows * (thumbH + labelH) + (rows - 1) * gap;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#151311";
  ctx.fillRect(0, 0, W, H);

  const origin = k => ({
    x: pad + (k % gridCols) * (thumbW + gap),
    y: pad + Math.floor(k / gridCols) * (thumbH + labelH + gap) + labelH
  });
  images.forEach((im, k) => {
    const o = origin(k);
    ctx.drawImage(im.bitmap, o.x, o.y, thumbW, im.bitmap.height * im.scale);
    ctx.fillStyle = "#e8dcc0";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(im.scene.name, o.x, o.y - 10);
  });

  // Ligações: traço dourado entre as saídas das duas cenas
  ctx.strokeStyle = "#e0b050";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  for (const l of links) {
    const ends = [[l.a, l.exitA], [l.b, l.exitB]].map(([k, exit]) => {
      const o = origin(k), sc = images[k].scale;
      return { x: o.x + exit.x * sc, y: o.y + exit.y * sc };
    });
    ctx.beginPath();
    ctx.moveTo(ends[0].x, ends[0].y);
    ctx.lineTo(ends[1].x, ends[1].y);
    ctx.stroke();
  }

  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  const src = await upload(blob);
  const list = scenes.map(s => `<li>@UUID[Scene.${s.id}]{${esc(s.name)}}</li>`).join("");
  return JournalEntry.create({
    name: t("OverviewName", { name }),
    folder: folderId ?? null,
    pages: [
      { name: t("OverviewMap"), type: "image", src, sort: 0 },
      { name: t("OverviewParts"), type: "text", sort: 100, text: { content: `<ul>${list}</ul>` } }
    ],
    flags: { [MODULE_ID]: { overview: true } }
  });
}
