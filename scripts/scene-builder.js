/**
 * Monta as cenas no Foundry v14: imagem de fundo (no Level), paredes, portas, luzes e teleportes.
 *
 *  planDungeon()        → gera a dungeon em memória (não toca no Foundry)
 *  buildScene()         → cria uma cena a partir de um plano
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

/**
 * Cria a cena de um plano.
 * @param {object} plan     Resultado de planDungeon
 * @param {object} options  {name, lightChance, lightPlacement, darkness, floorTexture, rockTexture,
 *                           teleportConfirm, view, quiet, sceneId, folderId, set,
 *                           links: [{exitId, regionId, targetSceneId, targetRegionId, label}]}
 * @returns {Promise<Scene>}
 */
export async function buildScene(plan, options = {}) {
  const { topo, dungeon, cellSize, gridType, wallStyle } = plan;
  const links = options.links ?? [];
  const activeExits = dungeon.exits.filter(ex => links.some(l => l.exitId === ex.id));
  const segs = buildWallSegments(dungeon, { openExits: activeExits.map(ex => ex.cell) });
  const roomLights = placeLights(dungeon, {
    lightChance: Number(options.lightChance ?? 0.6),
    placement: options.lightPlacement ?? "wall"
  });
  const name = options.name?.trim() || `Dungeon ${dungeon.seed}`;

  // 1. Imagem ---------------------------------------------------------------
  const blob = await renderDungeon(dungeon, segs, {
    floorTexture: options.floorTexture,
    rockTexture: options.rockTexture,
    lights: roomLights,
    exits: activeExits
  });
  const safeName = name.slugify({ strict: true }) || "dungeon";
  const src = await uploadImage(blob, `${safeName}-${dungeon.seed}.webp`);

  // 2. Cena com um Level (v14) ---------------------------------------------
  const levelId = foundry.utils.randomID();
  const sysGrid = game.system.grid ?? {};
  const sceneData = {
    name,
    width: topo.width,
    height: topo.height,
    padding: 0,
    folder: options.folderId ?? null,
    grid: {
      type: gridType,
      size: cellSize,
      distance: sysGrid.distance ?? 1,
      units: sysGrid.units ?? ""
    },
    tokenVision: true,
    environment: {
      darknessLevel: Number(options.darkness ?? 0.8),
      globalLight: { enabled: false }
    },
    levels: [{
      _id: levelId,
      name: game.i18n.localize("GDC.LevelName"),
      background: { src, color: "#000000" }
    }],
    initialLevel: levelId,
    flags: {
      [MODULE_ID]: {
        // Guardado para recursos futuros (regiões, teleportes, encontros...)
        seed: dungeon.seed,
        levelId,
        cellSize,
        gridType,
        wallStyle,
        set: options.set ?? null,
        options: dungeon.options,
        rooms: dungeon.rooms.map(r => ({ ...r, center: topo.hexCenter(r.centerCell) })),
        doors: dungeon.doors.map(d => ({ room: d.room, cells: d.edges, secret: !!d.secret, secretRoom: d.secretRoom })),
        teleports: dungeon.teleports,
        exits: activeExits.map(ex => ({ ...ex, ...links.find(l => l.exitId === ex.id) }))
      }
    }
  };
  if (options.sceneId) sceneData._id = options.sceneId;
  const scene = await Scene.create(sceneData, { keepId: !!options.sceneId });

  // 3. Paredes e portas -----------------------------------------------------
  await scene.createEmbeddedDocuments("Wall", wallDocuments(segs, levelId));

  // 4. Luzes: tochas nas paredes ou braseiro no centro -----------------------
  const distance = scene.grid.distance;
  const lights = lightDocuments(roomLights, levelId, distance);
  if (lights.length) await scene.createEmbeddedDocuments("AmbientLight", lights);

  // 5. Regiões de teleporte: círculos (dentro da cena) e saídas (para outras cenas)
  const teleportRegion = ({ id, cell, label, color, destination, flags }) => {
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
        system: {
          destinations: [destination],
          placement: "center",
          snap: true,
          choice: !!options.teleportConfirm
        }
      }]
    };
  };

  const regionData = [];
  const padLights = [];
  for (const t of dungeon.teleports) {
    const idA = foundry.utils.randomID(), idB = foundry.utils.randomID();
    for (const [id, cell, otherId, from, to] of [[idA, t.padA, idB, t.fromRoom, t.toRoom], [idB, t.padB, idA, t.toRoom, t.fromRoom]]) {
      const c = topo.hexCenter(cell);
      padLights.push({
        x: Math.round(c.x), y: Math.round(c.y), levels: [levelId],
        flags: { [MODULE_ID]: { kind: "pad" } },
        config: { dim: distance * 1.5, bright: distance * 0.5, color: "#5fb4ff", alpha: 0.5,
          animation: { type: "pulse", speed: 2, intensity: 3 } }
      });
      regionData.push(teleportRegion({
        id, cell, color: "#5fb4ff",
        label: game.i18n.format("GDC.Teleport.Name", { from, to }),
        destination: `Scene.${scene.id}.Region.${otherId}`,
        flags: { teleport: t }
      }));
    }
  }
  for (const ex of activeExits) {
    const link = links.find(l => l.exitId === ex.id);
    regionData.push(teleportRegion({
      id: link.regionId, cell: ex.cell, color: "#e0b050",
      label: link.label,
      destination: `Scene.${link.targetSceneId}.Region.${link.targetRegionId}`,
      flags: { exit: { ...ex, ...link } }
    }));
  }
  if (regionData.length) await scene.createEmbeddedDocuments("Region", regionData, { keepId: true });
  if (padLights.length) await scene.createEmbeddedDocuments("AmbientLight", padLights);

  if (options.view !== false) await scene.view();
  if (!options.quiet) {
    ui.notifications.info(`"${name}" criada: ${dungeon.rooms.length} salas, ${segs.doors.length} portas, ${segs.secretDoors.length} secretas, ${lights.length} luzes, ${dungeon.teleports.length} teleportes (seed ${dungeon.seed}).`);
  }
  return scene;
}

/** Paredes, portas e portas secretas no formato do Foundry (marcadas como geradas pelo módulo). */
function wallDocuments(segs, levelId) {
  const toPx = c => c.map(v => Math.round(v));
  const flags = { [MODULE_ID]: { generated: true } };
  return [
    ...segs.walls.map(c => ({ c: toPx(c), levels: [levelId], flags })),
    ...segs.doors.map(c => ({
      c: toPx(c), levels: [levelId], flags,
      door: CONST.WALL_DOOR_TYPES.DOOR,
      ds: CONST.WALL_DOOR_STATES.CLOSED
    })),
    // Porta secreta do Foundry: jogadores veem parede até o Mestre revelar
    ...segs.secretDoors.map(c => ({
      c: toPx(c), levels: [levelId], flags,
      door: CONST.WALL_DOOR_TYPES.SECRET,
      ds: CONST.WALL_DOOR_STATES.CLOSED
    }))
  ];
}

/** Tochas e braseiros no formato do Foundry. */
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
    ...f.options, seed: f.seed, gridType: f.gridType, wallStyle: f.wallStyle ?? "grid", cellSize: f.cellSize
  });
  const d = plan.dungeon;

  if (f.cells) {
    d.cells = decodeCells(f.cells);
    d.rooms = f.rooms.map(({ center, ...r }) => r);
    d.doors = f.doors.map(o => ({ edges: o.cells, room: o.room, secret: o.secret, secretRoom: o.secretRoom }));
  } else {
    const same = d.rooms.length === f.rooms.length
      && d.rooms.every((r, k) => r.x === f.rooms[k].x && r.y === f.rooms[k].y && r.w === f.rooms[k].w && r.h === f.rooms[k].h);
    if (!same) throw new Error(game.i18n.localize("GDC.Editor.OldVersion"));
  }
  d.teleports = f.teleports ?? d.teleports;
  d.exits = (f.exits ?? []).map(({ id, side, cell }) => ({ id, side, cell }));
  return plan;
}

/**
 * Aplica uma planta editada à cena: nova imagem de fundo, paredes e tochas refeitas.
 * Tokens, notas, regiões (teleportes/saídas) e paredes feitas à mão ficam como estão.
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

  // 1. Imagem nova (nome novo, para o navegador não usar a antiga em cache)
  const blob = await renderDungeon(dungeon, segs, {
    floorTexture: options.floorTexture,
    rockTexture: options.rockTexture,
    lights: roomLights,
    exits: dungeon.exits
  });
  const safeName = scene.name.slugify({ strict: true }) || "dungeon";
  const src = await uploadImage(blob, `${safeName}-${dungeon.seed}-${Date.now().toString(36)}.webp`);
  await scene.updateEmbeddedDocuments("Level", [{ _id: levelId, "background.src": src }]);

  // 2. Paredes: troca só as geradas pelo módulo. Cenas antigas não tinham essa marca,
  //    então nelas troca todas as paredes do nível da dungeon.
  const generated = scene.walls.filter(w => w.getFlag(MODULE_ID, "generated"));
  const oldWalls = generated.length ? generated
    : scene.walls.filter(w => !w.levels.size || w.levels.has(levelId));
  if (oldWalls.length) await scene.deleteEmbeddedDocuments("Wall", oldWalls.map(w => w.id));
  await scene.createEmbeddedDocuments("Wall", wallDocuments(segs, levelId));

  // 3. Tochas/braseiros
  if (oldLights.length) await scene.deleteEmbeddedDocuments("AmbientLight", oldLights.map(l => l.id));
  const lights = lightDocuments(roomLights, levelId, scene.grid.distance);
  if (lights.length) await scene.createEmbeddedDocuments("AmbientLight", lights);

  // 4. Guarda a planta editada
  await scene.update({
    [`flags.${MODULE_ID}.cells`]: encodeCells(dungeon.cells),
    [`flags.${MODULE_ID}.rooms`]: dungeon.rooms.map(({ isNew, ...r }) => ({ ...r, center: topo.hexCenter(r.centerCell) })),
    [`flags.${MODULE_ID}.doors`]: dungeon.doors.map(d => ({ room: d.room, cells: d.edges, secret: !!d.secret, secretRoom: d.secretRoom }))
  });
  return { rooms: dungeon.rooms.length, doors: segs.doors.length, lights: lights.length };
}

/** Uma cena avulsa. */
export async function createDungeonScene(options = {}) {
  if (!game.user.isGM) throw new Error("Só o Mestre pode gerar dungeons.");
  const plan = planDungeon(options);
  ui.notifications.info(`Gerando "${options.name?.trim() || `Dungeon ${plan.dungeon.seed}`}"...`);
  return buildScene(plan, options);
}

/**
 * Várias cenas numa pasta, dispostas numa grade (ex.: 4 = 2×2). Cada par de cenas vizinhas
 * é ligado por um corredor que sai pela borda de uma e entra pela borda da outra, na mesma
 * altura, com um teleporte em cada ponta.
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
    (k, seed, exits) => planDungeon({ ...options, seed, exits }));
  const sceneIds = plans.map(() => foundry.utils.randomID());
  for (const l of okLinks) {
    l.regionA = foundry.utils.randomID();
    l.regionB = foundry.utils.randomID();
  }

  const folder = await Folder.create({ name: baseName, type: "Scene" });
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
      set: { folder: folder.id, seed: baseSeed, part: k + 1, of: count, gridCols },
      links: sceneLinks,
      view: k === 0,
      quiet: true
    }));
  }

  ui.notifications.info(game.i18n.format("GDC.Set.Done", {
    name: baseName, count, links: okLinks.length, total: links.length, seed: baseSeed
  }));
  return scenes;
}
