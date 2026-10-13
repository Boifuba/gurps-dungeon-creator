/**
 * Pacote de assets: uma pasta (dentro de Data) com imagens nomeadas pelo papel de cada uma.
 *
 *   floor-room.*      piso das salas (textura que se repete)
 *   floor-corridor.*  piso dos corredores (se faltar, usa o das salas)
 *   door.*            porta (pintada no vão de cada porta, com espessura fixa)
 *   door-frame.*      batentes desenhados nas pontas de cada porta
 *   pillar.*          pilastra
 *   entrance.*        alçapão/escada da entrada
 *
 * Os assets seguem o padrão comum de 200 px por quadrado de 5 pés (1,67 jarda).
 * Se a pasta não existir, o módulo desenha tudo sozinho, como antes.
 */
const ROLES = { "floor-room": "floorRoom", "floor-corridor": "floorCorridor", door: "door", "door-frame": "doorFrame", pillar: "pillar", entrance: "entrance" };

/** @returns {Promise<{floorRoom?, floorCorridor?, door?, doorFrame?, pillar?, entrance?}>} */
export async function findAssetPack(folder) {
  const pack = {};
  if (!folder) return pack;
  let result;
  try {
    result = await foundry.applications.apps.FilePicker.implementation.browse("data", folder);
  } catch (err) {
    return pack; // pasta não existe: desenho próprio do módulo
  }
  for (const path of result.files ?? []) {
    const name = decodeURIComponent(path.split("/").pop()).toLowerCase().replace(/\.[^.]+$/, "");
    if (ROLES[name]) pack[ROLES[name]] = path;
  }
  return pack;
}
