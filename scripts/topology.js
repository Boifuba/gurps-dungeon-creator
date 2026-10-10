/**
 * Adapta uma grade do Foundry (SquareGrid ou HexagonalGrid) para o gerador.
 * Toda a geometria (centros, vértices, vizinhos) vem da própria classe do Foundry,
 * então a imagem gerada fica alinhada exatamente com a grade da cena.
 *
 * Células são identificadas pelo índice  i * cols + j  (i = linha, j = coluna).
 */

const r2 = v => Math.round(v * 100) / 100;
const pointKey = p => `${r2(p.x)},${r2(p.y)}`;

export class Topology {
  /**
   * @param {foundry.grid.BaseGrid} grid   Instância de SquareGrid ou HexagonalGrid
   * @param {number} cols
   * @param {number} rows
   */
  constructor(grid, cols, rows) {
    this.grid = grid;
    this.cols = cols;
    this.rows = rows;
    this.isHex = !!grid.isHexagonal;
    this.size = grid.size;
    this.count = cols * rows;

    // Pré-calcula vizinhos que compartilham uma aresta (no quadrado, ignora diagonais)
    this.#neighbors = new Array(this.count);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const id = this.id(i, j);
        const verts = grid.getVertices({ i, j });
        const keys = new Set(verts.map(pointKey));
        const list = [];
        for (const o of grid.getAdjacentOffsets({ i, j })) {
          const shared = grid.getVertices(o).filter(p => keys.has(pointKey(p)));
          if (shared.length !== 2) continue; // diagonal do quadrado
          const nid = this.inBounds(o.i, o.j) ? this.id(o.i, o.j) : -1;
          list.push({ id: nid, i: o.i, j: o.j, edge: [shared[0].x, shared[0].y, shared[1].x, shared[1].y] });
        }
        this.#neighbors[id] = list;
      }
    }

    // Tamanho da cena: caixa que envolve todas as células (algumas bordas ficam cortadas — são rocha)
    let maxX = 0, maxY = 0;
    for (const j of [cols - 1]) for (let i = 0; i < rows; i++) {
      for (const p of grid.getVertices({ i, j })) maxX = Math.max(maxX, p.x);
    }
    for (let j = 0; j < cols; j++) {
      for (const p of grid.getVertices({ i: rows - 1, j })) maxY = Math.max(maxY, p.y);
    }
    this.width = Math.ceil(maxX);
    this.height = Math.ceil(maxY);
  }

  #neighbors;

  id(i, j) { return i * this.cols + j; }
  ij(id) { return { i: Math.floor(id / this.cols), j: id % this.cols }; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.rows && j < this.cols; }

  /** Vizinhos por aresta: [{id (-1 se fora do mapa), i, j, edge:[x1,y1,x2,y2]}] */
  neighbors(id) { return this.#neighbors[id]; }

  /** Aresta compartilhada entre duas células vizinhas. */
  sharedEdge(a, b) { return this.#neighbors[a].find(n => n.id === b)?.edge ?? null; }

  center(id) { return this.grid.getCenterPoint(this.ij(id)); }
  vertices(id) { return this.grid.getVertices(this.ij(id)); }

  /** Centro real da célula na grade do Foundry (onde o token fica). */
  hexCenter(id) { return this.center(id); }

  /** Contorno da célula na grade do Foundry (para desenhar as juntas do chão). */
  outline(id) { return this.vertices(id); }

  /** Distância aproximada (em células) entre os centros. */
  distance(a, b) {
    const p = this.center(a), q = this.center(b);
    return Math.hypot(p.x - q.x, p.y - q.y) / this.size;
  }
}

/**
 * Paredes retas sobre grade hexagonal.
 *
 * Cada hex ganha uma "caixa" retangular que contém o centro dele, com o centro sempre a
 * pelo menos 1/4 de hex das bordas da caixa. As caixas se encaixam como uma grade quadrada,
 * então salas e corredores viram retângulos de paredes retas, e cada hex pertence ao lado
 * onde está o seu centro. Para o gerador, isto se comporta como uma grade quadrada
 * (vizinhos em 4 direções, corredores em "L").
 *
 * Topo plano (colunas): caixa = [X(j-1), X(j)] × [(i - ¼)·size, (i + ¾)·size],
 *   com X(j) = centro da coluna j + 0,375·largura do hex (meio caminho até a próxima coluna).
 * Topo pontudo (linhas): o mesmo, transposto.
 */
export class BoxTopology {
  constructor(grid, cols, rows) {
    this.grid = grid;
    this.cols = cols;
    this.rows = rows;
    this.isHex = false; // gerador trata como quadrado
    this.isStraight = true;
    this.size = grid.size;
    this.count = cols * rows;
    const columns = !!grid.columns;
    const s = grid.size;

    // Linhas de parede possíveis no eixo "alternado" (entre colunas ou entre linhas de hex)
    const line = k => columns
      ? grid.getCenterPoint({ i: 0, j: k }).x + 0.375 * grid.sizeX
      : grid.getCenterPoint({ i: k, j: 0 }).y + 0.375 * grid.sizeY;
    this.#box = (i, j) => columns
      ? { x0: line(j - 1), x1: line(j), y0: (i - 0.25) * s, y1: (i + 0.75) * s }
      : { x0: (j - 0.25) * s, x1: (j + 0.75) * s, y0: line(i - 1), y1: line(i) };

    this.#neighbors = new Array(this.count);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const b = this.#box(i, j);
        const n = (di, dj, edge) => ({
          id: this.inBounds(i + di, j + dj) ? this.id(i + di, j + dj) : -1, i: i + di, j: j + dj, edge
        });
        this.#neighbors[this.id(i, j)] = [
          n(-1, 0, [b.x0, b.y0, b.x1, b.y0]),
          n(1, 0, [b.x0, b.y1, b.x1, b.y1]),
          n(0, -1, [b.x0, b.y0, b.x0, b.y1]),
          n(0, 1, [b.x1, b.y0, b.x1, b.y1])
        ];
      }
    }

    // Mesmo tamanho de cena da grade hexagonal
    const hex = new Topology(grid, cols, rows);
    this.width = hex.width;
    this.height = hex.height;
  }

  #box;
  #neighbors;

  id(i, j) { return i * this.cols + j; }
  ij(id) { return { i: Math.floor(id / this.cols), j: id % this.cols }; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.rows && j < this.cols; }
  neighbors(id) { return this.#neighbors[id]; }
  sharedEdge(a, b) { return this.#neighbors[a].find(n => n.id === b)?.edge ?? null; }

  /** Centro da caixa (usado para traçar corredores). */
  center(id) {
    const { i, j } = this.ij(id);
    const b = this.#box(i, j);
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  }

  /** Área de chão da célula: a caixa retangular. */
  vertices(id) {
    const { i, j } = this.ij(id);
    const b = this.#box(i, j);
    return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  }

  hexCenter(id) { return this.grid.getCenterPoint(this.ij(id)); }
  outline(id) { return this.grid.getVertices(this.ij(id)); }

  distance(a, b) {
    const p = this.center(a), q = this.center(b);
    return Math.hypot(p.x - q.x, p.y - q.y) / this.size;
  }
}

/** Escolhe a topologia: paredes retas só fazem diferença em grade hexagonal. */
export function createTopology(grid, cols, rows, wallStyle = "straight") {
  if (grid.isHexagonal && wallStyle === "straight") return new BoxTopology(grid, cols, rows);
  return new Topology(grid, cols, rows);
}

/**
 * Cria a grade do Foundry para um tipo de grade (CONST.GRID_TYPES).
 * @param {object} gridClasses  {SquareGrid, HexagonalGrid} — foundry.grid no Foundry, ou importados no Node.
 */
export function createGrid(gridType, size, gridClasses) {
  const { SquareGrid, HexagonalGrid } = gridClasses;
  // 1 = SQUARE, 2 = HEXODDR, 3 = HEXEVENR, 4 = HEXODDQ, 5 = HEXEVENQ
  if (gridType >= 2 && gridType <= 5) {
    return new HexagonalGrid({
      size,
      columns: gridType === 4 || gridType === 5,
      even: gridType === 3 || gridType === 5
    });
  }
  return new SquareGrid({ size });
}
