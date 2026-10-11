import { MODULE_ID, createDungeonSet } from "./scene-builder.js";
import { DungeonCreatorApp } from "./app.js";
import { PlanEditor } from "./editor.js";

Hooks.once("init", () => {
  const { FilePathField, ObjectField } = foundry.data.fields;

  game.settings.register(MODULE_ID, "lastOptions", {
    scope: "world",
    config: false,
    type: new ObjectField(),
    default: {}
  });

  game.settings.register(MODULE_ID, "floorTexture", {
    name: "GDC.Setting.FloorTexture",
    hint: "GDC.Setting.FloorTextureHint",
    scope: "world",
    config: false, // editado na aba "Visual" da janela
    type: new FilePathField({ categories: ["IMAGE"] })
  });

  game.settings.register(MODULE_ID, "rockTexture", {
    name: "GDC.Setting.RockTexture",
    hint: "GDC.Setting.RockTextureHint",
    scope: "world",
    config: false, // editado na aba "Visual" da janela
    type: new FilePathField({ categories: ["IMAGE"] })
  });
});

Hooks.once("ready", () => {
  // API para macros:  game.modules.get("gurps-dungeon-creator").api.generate({rooms: 12})
  game.modules.get(MODULE_ID).api = {
    open: () => new DungeonCreatorApp().render({ force: true }),
    generate: options => createDungeonSet(options),
    edit: (scene = canvas.scene) => openEditor(scene)
  };
});

// Botão "Gerar Dungeon" no topo da aba de Cenas
Hooks.on("renderSceneDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const actions = html.querySelector(".header-actions");
  if (!actions || actions.querySelector(".gdc-open")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("gdc-open");
  button.innerHTML = `<i class="fa-solid fa-dungeon" inert></i><span>${game.i18n.localize("GDC.Button")}</span>`;
  button.addEventListener("click", () => new DungeonCreatorApp().render({ force: true }));
  actions.append(button);
});

/** Abre o editor da planta, avisando se a cena não puder ser editada. */
function openEditor(scene) {
  try {
    new PlanEditor(scene).render({ force: true });
  } catch (err) {
    ui.notifications.error(err.message);
  }
}

// Botão direito numa cena gerada pelo módulo → "Editar planta"
Hooks.on("getSceneContextOptions", (app, menuItems) => {
  menuItems.push({
    label: "GDC.Editor.Menu",
    icon: "fa-solid fa-pen-ruler",
    visible: li => game.user.isGM && !!game.scenes.get(li.dataset.entryId)?.getFlag(MODULE_ID, "seed"),
    onClick: (event, li) => openEditor(game.scenes.get(li.dataset.entryId))
  });
});
