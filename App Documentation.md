# Moonlander.io - App Documentation

## 1. Overview & Architecture
**Moonlander.io** is a cooperative multiplayer physics-based lunar exploration game built on Node.js/Express + Vite/React (Vanilla JavaScript frontend with Socket.io real-time communication) adhering to the zero-config Railway monorepo structure.

- **Frontend**: Vite + HTML Canvas (`client/src/main.js`, `Renderer.js`, `Input.js`, `SoundManager.js`).
- **Backend**: Express + Socket.io (`server/index.js`, `server/game/Game.js`, `NetworkSystem.js`, `CableSystem.js`, `VoxelMap.js`, `Player.js`, `PhysicsWorld.js`).

---

## 2. Core Game Loop & Win/Loss Conditions

### Win Condition (Lunar Core Reached)
- Players pilot landers into a procedurally generated moon to depth 5000m.
- Reaching `depth >= 5000m` triggers a broadcast `gameOver` event with `won: true`, displaying session stats (Time Elapsed, Total Ore Mined, Team Deaths, Final Depth) in a victory screen overlay.

### Lose Condition (Colony Lost)
- If all players die and the colony base resources have insufficient `spareParts` for respawning, the game ends with a `gameOver` event (`won: false`).

---

## 3. Base Building & The Three-Network System

Bases consist of a **Landing Pad** anchor (200m building radius) and associated structures.

### The Base Bus
Buildings placed on the Landing Pad deck are auto-connected across all networks without cables.

### Manual Cabling (Off-Deck & Underground Outposts)
Buildings built away from the deck require manual cable wiring:
1. 🔴 **Power Network (Power Cable (Red))**: Flow-based electricity in kW with a kJ buffer. Generators include Habitat (15 kW starter), Solar Array (10 kW, surface only), and Fuel Generator (50 kW, burns fuel). Automated load shedding handles grid deficits.
2. 🟢 **Fuel Network (Fuel Pipe (Green))**: Routes refined fuel from Refineries/Depots to Landing Pads and Fuel Generators.
3. 🔵 **Data Network (Data Cable (Blue))**: Merges radar feeds between Comm Antennas.

---

## 4. Antenna, Radar & Minimap Visibility

- **Explored Terrain**: Saved as permanent dim static memory on the minimap.
- **Live Signal**: Live radar blips (players, landers, hazards, cargo drops) require an active, powered **Comm Antenna** (100m+) or **Habitat** (250m starter bubble).
- **Team Data Net**: Blue data cables merge antenna networks, giving all connected teammates shared live radar vision.

---

## 5. Mining & Refining Economy

- **Mining Laser**: Spacebar activates laser to mine voxels.
- **Ores**: Iron, Copper, Silver, Titanium, Gold, Platinum, Diamond, Helium-3, and Bitite.
- **Refining**: Habitat starter refinery (3 units/sec, self-powering) + standalone Fuel Refinery (8 units/sec, 15 kW draw). Bitite is synthesized into liquid fuel for landers.

---

## 6. How to Play & Help Guide UI

- **ESC Menu Tab**: Contains a comprehensive "Game Guide" tab accessible in-game via `ESC`.
- **Lobby Screen**: Includes a "📖 How to Play" button on the starting screen for new players.
- **Victory & Game Over Modal**: Interactive ending screen showing game statistics and options to continue or return to lobby.
