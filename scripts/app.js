/**
 * Janela de configurações do gerador.
 * Topo: nome e seed. Abas: Mapa · Salas · Corredores e portas · Visual.
 */
import { DEFAULT_OPTIONS } from "./generator.js";
import { MODULE_ID, createDungeonSet } from "./scene-builder.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const DEFAULT_APP_OPTIONS = Object.freeze({
  ...DEFAULT_OPTIONS,
  name: "",
  scenes: 1,             // cenas ligadas entre si (1 = cena avulsa)
  gridType: 4,           // CONST.GRID_TYPES.HEXODDQ — hexágono, topo plano (padrão GURPS)
  wallStyle: "straight", // "straight" = planta reta sobre os hexes; "grid" = segue as bordas dos hexes
  cellSize: 100,
  lightChance: 0.6,
  lightPlacement: "wall", // "wall" = tochas nas paredes; "center" = braseiro no meio da sala
  darkness: 0.8,
  teleportConfirm: false,
  placeParty: false,     // coloca os personagens dos jogadores na entrada
  journal: true          // cria o diário com as salas
});

/** Presets de tamanho: ajustam o mapa e as salas juntos. */
const SIZE_PRESETS = {
  small:  { width: 32, height: 24, rooms: 6,  roomMin: 3, roomMax: 7 },
  medium: { width: 50, height: 36, rooms: 10, roomMin: 4, roomMax: 9 },
  large:  { width: 72, height: 50, rooms: 18, roomMin: 4, roomMax: 11 }
};

const TEMPLATES = `modules/${MODULE_ID}/templates`;

export class DungeonCreatorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gurps-dungeon-creator",
    tag: "form",
    classes: ["gurps-dungeon-creator"],
    window: { title: "GDC.Title", icon: "fa-solid fa-dungeon", contentClasses: ["standard-form"], resizable: true },
    position: { width: 520 },
    form: {
      handler: DungeonCreatorApp.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      randomSeed: DungeonCreatorApp.#onRandomSeed,
      preset: DungeonCreatorApp.#onPreset
    }
  };

  static PARTS = {
    header: { template: `${TEMPLATES}/config-header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    body: { template: `${TEMPLATES}/config.hbs`, scrollable: [""] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "map", icon: "fa-solid fa-map" },
        { id: "rooms", icon: "fa-solid fa-vector-square" },
        { id: "corridors", icon: "fa-solid fa-door-open" },
        { id: "visual", icon: "fa-solid fa-fire" }
      ],
      initial: "map",
      labelPrefix: "GDC.Tab"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const saved = game.settings.get(MODULE_ID, "lastOptions") ?? {};
    const values = {
      ...DEFAULT_APP_OPTIONS, ...saved, seed: "", name: "",
      floorTexture: game.settings.get(MODULE_ID, "floorTexture") ?? "",
      rockTexture: game.settings.get(MODULE_ID, "rockTexture") ?? ""
    };
    return Object.assign(context, {
      values,
      gridTypes: {
        4: "GDC.Grid.HexColumns",
        2: "GDC.Grid.HexRows",
        1: "GDC.Grid.Square"
      },
      lightPlacements: {
        wall: "GDC.LightPlacement.Wall",
        center: "GDC.LightPlacement.Center"
      },
      layouts: {
        rooms: "GDC.Layout.Rooms",
        caves: "GDC.Layout.Caves"
      },
      wallStyles: {
        straight: "GDC.WallStyle.Straight",
        grid: "GDC.WallStyle.Grid"
      },
      corridorWidths: Object.fromEntries([1, 2, 3].map(n =>
        [n, game.i18n.format(n === 1 ? "GDC.Field.CorridorWidthOne" : "GDC.Field.CorridorWidthMany", { n })])),
      percent: {
        lockedChance: Math.round(values.lockedChance * 100),
        extraLoops: Math.round(values.extraLoops * 100),
        doorChance: Math.round(values.doorChance * 100),
        lightChance: Math.round(values.lightChance * 100),
        darkness: Math.round(values.darkness * 100)
      },
      buttons: [{ type: "submit", icon: "fa-solid fa-dungeon", label: "GDC.Generate" }]
    });
  }

  static #onRandomSeed() {
    this.element.querySelector("[name=seed]").value = Math.random().toString(36).slice(2, 8);
  }

  static #onPreset(event, target) {
    const preset = SIZE_PRESETS[target.dataset.preset];
    for (const [key, value] of Object.entries(preset)) {
      const input = this.element.querySelector(`[name=${key}]`);
      if (input) input.value = value;
    }
    ui.notifications.info(game.i18n.localize("GDC.Preset.Applied"));
  }

  static async #onSubmit(event, form, formData) {
    const data = formData.object;
    const options = {
      name: data.name,
      seed: data.seed,
      // Mapa
      layout: data.layout,
      gridType: Number(data.gridType),
      wallStyle: data.wallStyle,
      scenes: Math.clamp(Number(data.scenes), 1, 9),
      width: Math.clamp(Number(data.width), 10, 200),
      height: Math.clamp(Number(data.height), 10, 200),
      // Salas
      rooms: Math.clamp(Number(data.rooms), 2, 80),
      roomMin: Math.max(2, Number(data.roomMin)),
      roomMax: Math.max(Number(data.roomMin), Number(data.roomMax)),
      secretRooms: Math.clamp(Number(data.secretRooms), 0, 20),
      teleportRooms: Math.clamp(Number(data.teleportRooms), 0, 20),
      entrance: !!data.entrance,
      placeParty: !!data.placeParty,
      teleportConfirm: !!data.teleportConfirm,
      // Corredores e portas
      corridorWidth: Math.clamp(Number(data.corridorWidth), 1, 3),
      lockedChance: Number(data.lockedChance) / 100,
      traps: Math.clamp(Number(data.traps), 0, 30),
      extraLoops: Number(data.extraLoops) / 100,
      doorChance: Number(data.doorChance) / 100,
      // Visual
      lightChance: Number(data.lightChance) / 100,
      lightPlacement: data.lightPlacement,
      journal: !!data.journal,
      darkness: Number(data.darkness) / 100,
      cellSize: Math.clamp(Number(data.cellSize), 50, 300)
    };
    const { name, seed, ...toSave } = options;
    await game.settings.set(MODULE_ID, "lastOptions", toSave);
    await game.settings.set(MODULE_ID, "floorTexture", data.floorTexture || null);
    await game.settings.set(MODULE_ID, "rockTexture", data.rockTexture || null);

    try {
      await createDungeonSet({
        ...options,
        floorTexture: data.floorTexture || null,
        rockTexture: data.rockTexture || null
      });
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err.message);
    }
  }
}
