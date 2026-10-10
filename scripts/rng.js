/**
 * Gerador de números aleatórios com seed (mulberry32).
 * A mesma seed sempre produz a mesma dungeon.
 */

/** Converte qualquer texto em um inteiro de 32 bits. */
export function hashSeed(seed) {
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Cria uma seed aleatória curta e legível. */
export function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

export class RNG {
  constructor(seed) {
    this.state = hashSeed(seed);
  }

  /** Número em [0, 1). */
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inteiro em [min, max] (inclusivo). */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** true com probabilidade p (0–1). */
  chance(p) {
    return this.next() < p;
  }

  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  /** Embaralha uma cópia do array (Fisher–Yates, determinístico pela seed). */
  shuffle(array) {
    const a = array.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
