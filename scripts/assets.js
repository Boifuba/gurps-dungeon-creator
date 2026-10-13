/**
 * Imagens usadas no mapa. As do próprio módulo (pasta assets/) são sempre usadas;
 * uma pasta escolhida na janela só troca as imagens que tiver com o mesmo nome.
 *
 *   floor     piso de salas e corredores (textura que se repete)
 *   door      porta (pintada no vão de cada porta, com espessura fixa)
 *   door-frame batentes nas pontas de cada porta
 *   pillar    pilastra
 *   entrance  alçapão/escada da entrada
 *   torch     tocha de parede (suporte à direita, chama à esquerda)
 *
 * Padrão das imagens: 200 px por quadrado de 5 pés (1,67 jarda).
 */
export const MODULE_ASSETS = "modules/gurps-dungeon-creator/assets";

/** As imagens do módulo, com caminho fixo. */
const MODULE_PACK = {
  floor: `${MODULE_ASSETS}/floor.jpg`,
  door: `${MODULE_ASSETS}/door.png`,
  doorFrame: `${MODULE_ASSETS}/door-frame.png`,
  pillar: `${MODULE_ASSETS}/pillar.png`,
  entrance: `${MODULE_ASSETS}/entrance.png`,
  torch: `${MODULE_ASSETS}/torch.png`
};

const ROLES = { floor: "floor", "floor-room": "floor", door: "door", "door-frame": "doorFrame", pillar: "pillar", entrance: "entrance", torch: "torch" };

/** @returns {Promise<{floor, door, doorFrame, pillar, entrance, torch}>} */
export async function findAssetPack(folder) {
  const pack = { ...MODULE_PACK };
  if (!folder || folder === MODULE_ASSETS) return pack;
  try {
    const result = await foundry.applications.apps.FilePicker.implementation.browse("data", folder);
    for (const path of result.files ?? []) {
      const name = decodeURIComponent(path.split("/").pop()).toLowerCase().replace(/\.[^.]+$/, "");
      if (ROLES[name]) pack[ROLES[name]] = path;
    }
  } catch (err) {
    // Pasta escolhida não existe: ficam as imagens do módulo
  }
  return pack;
}
