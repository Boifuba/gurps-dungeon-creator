/**
 * Editor da planta: mostra a dungeon em preto e branco na mesma grade da cena.
 *   Botão esquerdo = pinta com o pincel escolhido (Sala ou Corredor)
 *   Botão direito  = apaga (volta a ser rocha)
 * Ao salvar, a cena ganha imagem nova, paredes e tochas refeitas (ver applyEditedPlan).
 */
import { CELL } from "./generator.js";
import { rebuildDungeon } from "./plan-edit.js";
import { MODULE_ID, loadScenePlan, applyEditedPlan } from "./scene-builder.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const COLORS = {
  [CELL.WALL]: "#f2f0ea",
  [CELL.ROOM]: "#111111",
  [CELL.CORRIDOR]: "#4a4a4a",
  grid: "#8a8a8a",
  door: "#e07b20",
  secret: "#a050e0",
  pad: "#3d9be9",
  exit: "#d8a920"
};

export class PlanEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @param {Scene} scene */
  constructor(scene, options = {}) {
    super(options);
    this.scene = scene;
    this.plan = loadScenePlan(scene); // lança erro se a cena não puder ser editada
    this.cells = Uint8Array.from(this.plan.dungeon.cells);
    this.changed = new Set();
    this.history = [];
    this.tool = "room";
    this.autoDoors = true;
    this.scale = 1;
  }

  static DEFAULT_OPTIONS = {
    classes: ["gdc-editor"],
    window: { icon: "fa-solid fa-pen-ruler", resizable: true },
    position: { width: "auto", height: "auto" },
    actions: {
      tool: PlanEditor.#onTool,
      undo: PlanEditor.#onUndo,
      save: PlanEditor.#onSave
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/editor.hbs` }
  };

  get title() {
    return `${game.i18n.localize("GDC.Editor.Title")} — ${this.scene.name}`;
  }

  async _prepareContext(options) {
    return { tool: this.tool, autoDoors: this.autoDoors };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const topo = this.plan.topo;
    const canvas = this.element.querySelector("canvas");
    const maxW = Math.min(1400, window.innerWidth - 80);
    const maxH = window.innerHeight - 260;
    this.scale = Math.min(maxW / topo.width, maxH / topo.height, 1);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${Math.floor(topo.width * this.scale)}px`;
    canvas.style.height = `${Math.floor(topo.height * this.scale)}px`;
    canvas.width = Math.floor(topo.width * this.scale * dpr);
    canvas.height = Math.floor(topo.height * this.scale * dpr);
    this.ctx = canvas.getContext("2d");
    this.ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, 0, 0);
    this.#drawAll();

    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointerdown", this.#onPointerDown.bind(this));
    canvas.addEventListener("pointermove", this.#onPointerMove.bind(this));
    canvas.addEventListener("pointerup", this.#onPointerUp.bind(this));
    canvas.addEventListener("pointercancel", this.#onPointerUp.bind(this));
    this.element.querySelector("[name=autoDoors]").addEventListener("change", e => { this.autoDoors = e.target.checked; });
    this.element.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        this.#undo();
      }
    });
  }

  /* -------------------------------------------- */
  /*  Desenho                                     */
  /* -------------------------------------------- */

  #polygon(verts) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let k = 1; k < verts.length; k++) ctx.lineTo(verts[k].x, verts[k].y);
    ctx.closePath();
  }

  /** Cada célula é desenhada como a casa da grade da cena (hex ou quadrado), com o contorno visível. */
  #drawCell(id) {
    const topo = this.plan.topo;
    const ctx = this.ctx;
    this.#polygon(topo.outline(id));
    ctx.fillStyle = COLORS[this.cells[id]];
    ctx.fill();
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / this.scale;
    ctx.stroke();
  }

  #drawAll() {
    const topo = this.plan.topo;
    const d = this.plan.dungeon;
    const ctx = this.ctx;
    ctx.fillStyle = COLORS[CELL.WALL];
    ctx.fillRect(0, 0, topo.width, topo.height);
    for (let id = 0; id < topo.count; id++) this.#drawCell(id);

    // Portas que ainda existem (as entradas novas ganham porta só ao salvar)
    const isFloor = id => this.cells[id] !== CELL.WALL;
    ctx.lineCap = "round";
    for (const door of d.doors) {
      if (!door.edges.every(([a, b]) => isFloor(a) && isFloor(b))) continue;
      ctx.strokeStyle = door.secret ? COLORS.secret : COLORS.door;
      ctx.lineWidth = topo.size * 0.18;
      for (const [a, b] of door.edges) {
        const e = topo.sharedEdge(a, b);
        if (!e) continue;
        ctx.beginPath();
        ctx.moveTo(e[0], e[1]);
        ctx.lineTo(e[2], e[3]);
        ctx.stroke();
      }
    }
    // Círculos de teleporte e saídas para outras cenas
    for (const t of d.teleports ?? []) {
      for (const pad of [t.padA, t.padB]) {
        const c = topo.hexCenter(pad);
        ctx.fillStyle = COLORS.pad;
        ctx.beginPath();
        ctx.arc(c.x, c.y, topo.size * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const ex of d.exits ?? []) {
      const c = topo.hexCenter(ex.cell);
      ctx.fillStyle = COLORS.exit;
      ctx.beginPath();
      ctx.arc(c.x, c.y, topo.size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* -------------------------------------------- */
  /*  Pintura                                     */
  /* -------------------------------------------- */

  /** Casa da grade sob o ponto (em pixels da cena). */
  #cellAt(x, y) {
    const topo = this.plan.topo;
    const grid = topo.grid;
    const start = grid.getOffset({ x, y });
    const candidates = [start, ...grid.getAdjacentOffsets(start)].filter(o => topo.inBounds(o.i, o.j));
    const inside = (px, py, verts) => {
      let hit = false;
      for (let a = 0, b = verts.length - 1; a < verts.length; b = a++) {
        const pa = verts[a], pb = verts[b];
        if ((pa.y > py) !== (pb.y > py) && px < ((pb.x - pa.x) * (py - pa.y)) / (pb.y - pa.y) + pa.x) hit = !hit;
      }
      return hit;
    };
    for (const o of candidates) {
      const id = topo.id(o.i, o.j);
      if (inside(x, y, topo.outline(id))) return id;
    }
    return null;
  }

  #paint(event) {
    const topo = this.plan.topo;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.scale;
    const y = (event.clientY - rect.top) / this.scale;
    const id = this.#cellAt(x, y);
    if (id === null) return;
    const exitCells = new Set((this.plan.dungeon.exits ?? []).map(ex => ex.cell));
    const { i, j } = topo.ij(id);
    const border = i === 0 || j === 0 || i === topo.rows - 1 || j === topo.cols - 1;
    if (border && this.paintValue !== CELL.WALL && !exitCells.has(id)) return; // a borda do mapa fica rocha
    if (this.cells[id] === this.paintValue) return;
    if (!this.stroke.has(id)) this.stroke.set(id, this.cells[id]);
    this.cells[id] = this.paintValue;
    this.changed.add(id);
    this.#drawCell(id);
  }

  #onPointerDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    this.paintValue = event.button === 2 ? CELL.WALL : (this.tool === "room" ? CELL.ROOM : CELL.CORRIDOR);
    this.stroke = new Map();
    this.painting = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    this.#paint(event);
  }

  #onPointerMove(event) {
    if (this.painting) this.#paint(event);
  }

  #onPointerUp() {
    if (!this.painting) return;
    this.painting = false;
    if (this.stroke.size) this.history.push(this.stroke);
    this.#drawAll();
  }

  #undo() {
    const stroke = this.history.pop();
    if (!stroke) return;
    for (const [id, old] of stroke) this.cells[id] = old;
    this.#drawAll();
  }

  /* -------------------------------------------- */
  /*  Ações                                       */
  /* -------------------------------------------- */

  static #onTool(event, target) {
    this.tool = target.dataset.tool;
    for (const b of this.element.querySelectorAll("[data-action=tool]")) {
      b.classList.toggle("active", b.dataset.tool === this.tool);
    }
  }

  static #onUndo() {
    this.#undo();
  }

  static async #onSave(event, target) {
    if (!this.changed.size) return this.close();
    target.disabled = true;
    ui.notifications.info(game.i18n.localize("GDC.Editor.Saving"));
    try {
      const dungeon = rebuildDungeon(this.plan.dungeon, this.cells, { changed: this.changed, autoDoors: this.autoDoors });
      const saved = game.settings.get(MODULE_ID, "lastOptions") ?? {};
      const result = await applyEditedPlan(this.scene, this.plan, dungeon, {
        lightChance: saved.lightChance,
        lightPlacement: saved.lightPlacement,
        floorTexture: game.settings.get(MODULE_ID, "floorTexture"),
        rockTexture: game.settings.get(MODULE_ID, "rockTexture")
      });
      ui.notifications.info(game.i18n.format("GDC.Editor.Saved", result));
      await this.close();
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err.message);
      target.disabled = false;
    }
  }
}
