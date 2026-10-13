/**
 * Pacote de assets: uma pasta (dentro de Data) com imagens nomeadas pelo papel de cada uma.
 *
 *   floor-room.*      piso das salas (textura que se repete)
 *   floor-corridor.*  piso dos corredores (se faltar, usa o das salas)
 *   door.*            porta (o Foundry anima a abertura com esta imagem)
 *   door-frame.*      batentes desenhados nas pontas de cada porta
 *   pillar.*          pilastra
 *   entrance.*        alçapão/escada da entrada
 *   table*.*          mesas (quantas houver: table-long, table-small...)
 *
 * Os assets seguem o padrão comum de 200 px por quadrado de 5 pés (1,67 jarda).
 * Se a pasta não existir, o módulo desenha tudo sozinho, como antes.
 */
const ROLES = { "floor-room": "floorRoom", "floor-corridor": "floorCorridor", door: "door", "door-frame": "doorFrame", pillar: "pillar", entrance: "entrance" };

/** Pixels do asset por jarda: 200 px = 5 pés = 5/3 jarda. */
export const ASSET_PX_PER_YARD = 120;

/** @returns {Promise<{floorRoom?, floorCorridor?, door?, doorFrame?, pillar?, entrance?, tables: string[]}>} */
export async function findAssetPack(folder) {
  const pack = { tables: [] };
  if (!folder) return pack;
  let result;
  try {
    result = await foundry.applications.apps.FilePicker.implementation.browse("data", folder);
  } catch (err) {
    return pack; // pasta não existe: desenho próprio do módulo
  }
  for (const path of result.files ?? []) {
    const name = decodeURIComponent(path.split("/").pop()).toLowerCase().replace(/\.[^.]+$/, "");
    if (name.startsWith("table")) pack.tables.push(path);
    else if (ROLES[name]) pack[ROLES[name]] = path;
  }
  return pack;
}

/** Tamanho natural de uma imagem (para as mesas virarem Tiles do tamanho certo). */
export async function imageSize(src) {
  const bitmap = await createImageBitmap(await (await fetch(src)).blob());
  return { width: bitmap.width, height: bitmap.height };
}
