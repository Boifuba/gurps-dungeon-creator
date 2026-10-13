/**
 * Pacote de assets: uma pasta (dentro de Data) com imagens nomeadas pelo papel de cada uma.
 * Padrão: a pasta assets/ do próprio módulo (fora do Git: os assets são de terceiros).
 *
 *   floor.*           piso de salas e corredores (textura que se repete; aceita também floor-room)
 *   door.*            porta (pintada no vão de cada porta, com espessura fixa)
 *   door-frame.*      batentes desenhados nas pontas de cada porta
 *   pillar.*          pilastra
 *   entrance.*        alçapão/escada da entrada
 *   torch.*           tocha de parede (suporte à direita, chama à esquerda)
 *
 * Os assets seguem o padrão comum de 200 px por quadrado de 5 pés (1,67 jarda).
 * Se a pasta escolhida não tiver as imagens, usa a do módulo; se nenhuma tiver, o módulo desenha tudo.
 */
const ROLES = { floor: "floor", "floor-room": "floor", door: "door", "door-frame": "doorFrame", pillar: "pillar", entrance: "entrance", torch: "torch" };

export const MODULE_ASSETS = "modules/gurps-dungeon-creator/assets";

/** @returns {Promise<{floor?, door?, doorFrame?, pillar?, entrance?, torch?}>} */
export async function findAssetPack(folder) {
  const pack = await browsePack(folder);
  if (Object.keys(pack).length || folder === MODULE_ASSETS) return pack;
  return browsePack(MODULE_ASSETS); // pasta escolhida vazia ou inexistente: usa a do módulo
}

async function browsePack(folder) {
  const pack = {};
  if (!folder) return pack;
  let result;
  try {
    result = await foundry.applications.apps.FilePicker.implementation.browse("data", folder);
  } catch (err) {
    return pack; // pasta não existe
  }
  for (const path of result.files ?? []) {
    const name = decodeURIComponent(path.split("/").pop()).toLowerCase().replace(/\.[^.]+$/, "");
    if (ROLES[name]) pack[ROLES[name]] = path;
  }
  return pack;
}
