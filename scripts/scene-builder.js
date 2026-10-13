/**
 * Monta as cenas no Foundry v14: imagem de fundo (no Level), paredes, portas, luzes,
 * teleportes, armadilhas, entrada e diário.
 *
 *  planDungeon()        → gera a dungeon em memória (não toca no Foundry)
 *  buildScene()         → cria uma cena nova a partir de um plano
 *  populateScene()      → preenche uma cena com o conteúdo de um plano (usado por criar e regerar)
 *  regenerateScene()    → troca a dungeon de uma cena existente por uma nova seed
 *  applyEditedPlan()    → aplica a planta pintada no editor
 *  createDungeonScene() → uma cena avulsa
 *  createDungeonSet()   → várias cenas numa pasta, ligadas por corredores que saem pela borda
 */
import { generateDungeon } from "./generator.js";
import { createTopology, createGrid } from "./topology.js";
import { buildWallSegments } from "./walls.js";
import { renderDungeon } from "./renderer.js";
import { placeLights } from "./lights.js";
import { randomSeed } from "./rng.js";
import { planLinkedSet } from "./set-planner.js";
import { encodeCells, decodeCells } from "./plan-edit.js";
import { buildJournal, buildOverview } from "./journal.js";
import { findAssetPack } from "./assets.js";

/** Pacote de assets da pasta configurada (vazio se não houver). */
const assetPack = () => findAssetPack(game.settings.get(MODULE_ID, "assetFolder"));

export const MODULE_ID = "gurps-dungeon-creator";

/** Pasta (dentro de Data) onde as imagens geradas são salvas. */
function uploadFolder() {
  return `worlds/${game.world.id}/${MODULE_ID}`;
}

async function uploadImage(blob, filename) {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  const folder = uploadFolder();
  try {
    await FilePicker.createDirectory("data", folder, { notify: false });
  } catch (err) {
    // A pasta já existe — tudo certo
  }
  const file = new File([blob], filename, { type: "image/webp" });
  const result = await FilePicker.upload("data", folder, file, {}, { notify: false });
  if (!result?.path) throw new Error("Falha no upload da imagem da dungeon.");
  return result.path;
}

/** Nome de arquivo único (o navegador não reaproveita uma imagem antiga em cache). */
const imageName = (name, seed) => `${name.slugify({ strict: true }) || "dungeon"}-${seed}-${Date.now().toString(36)}.webp`;

/**
 * Gera a dungeon em memória.
 * @param {object} options  Opções do gerador (inclusive exits) + {cellSize, gridType, wallStyle, width, height}
 */
export function planDungeon(options = {}) {
  const cellSize = Number(options.cellSize) || 100;
  const gridType = Number(options.gridType ?? CONST.GRID_TYPES.HEXODDQ);
  const wallStyle = options.wallStyle ?? "straight";
  const grid = createGrid(gridType, cellSize, foundry.grid);
  const topo = createTopology(grid, Number(options.width) || 50, Number(options.height) || 36, wallStyle);
  const dungeon = generateDungeon(topo, options);
  if (dungeon.rooms.length < 2) {
    throw new Error("Não coube nenhuma sala. Aumente o mapa ou diminua o tamanho das salas.");
  }
  return { topo, dungeon, cellSize, gridType, wallStyle };
}

/* -------------------------------------------- */
/*  Documentos do Foundry                       */
/* -------------------------------------------- */

/** Paredes, portas (comuns, trancadas e secretas), marcadas como geradas pelo módulo. */
function wallDocuments(segs, levelId, assets = {}) {
  const toPx = c => c.map(v => Math.round(v));
  const flags = { [MODULE_ID]: { generated: true } };
  // A porta dos assets vai pintada no fundo (sempre visível); abrir/fechar fica no ícone do Foundry
  const animation = {};
  return [
    ...segs.walls.map(c => ({ c: toPx(c), levels: [levelId], flags })),
    ...segs.doors.map(c => ({
      c: toPx(c), levels: [levelId], flags, ...animation,
      door: CONST.WALL_DOOR_TYPES.DOOR,
      ds: CONST.WALL_DOOR_STATES.CLOSED
    })),
    // Porta trancada: abre só depois que o Mestre destrancar
    ...(segs.lockedDoors ?? []).map(c => ({
      c: toPx(c), levels: [levelId], flags, ...animation,
      door: CONST.WALL_DOOR_TYPES.DOOR,
      ds: CONST.WALL_DOOR_STATES.LOCKED
    })),
    // Porta secreta do Foundry: jogadores veem parede até o Mestre revelar
    ...segs.secretDoors.map(c => ({
      c: toPx(c), levels: [levelId], flags,
      door: CONST.WALL_DOOR_TYPES.SECRET,
      ds: CONST.WALL_DOOR_STATES.CLOSED
    }))
  ];
}

/** Tochas e braseiros. */
function lightDocuments(roomLights, levelId, distance) {
  return roomLights.map(l => {
    const dim = l.radius * distance;
    return {
      x: Math.round(l.x),
      y: Math.round(l.y),
      levels: [levelId],
      flags: { [MODULE_ID]: { kind: l.kind, room: l.room } },
      config: {
        dim,
        bright: dim * (l.kind === "torch" ? 0.4 : 0.5),
        color: "#ff9b42",
        alpha: 0.35,
        animation: { type: "torch", speed: 3, intensity: 3 }
      }
    };
  });
}

/** Região de 1 hex com teleporte para outra região (na mesma cena ou em outra). */
function teleportRegion(topo, levelId, { id, cell, label, color, destination, flags, confirm }) {
  const { i, j } = topo.ij(cell);
  return {
    _id: id,
    name: label,
    color,
    shapes: [{ type: "grid", offsets: [{ i, j }] }],
    levels: [levelId],
    visibility: CONST.REGION_VISIBILITY.LAYER,
    flags: { [MODULE_ID]: flags },
    behaviors: [{
      type: "teleportToken",
      name: label,
      system: { destinations: [destination], placement: "center", snap: true, choice: !!confirm }
    }]
  };
}

/**
 * Armadilha: região de 1 hex, visível só para o Mestre. Quando um token entra, o Mestre
 * ativo manda no chat a descrição com os testes do GURPS (o Game Aid transforma [Per-2],
 * [2d cut]... em botões clicáveis) e a armadilha se desliga (o Mestre pode religar).
 */
function trapRegion(topo, levelId, trap) {
  const { i, j } = topo.ij(trap.cell);
  const name = game.i18n.localize(`GDC.Trap.${trap.type}.Name`);
  const html = `<h3>${game.i18n.format("GDC.Trap.Triggered", { name })}</h3>${game.i18n.localize(`GDC.Trap.${trap.type}.Effect`)}`;
  const source = [
    "if (!game.user.isActiveGM) return;",
    "const who = String(event.data.token?.name ?? '?').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);",
    `await ChatMessage.create({ speaker: { alias: ${JSON.stringify(name)} }, content: ${JSON.stringify(html)}.replaceAll("{token}", who) });`,
    "await behavior.update({ disabled: true });"
  ].join("\n");
  return {
    name: game.i18n.format("GDC.Trap.Triggered", { name }),
    color: "#d03030",
    shapes: [{ type: "grid", offsets: [{ i, j }] }],
    levels: [levelId],
    visibility: CONST.REGION_VISIBILITY.LAYER, // só aparece com a ferramenta Regions ativa
    flags: { [MODULE_ID]: { trap } },
    behaviors: [{ type: "executeScript", name, system: { events: [CONST.REGION_EVENTS.TOKEN_MOVE_IN], source } }]
  };
}

/** O que fica guardado na cena para poder editar/regerar depois. */
function dungeonFlags(dungeon, topo) {
  return {
    seed: dungeon.seed,
    options: dungeon.options,
    rooms: dungeon.rooms.map(({ isNew, ...r }) => ({ ...r, center: topo.hexCenter(r.centerCell) })),
    doors: dungeon.doors.map(d => ({ room: d.room, cells: d.edges, secret: !!d.secret, locked: !!d.locked, secretRoom: d.secretRoom })),
    teleports: dungeon.teleports,
    traps: dungeon.traps ?? [],
    pillars: dungeon.pillars ?? [],
    entrance: dungeon.entrance ?? null
  };
}

/* -------------------------------------------- */
/*  Criar, preencher, limpar                    */
/* -------------------------------------------- */

/**
 * Preenche uma cena (já criada, com um Level) com tudo o que o plano define.
 * @param {object} options  {links, createExitRegions, lightChance, lightPlacement, floorTexture, rockTexture,
 *                           teleportConfirm, journal, journalFolderId, placeParty}
 */
export async function populateScene(scene, plan, options = {}) {
  const { topo, dungeon } = plan;
  const levelId = scene.flags[MODULE_ID].levelId;
  const links = options.links ?? [];
  const activeExits = dungeon.exits.filter(ex => links.some(l => l.exitId === ex.id));
  const segs = buildWallSegments(dungeon, { openExits: activeExits.map(ex => ex.cell) });
  const roomLights = placeLights(dungeon, {
    lightChance: Number(options.lightChance ?? 0.6),
    placement: options.lightPlacement ?? "wall"
  });
  const assets = await assetPack();

  // 1. Imagem
  const blob = await renderDungeon(dungeon, segs, {
    floorTexture: options.floorTexture,
    rockTexture: options.rockTexture,
    lights: roomLights,
    exits: activeExits,
    assets
  });
  const src = await uploadImage(blob, imageName(scene.name, dungeon.seed));
  await scene.updateEmbeddedDocuments("Level", [{ _id: levelId, "background.src": src }]);

  // 2. Paredes, portas e luzes
  await scene.createEmbeddedDocuments("Wall", wallDocuments(segs, levelId, assets));

  const distance = scene.grid.distance;
  const lights = lightDocuments(roomLights, levelId, distance);

  // 3. Regiões: círculos de teleporte, armadilhas e saídas para outras cenas
  const regionData = [];
  for (const t of dungeon.teleports) {
    const idA = foundry.utils.randomID(), idB = foundry.utils.randomID();
    for (const [id, cell, otherId, from, to] of [[idA, t.padA, idB, t.fromRoom, t.toRoom], [idB, t.padB, idA, t.toRoom, t.fromRoom]]) {
      const c = topo.hexCenter(cell);
      lights.push({
        x: Math.round(c.x), y: Math.round(c.y), levels: [levelId],
        flags: { [MODULE_ID]: { kind: "pad" } },
        config: { dim: distance * 1.5, bright: distance * 0.5, color: "#5fb4ff", alpha: 0.5,
          animation: { type: "pulse", speed: 2, intensity: 3 } }
      });
      regionData.push(teleportRegion(topo, levelId, {
        id, cell, color: "#5fb4ff", confirm: options.teleportConfirm,
        label: game.i18n.format("GDC.Teleport.Name", { from, to }),
        destination: `Scene.${scene.id}.Region.${otherId}`,
        flags: { teleport: t }
      }));
    }
  }
  for (const trap of dungeon.traps ?? []) regionData.push(trapRegion(topo, levelId, trap));
  for (const ex of activeExits) {
    const link = links.find(l => l.exitId === ex.id);
    const { i, j } = topo.ij(ex.cell);
    const existing = scene.regions.get(link.regionId);
    if (existing) {
      // Regerando: a saída continua ligada à cena vizinha, só muda de hex
      await existing.update({ shapes: [{ type: "grid", offsets: [{ i, j }] }], [`flags.${MODULE_ID}.exit`]: { ...ex, ...link } });
      continue;
    }
    regionData.push(teleportRegion(topo, levelId, {
      id: link.regionId, cell: ex.cell, color: "#e0b050", confirm: options.teleportConfirm,
      label: link.label,
      destination: `Scene.${link.targetSceneId}.Region.${link.targetRegionId}`,
      flags: { exit: { ...ex, ...link } }
    }));
  }
  if (lights.length) await scene.createEmbeddedDocuments("AmbientLight", lights);
  if (regionData.length) await scene.createEmbeddedDocuments("Region", regionData, { keepId: true });

  // 4. O que a cena precisa lembrar
  const entrancePoint = dungeon.entrance ? topo.hexCenter(dungeon.entrance.cell) : null;
  await scene.update({
    [`flags.${MODULE_ID}`]: {
      ...dungeonFlags(dungeon, topo),
      cells: null,
      exits: activeExits.map(ex => ({ ...ex, ...links.find(l => l.exitId === ex.id) }))
    },
    ...(entrancePoint ? { initial: { x: Math.round(entrancePoint.x), y: Math.round(entrancePoint.y), scale: 0.8 } } : {})
  });

  // 5. Diário com as salas e notas no mapa
  if (options.journal !== false) {
    const entry = await buildJournal(scene, dungeon, roomLights, { folderId: options.journalFolderId, links });
    await scene.update({ journal: entry.id, [`flags.${MODULE_ID}.journalId`]: entry.id });
  }

  // 6. Personagens dos jogadores na entrada
  if (options.placeParty && dungeon.entrance) await placeParty(scene, plan, levelId);

  return { segs, lights: lights.length };
}

/** Coloca o personagem de cada jogador num hex livre perto da escada de entrada. */
async function placeParty(scene, plan, levelId) {
  const { topo, dungeon } = plan;
  const actors = [...new Set(game.users.filter(u => !u.isGM && u.character).map(u => u.character))];
  if (!actors.length) return;
  const room = dungeon.rooms.find(r => r.id === dungeon.entrance.room);
  const pads = new Set(dungeon.teleports.flatMap(t => [t.padA, t.padB]));
  const spots = (room.cells ?? []).length ? [...room.cells] : [];
  if (!spots.length) {
    for (let i = room.y; i < room.y + room.h; i++) for (let j = room.x; j < room.x + room.w; j++) spots.push(topo.id(i, j));
  }
  spots.sort((a, b) => topo.distance(a, dungeon.entrance.cell) - topo.distance(b, dungeon.entrance.cell));
  const free = spots.filter(c => !pads.has(c));
  const tokens = [];
  for (const [k, actor] of actors.entries()) {
    const cell = free[k];
    if (cell === undefined) break;
    const pt = scene.grid.getTopLeftPoint(topo.ij(cell));
    const doc = await actor.getTokenDocument({ x: Math.round(pt.x), y: Math.round(pt.y), level: levelId });
    tokens.push(doc.toObject());
  }
  if (tokens.length) await scene.createEmbeddedDocuments("Token", tokens);
}

/**
 * Cria uma cena nova a partir de um plano.
 * @param {object} options  {name, darkness, view, quiet, sceneId, folderId, set, ...populateScene}
 * @returns {Promise<Scene>}
 */
export async function buildScene(plan, options = {}) {
  const { topo, dungeon, cellSize, gridType, wallStyle } = plan;
  const name = options.name?.trim() || `Dungeon ${dungeon.seed}`;
  const levelId = foundry.utils.randomID();
  const sysGrid = game.system.grid ?? {};
  const sceneData = {
    name,
    width: topo.width,
    height: topo.height,
    padding: 0,
    folder: options.folderId ?? null,
    grid: { type: gridType, size: cellSize, distance: sysGrid.distance ?? 1, units: sysGrid.units ?? "" },
    tokenVision: true,
    environment: { darknessLevel: Number(options.darkness ?? 0.8), globalLight: { enabled: false } },
    levels: [{ _id: levelId, name: game.i18n.localize("GDC.LevelName"), background: { color: "#000000" } }],
    initialLevel: levelId,
    flags: { [MODULE_ID]: { levelId, cellSize, gridType, wallStyle, set: options.set ?? null } }
  };
  if (options.sceneId) sceneData._id = options.sceneId;
  const scene = await Scene.create(sceneData, { keepId: !!options.sceneId });
  const { segs, lights } = await populateScene(scene, plan, options);

  if (options.view !== false) await scene.view();
  if (!options.quiet) {
    ui.notifications.info(game.i18n.format("GDC.Created", {
      name, rooms: dungeon.rooms.length, doors: segs.doors.length + segs.lockedDoors.length,
      secret: segs.secretDoors.length, lights, traps: (dungeon.traps ?? []).length, seed: dungeon.seed
    }));
  }
  return scene;
}

/**
 * Apaga o que o módulo criou na cena (para regerar). Mantém tokens, paredes feitas à mão
 * (exceto em cenas antigas, sem a marca) e as saídas para outras cenas.
 */
async function clearGenerated(scene) {
  const f = scene.flags[MODULE_ID];
  const flag = (doc, key) => doc.getFlag(MODULE_ID, key);
  const generated = scene.walls.filter(w => flag(w, "generated"));
  const walls = generated.length ? generated : scene.walls.filter(w => !w.levels.size || w.levels.has(f.levelId));
  if (walls.length) await scene.deleteEmbeddedDocuments("Wall", walls.map(w => w.id));
  const lights = scene.lights.filter(l => flag(l, "kind"));
  if (lights.length) await scene.deleteEmbeddedDocuments("AmbientLight", lights.map(l => l.id));
  const regions = scene.regions.filter(r => flag(r, "teleport") || flag(r, "trap"));
  if (regions.length) await scene.deleteEmbeddedDocuments("Region", regions.map(r => r.id));
  const notes = scene.notes.filter(n => flag(n, "generated"));
  if (notes.length) await scene.deleteEmbeddedDocuments("Note", notes.map(n => n.id));
  const tiles = scene.tiles.filter(t => flag(t, "furniture")); // mesas de versões anteriores
  if (tiles.length) await scene.deleteEmbeddedDocuments("Tile", tiles.map(t => t.id));
  const journal = game.journal.get(f.journalId);
  const journalFolderId = journal?.folder?.id ?? null;
  if (journal) await journal.delete();
  return { journalFolderId };
}

/**
 * Troca a dungeon de uma cena por outra, com uma seed nova e as mesmas opções.
 * As saídas para cenas vizinhas continuam funcionando (mudam só de hex, no mesmo lado).
 */
export async function regenerateScene(scene, options = {}) {
  if (!game.user.isGM) throw new Error("Só o Mestre pode gerar dungeons.");
  const f = scene.flags?.[MODULE_ID];
  if (!f?.seed || !f.options) throw new Error(game.i18n.localize("GDC.Editor.NotGenerated"));
  const links = (f.exits ?? []).filter(ex => ex.regionId);
  const wanted = (f.options.exits ?? []).filter(ex => links.some(l => l.exitId === ex.id));

  // Tenta seeds até todas as saídas ligadas caberem
  let plan;
  for (let attempt = 0; attempt < 8; attempt++) {
    plan = planDungeon({
      ...f.options, seed: randomSeed(), exits: wanted, pillars: f.options.pillars ?? false,
      gridType: f.gridType, wallStyle: f.wallStyle ?? "grid", cellSize: f.cellSize
    });
    if (wanted.every(ex => plan.dungeon.exits.some(e => e.id === ex.id))) break;
  }

  const { journalFolderId } = await clearGenerated(scene);
  const saved = game.settings.get(MODULE_ID, "lastOptions") ?? {};
  await populateScene(scene, plan, {
    ...saved,
    ...options,
    links: links.map(({ exitId, regionId, targetSceneId, targetRegionId, label }) => ({ exitId, regionId, targetSceneId, targetRegionId, label })),
    journalFolderId,
    lightChance: f.options.lightChance ?? saved.lightChance,
    floorTexture: game.settings.get(MODULE_ID, "floorTexture"),
    rockTexture: game.settings.get(MODULE_ID, "rockTexture")
  });
  return plan.dungeon.seed;
}

/* -------------------------------------------- */
/*  Editor da planta                            */
/* -------------------------------------------- */

/**
 * Reconstrói a planta de uma cena gerada pelo módulo.
 * Se a cena já foi editada, usa as células guardadas; senão, gera de novo pela seed
 * e confere se bate com o que foi salvo na criação.
 * @returns {{topo, dungeon, cellSize, gridType, wallStyle}}
 */
export function loadScenePlan(scene) {
  const f = scene.flags?.[MODULE_ID];
  if (!f?.seed || !f.options) throw new Error(game.i18n.localize("GDC.Editor.NotGenerated"));
  const plan = planDungeon({
    ...f.options, seed: f.seed, gridType: f.gridType, wallStyle: f.wallStyle ?? "grid", cellSize: f.cellSize,
    pillars: f.options.pillars ?? false // cenas de antes das pilastras continuam sem elas
  });
  const d = plan.dungeon;

  if (f.cells) {
    d.cells = decodeCells(f.cells);
    d.rooms = f.rooms.map(({ center, ...r }) => r);
    d.doors = f.doors.map(o => ({ edges: o.cells, room: o.room, secret: o.secret, locked: o.locked, secretRoom: o.secretRoom }));
  } else {
    const same = d.rooms.length === f.rooms.length
      && d.rooms.every((r, k) => r.x === f.rooms[k].x && r.y === f.rooms[k].y && r.w === f.rooms[k].w && r.h === f.rooms[k].h);
    if (!same) throw new Error(game.i18n.localize("GDC.Editor.OldVersion"));
  }
  d.teleports = f.teleports ?? d.teleports;
  d.traps = f.traps ?? d.traps;
  d.entrance = f.entrance ?? d.entrance;
  d.pillars = f.pillars ?? d.pillars;
  d.exits = (f.exits ?? []).map(({ id, side, cell }) => ({ id, side, cell }));
  return plan;
}

/**
 * Aplica uma planta editada à cena: nova imagem de fundo, paredes e tochas refeitas.
 * Tokens, regiões (teleportes, armadilhas, saídas), o diário e paredes feitas à mão ficam
 * como estão; salas novas ganham página e nota no diário.
 */
export async function applyEditedPlan(scene, plan, dungeon, options = {}) {
  const f = scene.flags[MODULE_ID];
  const { topo } = plan;
  const levelId = f.levelId;
  const segs = buildWallSegments(dungeon, { openExits: dungeon.exits.map(ex => ex.cell) });

  // Mantém acesas as salas que já tinham luz; salas novas seguem a chance configurada
  const kindOf = l => l.getFlag(MODULE_ID, "kind");
  const oldLights = scene.lights.filter(l => ["torch", "brazier"].includes(kindOf(l)));
  const litRooms = new Set(oldLights.map(l => l.getFlag(MODULE_ID, "room")));
  const onlyBraziers = oldLights.length && oldLights.every(l => kindOf(l) === "brazier");
  const roomLights = placeLights(dungeon, {
    lightChance: Number(options.lightChance ?? 0.6),
    placement: onlyBraziers ? "center" : (options.lightPlacement ?? "wall"),
    isLit: room => (room.isNew ? undefined : litRooms.has(room.id))
  });

  // 1. Imagem nova
  const assets = await assetPack();
  const blob = await renderDungeon(dungeon, segs, {
    floorTexture: options.floorTexture,
    rockTexture: options.rockTexture,
    lights: roomLights,
    exits: dungeon.exits,
    assets
  });
  const src = await uploadImage(blob, imageName(scene.name, dungeon.seed));
  await scene.updateEmbeddedDocuments("Level", [{ _id: levelId, "background.src": src }]);

  // 2. Paredes: troca só as geradas pelo módulo (cenas antigas: todas do nível da dungeon)
  const generated = scene.walls.filter(w => w.getFlag(MODULE_ID, "generated"));
  const oldWalls = generated.length ? generated
    : scene.walls.filter(w => !w.levels.size || w.levels.has(levelId));
  if (oldWalls.length) await scene.deleteEmbeddedDocuments("Wall", oldWalls.map(w => w.id));
  await scene.createEmbeddedDocuments("Wall", wallDocuments(segs, levelId, assets));

  // 3. Tochas/braseiros
  if (oldLights.length) await scene.deleteEmbeddedDocuments("AmbientLight", oldLights.map(l => l.id));
  const lights = lightDocuments(roomLights, levelId, scene.grid.distance);
  if (lights.length) await scene.createEmbeddedDocuments("AmbientLight", lights);

  // 4. Salas novas no diário
  const journal = game.journal.get(f.journalId);
  const newRooms = dungeon.rooms.filter(r => r.isNew).map(r => r.id);
  if (journal && newRooms.length) await buildJournal(scene, dungeon, roomLights, { entry: journal, onlyRooms: newRooms });

  // 5. Guarda a planta editada
  const { seed, options: opts, ...rest } = dungeonFlags(dungeon, topo);
  await scene.update({
    [`flags.${MODULE_ID}.cells`]: encodeCells(dungeon.cells),
    [`flags.${MODULE_ID}.rooms`]: rest.rooms,
    [`flags.${MODULE_ID}.doors`]: rest.doors
  });
  return { rooms: dungeon.rooms.length, doors: segs.doors.length + segs.lockedDoors.length, lights: lights.length };
}

/* -------------------------------------------- */
/*  Pontos de entrada                           */
/* -------------------------------------------- */

/** Uma cena avulsa. */
export async function createDungeonScene(options = {}) {
  if (!game.user.isGM) throw new Error("Só o Mestre pode gerar dungeons.");
  const plan = planDungeon(options);
  ui.notifications.info(game.i18n.format("GDC.Generating", { name: options.name?.trim() || `Dungeon ${plan.dungeon.seed}` }));
  return buildScene(plan, options);
}

/**
 * Várias cenas numa pasta, dispostas numa grade (ex.: 4 = 2×2). Cada par de cenas vizinhas
 * é ligado por um corredor que sai pela borda de uma e entra pela borda da outra, na mesma
 * altura, com um teleporte em cada ponta. Só a Parte 1 tem entrada. No fim, um mapa geral.
 * @returns {Promise<Scene[]>}
 */
export async function createDungeonSet(options = {}) {
  if (!game.user.isGM) throw new Error("Só o Mestre pode gerar dungeons.");
  const count = Math.min(9, Math.max(1, Math.round(Number(options.scenes) || 1)));
  if (count === 1) return [await createDungeonScene(options)];

  const baseSeed = String(options.seed || randomSeed());
  const baseName = options.name?.trim() || `Dungeon ${baseSeed}`;

  // Planeja tudo antes de criar qualquer coisa. Ligações que não couberem são replanejadas
  // em outra posição; as que mesmo assim falharem ficam de fora dos dois lados
  // (nunca um teleporte para lugar nenhum).
  ui.notifications.info(game.i18n.format("GDC.Set.Planning", { count }));
  const { plans, links, okLinks, gridCols } = planLinkedSet(count, baseSeed,
    (k, seed, exits) => planDungeon({ ...options, seed, exits, entrance: options.entrance !== false && k === 0 }));
  const sceneIds = plans.map(() => foundry.utils.randomID());
  for (const l of okLinks) {
    l.regionA = foundry.utils.randomID();
    l.regionB = foundry.utils.randomID();
  }

  const folder = await Folder.create({ name: baseName, type: "Scene" });
  const journalFolder = options.journal !== false ? await Folder.create({ name: baseName, type: "JournalEntry" }) : null;
  const partName = k => game.i18n.format("GDC.Set.PartName", { name: baseName, n: k + 1 });
  const scenes = [];
  for (let k = 0; k < count; k++) {
    const sceneLinks = okLinks.flatMap(l => {
      if (l.a === k) return [{ exitId: l.id, regionId: l.regionA, targetSceneId: sceneIds[l.b], targetRegionId: l.regionB,
        label: game.i18n.format("GDC.Exit.Name", { part: l.b + 1 }) }];
      if (l.b === k) return [{ exitId: l.id, regionId: l.regionB, targetSceneId: sceneIds[l.a], targetRegionId: l.regionA,
        label: game.i18n.format("GDC.Exit.Name", { part: l.a + 1 }) }];
      return [];
    });
    ui.notifications.info(game.i18n.format("GDC.Set.Building", { n: k + 1, count }));
    scenes.push(await buildScene(plans[k], {
      ...options,
      name: partName(k),
      sceneId: sceneIds[k],
      folderId: folder.id,
      journalFolderId: journalFolder?.id,
      set: { folder: folder.id, seed: baseSeed, part: k + 1, of: count, gridCols },
      links: sceneLinks,
      placeParty: options.placeParty && k === 0,
      view: false,
      quiet: true
    }));
  }

  // Mapa geral com as partes lado a lado e as ligações entre elas
  try {
    const exitPoint = (k, id) => {
      const ex = plans[k].dungeon.exits.find(e => e.id === id);
      return plans[k].topo.hexCenter(ex.cell);
    };
    await buildOverview({
      name: baseName,
      scenes,
      gridCols,
      folderId: journalFolder?.id,
      links: okLinks.map(l => ({ a: l.a, b: l.b, exitA: exitPoint(l.a, l.id), exitB: exitPoint(l.b, l.id) })),
      upload: blob => uploadImage(blob, imageName(`${baseName}-mapa`, baseSeed))
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Não consegui montar o mapa geral`, err);
  }

  await scenes[0].view();
  ui.notifications.info(game.i18n.format("GDC.Set.Done", {
    name: baseName, count, links: okLinks.length, total: links.length, seed: baseSeed
  }));
  return scenes;
}
