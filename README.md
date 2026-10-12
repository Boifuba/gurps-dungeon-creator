# GURPS Dungeon Creator

A procedural dungeon generator for **Foundry VTT v14**, built with GURPS in mind (hex grid, 1 hex = 1 yard).
One click creates a ready-to-play scene: background image, walls, doors, secret doors, torches and teleports.

## Features

- **Hex or square grids.** Choose **straight walls** (a flat floor plan with the hex grid on top, where each hex belongs to the side its center is on) or walls that follow the grid edges (zigzag).
- **Rooms and corridors** with corridors 1 to 3 hexes wide, extra paths for alternate routes, and doors that close the whole corridor mouth.
- **Secret rooms** behind a Foundry **secret door**: players see a plain wall until the GM reveals it.
- **Teleport rooms** with no access on foot, reached through a pair of teleport circles (Regions with the *Teleport Token* behavior).
- **Wall torches** (1 to 4 per room depending on its size), or a brazier in the center of the room.
- **Linked scenes.** Generate up to 9 scenes in a folder (for example 2×2). Corridors leave through the scene edge and lead to the neighboring scene at the same height, with a teleport at each end. This keeps each scene light while the dungeon stays huge.
- **Natural caves.** A second dungeon type: organic caverns linked by tunnels.
- **Locked doors** (Foundry's locked state, drawn with iron bands and a lock) and **hidden traps**: GM-only regions that post a chat card with clickable GURPS rolls (`[Per-2]`, `[Dodge]`, `[2d cut]`...) when stepped on.
- **Entrance** with stairs in room 1; the scene opens centered on it and can place the players' characters there.
- **Journal**: one page per room (size, doors, light, secrets) with numbered map notes, GM only. Linked sets also get an **overview map** of all parts.
- **Floor plan editor**: right-click a generated scene → *Edit floor plan*. Paint hexes as room or corridor, right-click to erase, then save to rebuild the scene.
- **Regenerate**: right-click → *Regenerate with a new seed*. Exits to neighboring scenes keep working.
- **Seeded.** The same seed always produces the same dungeon.
- Optional custom textures for floor and rock.

## Installation

In Foundry: *Add-on Modules → Install Module → Manifest URL*:

```
https://github.com/Boifuba/gurps-dungeon-creator/releases/latest/download/module.json
```

Requires Foundry VTT v14.

## Usage

In the **Scenes** sidebar, click **Generate Dungeon** (only the GM sees the button). The dialog groups its settings in four tabs: **Map**, **Rooms**, **Corridors & doors** and **Visual**.

You can also use a macro:

```js
// Open the dialog
game.modules.get("gurps-dungeon-creator").api.open();

// Generate directly
game.modules.get("gurps-dungeon-creator").api.generate({
  name: "Forgotten Crypt",
  scenes: 4,             // linked scenes (1 = a single scene)
  gridType: 4,           // 4 = hex flat-top, 2 = hex pointy-top, 1 = square
  wallStyle: "straight", // "straight" = flat walls | "grid" = follow the hex edges
  rooms: 10,
  corridorWidth: 2,      // 1 to 3 hexes
  secretRooms: 1,        // rooms behind a secret door
  teleportRooms: 1,      // rooms reachable only by teleport
  lightPlacement: "wall",// "wall" = torches | "center" = brazier
  layout: "rooms",       // "rooms" | "caves"
  lockedChance: 0.2,     // share of doors that start locked
  traps: 2,              // hidden traps
  entrance: true,        // stairs in room 1
  placeParty: false,     // put the players' characters at the entrance
  journal: true          // room journal and map notes
});

// Edit or regenerate the current scene
game.modules.get("gurps-dungeon-creator").api.edit();
game.modules.get("gurps-dungeon-creator").api.regenerate();
```

Any option you leave out uses its default.

## Development

Tests run without Foundry, using the grid classes from your installed copy of Foundry:

```
node tools/preview.mjs [seed] [gridType] [corridorWidth] [straight|grid]
node tools/set-test.mjs
node tools/edit-test.mjs
```

`tools/render-test.html` draws the generated image in a browser. Serve the module folder, plus Foundry's `resources/app/common` folder under `/foundry/`.

## Releasing

Publishing a GitHub Release with a tag like `v0.2.1` runs the workflow in `.github/workflows/release.yml`. It builds `module.zip` and a `module.json` with the right version and download link, and attaches both to the release.
