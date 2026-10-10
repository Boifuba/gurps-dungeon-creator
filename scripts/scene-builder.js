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
  const toPx = c => c.map(v => Math.round(v));
  const wallData = [
    ...segs.walls.map(c => ({ c: toPx(c), levels: [levelId] })),
    ...segs.doors.map(c => ({
      c: toPx(c),
      levels: [levelId],
      door: CONST.WALL_DOOR_TYPES.DOOR,
      ds: CONST.WALL_DOOR_STATES.CLOSED
    })),
    // Porta secreta do Foundry: jogadores veem parede até o Mestre revelar
    ...segs.secretDoors.map(c => ({
      c: toPx(c),
      levels: [levelId],
      door: CONST.WALL_DOOR_TYPES.SECRET,
      ds: CONST.WALL_DOOR_STATES.CLOSED
    }))
  ];
  await scene.createEmbeddedDocuments("Wall", wallData);

  // 4. Luzes: tochas nas paredes ou braseiro no centro -----------------------
  const distance = scene.grid.distance;
  const lights = roomLights.map(l => {
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
