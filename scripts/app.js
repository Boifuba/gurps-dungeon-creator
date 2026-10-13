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
  pillars: true,         // pilastras onde o vão do teto é grande demais
  pillarSpan: 6,         // vão máximo do teto, em jardas
  journal: true          // cria o diário com as salas
});

/** Presets de tamanho: ajustam o mapa e as salas juntos. */
const SIZE_PRESETS = {
  small:  { width: 32, height: 24, rooms: 6,  roomMin: 3, roomMax: 7 },
  medium: { width: 50, height: 36, rooms: 10, roomMin: 4, roomMax: 9 },
  large:  { width: 72, height: 50, rooms: 18, roomMin: 4, roomMax: 11 }
};

const TEMPLATES = `modules/${MODULE_ID}/templates`;

/** Número do formulário: vazio ou inválido vira o padrão; fora do limite vira o limite mais próximo. */
const num = (value, fallback, min, max) => {
  const n = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};
/** Porcentagem do formulário (0–100) → fração (0–1). */
const pct = (value, fallback) => num(value, Math.round(fallback * 100), 0, 100) / 100;
const D = () => DEFAULT_APP_OPTIONS;

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

  async _onRender(context, options) {
    await super._onRender(context, options);
    // Os campos ficam em abas; um campo "inválido" numa aba fechada não pode receber foco e o
    // navegador trava o envio sem mostrar nada. Por isso a validação é feita em #onSubmit.
    this.element.noValidate = true;
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
      scenes: num(data.scenes, D().scenes, 1, 9),
      width: num(data.width, D().width, 10, 200),
      height: num(data.height, D().height, 10, 200),
      // Salas
      rooms: num(data.rooms, D().rooms, 2, 80),
      roomMin: num(data.roomMin, D().roomMin, 2, 30),
      roomMax: Math.max(num(data.roomMin, D().roomMin, 2, 30), num(data.roomMax, D().roomMax, 2, 30)),
      secretRooms: num(data.secretRooms, D().secretRooms, 0, 20),
      teleportRooms: num(data.teleportRooms, D().teleportRooms, 0, 20),
      entrance: !!data.entrance,
      pillars: !!data.pillars,
      pillarSpan: num(data.pillarSpan, D().pillarSpan, 3, 20),
      placeParty: !!data.placeParty,
      teleportConfirm: !!data.teleportConfirm,
      // Corredores e portas
      corridorWidth: num(data.corridorWidth, D().corridorWidth, 1, 3),
      lockedChance: pct(data.lockedChance, D().lockedChance),
      traps: num(data.traps, D().traps, 0, 30),
      extraLoops: pct(data.extraLoops, D().extraLoops),
      doorChance: pct(data.doorChance, D().doorChance),
      // Visual
      lightChance: pct(data.lightChance, D().lightChance),
      lightPlacement: data.lightPlacement,
      journal: !!data.journal,
      darkness: pct(data.darkness, D().darkness),
      cellSize: num(data.cellSize, D().cellSize, 50, 300)
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
