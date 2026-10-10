# GURPS Dungeon Creator

Gerador procedural de dungeons para **Foundry VTT v14**, pensado para GURPS (grade hexagonal, 1 hex = 1 jarda).
Um clique cria a cena pronta: imagem de fundo, paredes, portas, portas secretas, tochas e teleportes.

*Procedural dungeon generator for Foundry VTT v14, built with GURPS in mind (hex grid, 1 hex = 1 yard). English below.*

## Recursos

- **Hexágono ou quadrado.** Paredes **retas** (planta com a grade por cima — cada hex pertence ao lado onde está o centro dele) ou seguindo a grade (zigue-zague).
- **Salas e corredores** com largura de 1 a 3 hexes, caminhos extras e portas que fecham a entrada inteira.
- **Salas secretas** atrás de uma **porta secreta** do Foundry (os jogadores veem parede até o Mestre revelar).
- **Salas de teleporte**, sem acesso a pé, com círculos de ida e volta (*Regions* com *Teleport Token*).
- **Tochas nas paredes** (1 a 4 por sala, conforme o tamanho) ou braseiro no centro.
- **Cenas ligadas:** gera até 9 cenas numa pasta (ex.: 2×2). Corredores saem pela borda e levam à cena vizinha, na mesma altura.
- **Seed:** a mesma seed gera sempre a mesma dungeon.
- Texturas próprias opcionais para chão e rocha.

## Instalação

No Foundry: *Add-on Modules → Install Module → Manifest URL*:

```
https://github.com/Boifuba/gurps-dungeon-creator/releases/latest/download/module.json
```

## Uso

Na aba **Cenas**, clique em **Gerar Dungeon** (só o Mestre vê o botão). Ou por macro:

```js
game.modules.get("gurps-dungeon-creator").api.open();

game.modules.get("gurps-dungeon-creator").api.generate({
  name: "Cripta Esquecida",
  scenes: 4,            // cenas ligadas (1 = cena avulsa)
  gridType: 4,          // 4 = hex topo plano, 2 = hex topo pontudo, 1 = quadrado
  wallStyle: "straight",// "straight" = paredes retas | "grid" = zigue-zague
  rooms: 10,
  corridorWidth: 2,
  secretRooms: 1,
  teleportRooms: 1,
  lightPlacement: "wall"
});
```

## Desenvolvimento

Testes sem o Foundry (usam as classes de grade do Foundry instalado):

```
node tools/preview.mjs [seed] [gridType] [largura] [straight|grid]
node tools/set-test.mjs
```

`tools/render-test.html` desenha a imagem no navegador (servir a pasta do módulo e o `resources/app/common` do Foundry em `/foundry/`).

---

## English

- Hex or square grids, with **straight walls** (floor plan with the grid on top) or grid-following walls.
- Rooms and corridors (1–3 hexes wide), doors, **Foundry secret doors**, **teleport-only rooms**, **wall torches**.
- **Linked scenes:** up to 9 scenes in a folder, connected by edge corridors with cross-scene teleports.
- Seeded and reproducible. Requires Foundry VTT v14.

Install with the manifest URL above, then click **Generate Dungeon** in the Scenes sidebar.
