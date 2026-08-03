# Moonlander.io - Game Design Document
## A Cooperative Lunar Exploration Experience

---

# Development Requests 1
- Don't open the base menu automatically when player is close to the landing pad


Bugs: 
- The mining success message like (3 iron ) sometimes stays and lingers there, it's not removed.


## 1. Game Overview

**Moonlander.io** is a cooperative multiplayer physics-based exploration game where players pilot lunar landers into the depths of a procedurally generated moon. Starting from a shared moon base on the surface, teams of 2-8 players venture into an ever-deepening cave system to extract resources, rescue stranded companions, and uncover the mysteries buried deep within the lunar crust.

### Core Gameplay Loop
1. **Prepare** - Outfit your lander at the moon base with fuel, equipment, and supplies.
2. **Descend** - Navigate treacherous cave systems with your team.
3. **Extract** - Mine resources from cave walls and collect artifacts.
4. **Survive** - Manage fuel, hull integrity, power, and oxygen.
5. **Return** - Bring resources back to upgrade the moon base.
6. **Repeat** - Venture deeper into increasingly challenging depths.

---

### Game win condition
Reach **The Core** — 4,700m down, inside the Core biome — and the endgame fires. The victory screen shows the real measured depth, ore collected, time taken and deaths.

Depth has a single authoritative scale: `VoxelMap.getDepthMeters()`, where the surface is 0m and the bottom of the map is 5,000m. The surface is read from the landing pad, not hardcoded — it moves with the seed (measured 1468, 1500 and 1548 across three seeds).

### The Story
A B-movie framing for why anyone flies a lander four kilometres into a moon, delivered as **depth-triggered transmissions** (`server/game/Story.js`) that fire once per game for the whole team, keyed to the deepest point the expedition has reached. Beats fire on the **biome boundaries**, so a transmission lands as the world visibly changes around you.

| Depth | From | Beat |
|-------|------|------|
| 0m | Tranquility Deep Mining Consortium | Your quota is Helium-3. Ignore the seismic readings below 4,250m. |
| 750m | Automated Survey | The shallow tunnels are not natural. They branch like something was looking for a way *up*. |
| 1,500m | Dr. Voss, Geology | The seismic pattern repeats every 11 hours. It is counting. Downward. |
| 2,500m | Dr. Voss | The Bitite lattice is grown, not formed. It is a recording, and it is very old. |
| 3,500m | Consortium Board | Quota suspended. New objective: establish contact. Dr. Voss is no longer with the Consortium. |
| 4,250m | Unknown origin | WE BUILT THE TUNNELS. WE SEEDED THE ORE. COME THE REST OF THE WAY. |
| Core | The Core | The chamber is warm. The walls are not rock. Something enormous turns over, and is glad. |

The ore you have been mining all game was placed there to bring you down. That is the joke, and the mining loop is the setup.

### Game lose condition
No alive player and no resources left to spawn a new lander. Show a game over screen with the amount of ore collected and the time taken and the number of deaths.

---

## 2. Core Philosophy

### The "One More Run" Loop
Every expedition is a calculated risk. Players push deeper for better rewards but risk losing their cargo if they can't make it back. If the entire team is wiped, the current haul is lost.

### Emergent Cooperation
Cooperation emerges from systemic needs. A player running out of fuel in a deep cavern forces a teammate to choose: risk everything for a rescue tow, or abandon them to secure the current haul.

### Physics as Gameplay
The Ammo.js physics engine is central. Towing, collisions, rope swings, and environmental hazards leverage real physics for authentic, emergent gameplay.

---

## 3. Development Roadmap
### Current Focus: Batch 5 (Active Development)
- **Mechanics Refinements:**
  - **Landing Pad Friction:** Increase surface friction to prevent skidding after landing.
  - **EVA Movement:** Replace jetpack with low-force jumping (already partially implemented).
  - **Immediate Docking:** Ensure repair/refuel/charge triggers immediately upon stable touchdown, the lander must be on the pod and below a certain speed.
- **Bug Fixes:**
  - **Station Menu:** Fix access issues when docked on landing pads.
  - **Collision Correction:** Fix Moonlander landing legs clipping into ground.
  - **Map Persistence:** Ensure per-game seed-based generation.
  - **EVA Persistence:** Fix Moonlander teleporting to (0,0) when player exits.
- **Lighting:**
  - Sync all light emissions (including thruster flames) in multiplayer.

---

## 4. Cooperative Gameplay Systems

### 4.1 Tether & Tow System
- **Physics:** Implemented via Ammo.js rope constraints.
- **Stats:** Max length 150m (upgradeable to 300m); snaps at 120% max length.
- **Towing Cost:** Mass adds physical drag.

### 4.2 Resource Sharing
Opening the inventory near another lander or station will open up both inventories and allow you to drag and drop resources between them. Holding control will move half the amount of resources.
This includes all available resources: ore, fuel, spare parts, and cargo. 

### 4.3 Rescue & Passengers
- **Survival Pods:** Legacy mechanic removed. 
- **Rescue:** A player in EVA mode can enter any other player's ship as a passenger. Requires one free inventory slot. The passenger can hop in and out from any other player's ship at will and hitch a ride. 

---

## 5. Construction & Base Building

### 5.1 Crafting Materials
Ores are automatically processed into five types of materials as soon as they are delivered to a base.

**The Habitat contains a built-in starter refinery.** It is slow — **3 units/second at Level 1, +1 per level** — but because the Habitat powers itself it can never be shut off, so a player can always turn ore into materials and Bitite into fuel. It is the refining equivalent of the pad's starting fuel: enough to get going, not enough to be comfortable.

The standalone **Fuel Refinery** is the real industrial answer: **8 units/second at Level 1, +4 per level**, roughly 3x the Habitat at Level 1 and scaling far harder. It costs 15 kW, which a starting base cannot supply, so it arrives with a generator or not at all.

Total throughput is the **sum of every powered refiner**, so a base with both runs at 11 units/second. This split is load-bearing rather than cosmetic: if refining depended on the Fuel Refinery alone, the player could never earn the materials needed to raise the power supply that the Refinery requires.

| Material | Tier | Primary Use |
|----------|------|-------------|
| **Basic** | 1 | Level 1 Upgrades, Basic Buildings, Cables, Lights |
| **Industrial** | 2 | Level 2 Upgrades, Industrial Buildings, Cargo Hauler |
| **Advanced** | 3 | Level 3 Upgrades, Advanced Tech |
| **Quantum** | 4 | Level 4 Upgrades, End-game Tech |
| **Fuel** | N/A | Ship Propulsion, Power Generation |

### 5.2 Building Anywhere
Players can build bases anywhere in the cave system if they carry the required construction materials.

1. **The Anchor (Landing Pad)**: To start a new base, a **Landing Pad** must be placed first. It is the one building that can be placed outside every existing zone — that is what founding a base means. A new pad starts with **no generator**, so a remote base is dark until the player brings it power.
2. **Building Radius**: The Landing Pad generates a **400m radius** building zone, shown as a dashed circle while placing. *(Nothing except another Landing Pad can be placed outside a zone.)*

   400m rather than the 200m originally specced: building sprites render 92 units wide and need ~100 units of spacing, so a 200m zone had room for roughly three buildings once the pad and Habitat had taken their places — not a base, out of eleven building types. At 400m a base fits about seven.
3. **The Base Bus**: Buildings placed on the pad **deck** — inside the build radius *and* within **±60m of the Landing Pad's own elevation** — are automatically wired to the pad on all three networks (power, fuel, data). This is the "free" surface base and requires no cables. The deck band is shaded green while placing.
4. **Everything else needs cable**: A building placed **below the deck** (underground, in a cave) or **above it** (a cliff shelf, a tower) is inside the build zone but *not* on the bus. It is inert until the player physically runs the cables it needs. This is the core of the base-building game: the bus gets you started, cables get you everywhere else.
5. **Power Requirement**: Every building except the generators (Habitat, Solar Array, Fuel Generator) requires power to function. A Landing Pad with no power will not provide repair/refuel/charge services to landed ships.

### 5.3 Building Catalog
Buildings have 4 upgrade levels (Level 1 to Level 4). The **Needs** column lists the networks a building must be attached to before it does anything: **P** = Power (red), **F** = Fuel (green), **D** = Data (blue).

| Building | Build Cost (Lvl 1) | Upgrade Cost | Needs | Size | Role |
|----------|-------------------|--------------|-------|------|------|
| **Landing Pad** | 20 Basic | 1 Mat of current Tier | P, (F) | Anchor | Base anchor; repair/recharge. Refuels only with fuel on its F network. |
| **Habitat** | 20 Basic | 1 Mat of current Tier | (D) | 2x2 | Starting generator, 250m antenna, starter refinery. Self-powering. |
| **Ore Storage** | 20 Basic | 1 Mat of current Tier | P | 2x2 | Ore capacity |
| **Fuel Depot** | 20 Basic | 1 Mat of current Tier | P, F | 2x2 | Fuel capacity |
| **Parts Warehouse**| 20 Basic | 1 Mat of current Tier | P | 2x2 | Spare-part capacity |
| **Fuel Refinery** | 2 Industrial | 2 Mat of current Tier | P, (F) | 2x2 | Multiplies refining throughput; Bitite→fuel. Pushes fuel out over F. |
| **Solar Array** | 1 Industrial | 1 Mat of current Tier | — | 2x2 | Generator — free forever, weak, surface only |
| **Fuel Generator**| 20 Basic | 1 Mat of current Tier | F *or hand-fill* | 2x2 | Generator — strong and cheap, but burns the fuel you need to fly |
| **Comm Antenna** | 20 Basic | 1 Mat of current Tier | P, (D) | 2x2 | Minimap coverage. D merges it with other antennas. |
| **Ship Factory** | 5 Industrial | 3 Mat of current Tier | P | 2x2 | Ship purchase & upgrades |
| **Crafting Station**| 20 Basic | 2 Mat of current Tier | P | 2x2 | Cables, lights, consumables |
| **Placeable Light** | 20 Basic | N/A | P | 1x1 | Environmental lighting |

Parenthesised networks — **(F)**, **(D)** — are *optional*: the building runs without them but is limited (a Landing Pad with no fuel line still repairs and recharges, it just cannot refuel; an Antenna with no data line still gives its owner coverage, it just does not share).

**Building Notes:**
- **Hauling**: a building is crafted at a base into a **kit**, carried in the ship's hold, and consumed where it is placed. Crafting is where the materials are paid; placing costs nothing further. This is what makes founding a remote base a logistics problem rather than a menu click.
- **Inventory Size**: a kit takes **one cargo slot**, not the 2x2 originally specced. Cargo is a flat array with no 2D packing, and a Scout has only 3 slots — at 2x2 no building could be carried at all until a Cargo Hauler (50 Industrial, found below 1385m), which would gate the first Comm Antenna behind the depths its own minimap exists to help you reach. Footprint is a per-building concept that can return if a real 2D grid is ever built.
- **Cargo Hauler**: with 6 slots, the Cargo Hauler can carry one 2x2 building plus 2 spare slots — it is the intended vehicle for founding remote bases.

### 5.4 The Starting Base
A fresh game always begins with two buildings already placed on the surface deck, adjacent and auto-bussed:

| Building | Level | Effect at start |
|----------|-------|-----------------|
| **Habitat** | 1 | Generates **15 kW**, draws 2 kW, **250m** minimap bubble, starter refinery at 3/s |
| **Landing Pad** | 1 | Draws 2 kW idle / **5 kW** servicing. **500-unit fuel tank, starts full** |

The pad's tank is the fuel a fresh game runs on. There is no Fuel Depot yet, so there is no colony fuel storage to draw on — those 500 units are the budget for finding the first Bitite. Once found, the Habitat's starter refinery turns it into fuel and pushes it straight back into the pad's tank, and the loop closes.

That is **15 kW supplied against a 7 kW peak** — 8 kW of headroom. The Habitat exists to make the opening move self-sufficient: you can land, repair, recharge and see a small patch of minimap before mining a single ore.

**The early power ladder.** Headroom is spent deliberately, and every step of the opening is payable in **Basic** material (Iron/Copper, available in the first cave layer). Nothing in the opening is gated behind Industrial, which only exists below 1385m — the player must never need the deep layers to build the antenna that lets them navigate to the deep layers.

| Step | Added draw | Running peak | vs. 15 kW supply |
|------|-----------|--------------|------------------|
| Start (Habitat + Pad) | — | 7 kW | 8 kW spare |
| **+ Comm Antenna** (20 Basic) | 5 kW | 12 kW | 3 kW spare — fits, but eats most of the slack |
| + Ore Storage, Fuel Depot, Parts Warehouse | 3 kW | 15 kW | **exactly at the line** |
| **+ Fuel Refinery** | 15 kW active | 30 kW | **Deficit — must raise supply first** |

The Refinery is the first real power decision, and it has two honest answers rather than a ladder:

- **Solar Array** (1 Industrial, +10 kW) — free to run forever, but weak, and its output falls to zero by 60m depth.
- **Fuel Generator** (20 Basic, +50 kW) — cheap, five times stronger, works at any depth, but burns **0.4 fuel/s at full load**: roughly 24 fuel per minute, or half a Scout's tank every ten minutes. It converts your flight range into electricity.

The tutorial hint fires the moment *planned* demand exceeds supply, while the building is still a placement ghost — never after the base has already browned out.

---

## 6. Networks & Cables

Every base runs on **three independent networks** over the same set of buildings. They share nothing: a building can have perfect power and still be starved of fuel, and a data link carries no power. The colour *is* the network — this is the single most important thing a new player has to learn, and the UI teaches it rather than assuming it.

| Colour | Network | Carries | Item name in menus |
|--------|---------|---------|--------------------|
| 🔴 **Red** | **Power Grid** | kW of electricity | **Power Cable (Red)** |
| 🟢 **Green** | **Fuel Line** | Refined fuel | **Fuel Pipe (Green)** |
| 🔵 **Blue** | **Data Net** | Radar/minimap data | **Data Cable (Blue)** |

Naming rule: **function first, colour second**, everywhere in the UI — "Power Cable (Red)", never "Red Cable". Green is a *pipe*, not a cable, so its own name says what it does.

### 6.1 Craftable Items
Crafted at the Landing Pad or Crafting Station when materials are available.

| Item | Cost | Use |
|------|------|-----|
| **Power Cable (Red)** | 20 Basic | Distributes electricity |
| **Fuel Pipe (Green)** | 20 Basic | Moves refined fuel |
| **Data Cable (Blue)** | 20 Basic | Merges radar networks |
| **Light** | 20 Basic | Environmental lighting (needs power) |

### 6.2 Placement & Constraints
- **Ports, not walls**: cables attach to a building's **connection ports**, not to arbitrary points. Each building has one port per network it can use, drawn as a small coloured dot at its base.
- **Length Limit**: a single cable *run* spans at most **120m**. Longer distances are chained: attach, walk on, attach again. Each attach consumes 1 Basic material.
- **Spools**: a player carrying a live line can drop it as a physics spool and come back for it, letting two players cable toward each other and meet in the middle.
- **Type matching**: a green pipe cannot be attached to a red port. The attempt is rejected with the reason shown on screen (`cable type mismatch`), not silently ignored.
- **Severance (optional, later)**: falling rocks and meteor strikes can cut a run. The break renders as a sparking gap and the downstream sub-network goes dark until repaired.

### 6.3 Power Grid (Red)

**Model: flow, not stockpile.** Power is measured in **kW** and is generated and consumed continuously. A grid works if `supply ≥ demand` at that instant. A small **buffer** (in kJ) absorbs short spikes so that a refinery kicking in does not instantly kill the lights.

| Building | Generates (L1) | +/level | Draw (idle) | Draw (active) | Draw +/level |
|----------|---------------|---------|-------------|---------------|--------------|
| **Habitat** | 15 kW | +5 | 2 kW | 2 kW | +1 |
| **Solar Array** | 10 kW ☀ | +5 | — | — | — |
| **Fuel Generator** | 50 kW | +25 | — | — | — |
| **Landing Pad** | — | — | 2 kW | 5 kW | +2 |
| **Ore Storage** | — | — | 1 kW | 1 kW | +0.5 |
| **Fuel Depot** | — | — | 1 kW | 1 kW | +0.5 |
| **Parts Warehouse** | — | — | 1 kW | 1 kW | +0.5 |
| **Fuel Refinery** | — | — | 3 kW | 15 kW | +5 |
| **Comm Antenna** | — | — | 5 kW | 5 kW | +2 |
| **Ship Factory** | — | — | 4 kW | 20 kW | +10 |
| **Crafting Station** | — | — | 2 kW | 10 kW | +5 |
| **Placeable Light** | — | — | 1 kW | 1 kW | — |

**Generator rules**
- **Habitat** is self-powering — it never needs a red cable and can never be shed. It is the reason a fresh base works at all.
- **Solar Array** ☀ output scales with sunlight: **100% at the surface, falling linearly to 0% at 60m depth**. Free to run and never runs dry, but weak, and useless underground.
- **Fuel Generator** burns **0.4 fuel/second at full 50 kW load**, scaled by actual load. It needs a green connection to a fuel source, or a hand-filled 100-unit internal tank, and works at any depth.

The two are not a ladder — they are a standing trade. Solar is free power you can never lose; the Generator is five times the output for a resource that is also your ability to fly home. A deep outpost has no choice but the Generator, which is precisely why deep bases are expensive to hold.

**Grid buffer** — capacity 100 kJ from the Habitat (+50/level), +50 per Solar Array, +100 per Fuel Generator. Surplus charges it, deficit drains it. A 10 kW deficit empties a 100 kJ buffer in 10 seconds — long enough to notice the warning, short enough to matter.

**Brownout & load shedding.** When the buffer hits zero and demand still exceeds supply, buildings are shut off one at a time, lowest priority first, until the grid balances. Shed buildings restart automatically once there is headroom.

> Shed order: Placeable Lights → Crafting Station → Ship Factory → Fuel Refinery → Ore Storage → Parts Warehouse → Fuel Depot → Comm Antenna → Landing Pad → *(Habitat never sheds)*

The order is deliberate: the last things to die are the ones that get a stranded player home. Losing the antenna before the pad means the minimap goes to static as a warning *before* refuelling stops.

### 6.4 Fuel Line (Green)

Fuel is produced in one place and consumed in several, and green pipe is what connects them.

- **Fuel Refinery** converts Bitite into fuel (yield 8 fuel/unit) into a **200-unit internal buffer**. As in §5.1 this conversion runs at a baseline rate even with no Refinery built; the Refinery multiplies the rate and adds the buffer.
- If that buffer fills and there is **no green connection to a depot or pad**, Bitite processing **stalls** — the refinery reports `output full`. Ore→material refining is unaffected and continues.
- **Fuel Depot** stores 2000 units at L1 (+5000/level) and is the network's tank.
- **Landing Pad** holds a **500-unit** local tank and dispenses to landed ships. It refuels from its own tank plus anything reachable over green pipe. **A pad with no fuel reachable cannot refuel, even at full power.**
- **Fuel Generator** draws from the same network to make electricity.
- **Throughput**: 20 units/second per run. Fuel flows automatically from surplus nodes to deficit nodes; the player never routes it manually.

This makes fuel logistics the reason to go underground with green pipe: a deep outpost's Landing Pad is only useful for refuelling if fuel can physically reach it.

### 6.5 Data Net (Blue)
Covered in full in §7. In short: blue cable carries no power and no fuel — it only merges the radar coverage of the antennas it links.

### 6.6 Reading the Networks (UI)

The building sprites are static, so **all network state is communicated by UI overlay**. Nothing about a building's connection status is baked into its art.

**1. Port dots.** Every building draws up to three small dots along its base — red, green, blue, left to right — one per network it can use.

| Dot | Meaning |
|-----|---------|
| ● **Solid, lit** | Connected and supplied |
| ◐ **Amber, pulsing** | Connected, but starved — grid is browning out, or the fuel network is dry |
| ○ **Hollow red outline** | Required by this building, not connected |
| *(no dot)* | This building does not use that network |

**2. Cable-carrying mode.** While a player holds a live cable, the world dims slightly and tints toward that cable's colour, and **only valid ports of that colour glow and pulse**. Ports of the other two networks are dimmed out entirely. A player carrying green pipe physically cannot see a red port as a target — which is how they learn what green is for, without reading a manual.

**3. Building tooltip.** Looking at or hovering a building shows its live numbers: `Fuel Refinery Lv2 — 15 kW drawn — Bitite 12/s — Output 187/200`.

**4. Base Grid panel** (in the station/build menu):
```
POWER    ████████░░  18 / 22 kW      Buffer ▓▓▓▓▓▓░░ 62 kJ
FUEL     ██████░░░░  1240 / 2500     +6.2/s
DATA     Net "Home"  3 antennas · 340m coverage
```
Amber when strained, red and flashing when shedding, with the name of the building that just shut off.

**5. Network Overlay** (hold **N**). The world desaturates and the three graphs draw on top of it in colour, with every run labelled by what it carries and every node labelled by supply/draw. This is the debugging view for a base that has grown past a glance.

**6. Audible cues.** Existing `power_down.mp3` plays on a shed event; a low hum loop indicates a browning-out grid.

---

## 7. Antenna & Radar Systems

Minimap visibility is tied to **Comm Antennas**, the power that runs them, and the **Data Net** that links them.

### 7.1 Coverage
- **Comm Antenna**: radius **100m at Level 1, +100m per level thereafter** (L1 100m, L2 200m, L3 300m, L4 400m), requires **power**. An unpowered or shed antenna provides nothing.
- **Habitat**: fixed, non-upgradeable **250m** bubble. Also requires power (it powers itself, so this is free in practice). The radius is set to cover the whole landing pad deck — the Habitat stands 136 units from the pad centre, so anything smaller would leave a fresh game with no minimap at its own base.
- **Landing Pad**: no coverage of its own.

Coverage is per-antenna and positional. There is no global "antenna range" — a base's reach is the union of the bubbles of its own powered antennas.

### 7.2 Live Signal vs. Explored Terrain
Two different things are drawn on the minimap and they must not be confused:

- **Explored terrain** is permanent. Once a chunk has been visited it stays on the minimap forever, drawn **dim and desaturated** — this is *memory*, not a live feed. It does not depend on antennas.
- **Live signal** is everything happening *now*: player positions, ship positions, wreckages, dropped cargo, hazards. It is drawn **bright**, and it only appears inside the coverage of an antenna on **the viewing player's own data net**.
- **No signal**: a player outside all of their network's coverage sees dim explored terrain under heavy static, with no live blips at all — including their own teammates.

### 7.3 Data Sharing
An antenna with power but no blue cable is an **island**: it works for whoever is inside its bubble, but its feed is private to its own network.

Connecting two antennas with **Data Cable (Blue)** merges them into one **Data Net**. Every player viewing from any antenna in that net sees the live feed of *all* antennas in it.

> **Worked example.** Anna is at the surface base near Antenna A. Bo is 900m down beside Antenna B at his own outpost. Both antennas are powered. Neither sees the other on the minimap — they are on separate data nets. Bo hauls blue cable up the shaft and links B to A. The instant the last run attaches, both minimaps light up: Anna sees Bo's blip 900m down, Bo sees the surface. Cutting that cable — or browning out either antenna — separates them again.

Buildings on the connected network render as **red rectangles** on the minimap for every player in that net.

**Design intent**: the Data Net is what turns a solo descent into a coordinated one. Running blue cable down a shaft is a real investment of materials and time, and the payoff is that the team can finally see each other.

---

## 8. Procedural Cave Generation

### 8.1 Biomes & Depth (5000m Total)

Depth comes from `VoxelMap.getDepthMeters()`: the surface is **0m** and the bottom of the map is **5000m**. The **Scaling** column is normalized depth, which is what the renderer actually switches biomes on.

| Biome | Depth Range | Scaling | Hazards | Resources |
|-------|-------------|---------|---------|-----------|
| **Surface** | 0 - 750m | 0 - 0.15 | Meteor Showers | Iron (from 50m) |
| **Shallow Caves** | 750 - 1500m | 0.15 - 0.30 | Loose Rocks falling down | Iron, Copper |
| **Deep Tunnels** | 1500 - 2500m | 0.30 - 0.50 | Flammable Gas Pockets | Silver, Titanium |
| **Crystal Caverns**| 2500 - 3500m | 0.50 - 0.70 | Falling Stalactites | Gold, Titanium, Bitite |
| **Abyssal Depths** | 3500 - 4250m | 0.70 - 0.85 | Lava, Extreme Heat* | Platinum, Gold, Helium-3 |
| **The Core** | 4250 - 5000m | 0.85 - 1.0 | Radiation*, Static | Diamond, Helium-3, Platinum |

*\*Requires specific ship shielding upgrades to survive.*

**Win line**: 4700m (normalized 0.94), inside The Core.

**Ore bands** are authored in *tile* depth below the local surface, not metres — `VoxelMap.generateOres()`. Converted to the scale above, with ~1016 tiles of playable depth:

| Ore | Tile band | ≈ Depth | Biomes reached |
|-----|-----------|---------|----------------|
| Iron | 10 - 400 | 50 - 1970m | Surface → Deep Tunnels |
| Copper | 50 - 250 | 250 - 1230m | Surface → Shallow |
| Bitite | 100 - 850 | 490 - 4180m | Surface → Abyssal |
| Silver | 200 - 500 | 980 - 2460m | Shallow → Deep Tunnels |
| Titanium | 400 - 700 | 1970 - 3450m | Deep Tunnels → Crystal |
| Gold | 600 - 850 | 2950 - 4180m | Crystal → Abyssal |
| Platinum | 600 - 1000 | 2950 - 4920m | Crystal → Core |
| Diamond | 900 - 1200 | 4430 - 5000m | Core only |
| Helium-3 | 800 - 1200 | 3940 - 5000m | Abyssal → Core |

Note that **Bitite stops at ~4180m**, so the deepest 800m of the descent has no fuel source in it. §10.1's claim that Bitite is found at all depths is not true of the current bands — a run to the Core has to carry its return fuel through the last stretch. That is a reasonable difficulty spike, but it is currently an accident rather than a decision.

---

## 9. Ship Classes & Upgrades

### 9.1 Ship Classes
Ships have 4 upgrade levels corresponding to the crafting material tiers.

| Feature | **Scout** (Standard) | **Cargo Hauler** | **Astronaut** (EVA) |
|---------|-----------------------|------------------|---------------------|
| **Cost** | Free (Starting) | 50 Industrial Mats | N/A |
| **Fuel** | 500 units | 1000 units | N/A |
| **Inventory** | 3 slots | 6 slots (2x3 grid) | 1 slot |
| **Special** | High Agility | Low Agility, Heavy | Oxygen-Limited |

### 9.2 Ship Upgrades
Each ship can be upgraded at the **Ship Factory** through 4 levels.

| Upgrade Level | Material Required | Cost |
|---------------|-------------------|------|
| **Level 1** | Basic | 5 Materials |
| **Level 2** | Industrial | 5 Materials |
| **Level 3** | Advanced | 5 Materials |
| **Level 4** | Quantum | 5 Materials |

**Upgradable Systems:**
- **Power Gen**: +25% Regen speed
- **Thrust Force**: +20% Thrust power
- **Max Fuel**: +33% Fuel tank size
- **Laser Efficiency**: -20% Mining Power draw
- **Spotlight**: +50m Light range

---

## 10. Resource Economy

### 10.1 Ore Types & Distribution
All higher tier ores are refined into their primary material plus a fraction of lower tier materials.

| Resource | Biome | Yield Type | Primary Material | Bonus Output |
|----------|-------|------------|------------------|--------------|
| **Iron** | Shallow | High | Basic (100%) | None |
| **Copper** | Shallow | Low | Basic (100%) | None |
| **Silver** | Deep | High | Industrial (90%) | Basic (10%) |
| **Titanium** | Deep | Low | Industrial (90%) | Basic (10%) |
| **Gold** | Abyss | High | Advanced (80%) | Industrial (10%), Basic (10%) |
| **Platinum** | Abyss | Low | Advanced (80%) | Industrial (10%), Basic (10%) |
| **Diamond** | Core | High | Quantum (70%) | Advanced/Ind/Basic (10% each) |
| **Helium-3** | Core | Low | Quantum (70%) | Advanced/Ind/Basic (10% each) |
| **Bitite** | All | Med | Fuel | N/A |

**Refining Yields:**
- Yield per ore increases with **Fuel Refinery** level.
- High yield ores (Iron, Silver, Gold, Diamond) provide more materials per unit than Low yield ores.
- Bitite is found at all depths to ensure fuel availability.

### 10.2 Cargo Physics
- **Mass Scaling:** Each unit of cargo adds `0.002` to ship mass.
- **Risk:** 75% of cargo is lost on destruction; 25% persists in a salvageable wreckage.

---

## Appendices

### A: Control Scheme
- **W / Up**: Main Thrust (Ship) / Jump (EVA)
- **A / D**: Rotate (Ship) / Walk (EVA)
- **Space**: Mine Ore (Hold)
- **G**: Toggle Tether / Hook
- **K / L / H**: Toggle Position Lights / Spotlight / Antenna
- **Q / B**: Inventory / Build & Station Menu
- **J / T**: Jettison Cargo / Transfer Mode
- **N (hold)**: Network Overlay — power / fuel / data graphs and antenna coverage (§6.6)

### B: Glossary
- **Bitite**: Lunar hydrocarbon used for fuel synthesis.
- **RCS**: Reaction Control System (thrusters for rotation).
- **DLA**: Diffusion-Limited Aggregation (the cave generation algorithm).
- **Base Bus**: The implicit connection covering buildings on a Landing Pad's deck (§5.2).
- **Data Net**: A set of antennas merged by blue cable, sharing one live minimap feed (§7.3).
- **Shedding**: Automatic shutdown of low-priority buildings when a power grid runs a deficit (§6.3).

---

### C: Implementation Delta

The **server-side network logic in §6 and §7 is implemented** in `server/game/NetworkSystem.js`. This section records what was built, what is still outstanding, and the bugs fixed along the way.

**Implemented (server):**

- `NetworkSystem` resolves three independent graphs (power / fuel / data) over the built buildings using union-find, with the **Base Bus** rule of §5.2 and typed cable runs as edges.
- **Power** is now flow in kW with a kJ buffer, per-building idle/active draw, solar output scaled by depth, fuel-generator burn scaled by load, and priority **load shedding** with hysteresis so the grid cannot flicker.
- **Fuel** flows from sources to landing-pad and generator tanks over green cable; a refinery with nowhere to put its output stalls; a pad with no reachable fuel cannot refuel a ship even at full power.
- **Data** nets merge over blue cable; coverage is per-antenna and requires power; each player's current data net is resolved server-side and attached to their entry in `getState()`.
- The **Habitat** now exists at Level 1 with a position, as generator, 250m antenna and starter refinery. The **Landing Pad** also has a position for the first time, so both can act as cable endpoints.

**Implemented (client, §6.6):**

- **Port dots** under every building — solid = supplied, pulsing amber = connected but starved, hollow red = required and not connected, absent = not used. Drawn as an overlay, so the static sprites are untouched. Shed and unconnected buildings also get a word, not just a colour.
- **Cable-carrying mode** dims and tints the world to the held cable's colour and highlights only ports of that network; in-range ports pulse and are named, out-of-range ports stay faint.
- **Base Grid panel** in the station overview: supply vs demand in kW, buffer in kJ, what is currently being shed, pad fuel and colony reserve, and the data net summary.
- **Network Overlay** on hold **N**: desaturates the world, draws antenna coverage per data net, and labels every building with its generation and draw.
- **Run-length meter** while laying cable, showing metres used of the 120m maximum and turning red past it.

**Still outstanding:**

1. ~~Buildings are not instances.~~ **Done.** `Game.structures` is now the source of truth: every building is a placed instance with its own id, level and position. `Game.buildings` survives as the per-type definition table, with its `level` kept in sync as the highest level among that type's instances so older call sites still work. The first instance of a type keeps the bare type name as its id (`landing_pad`), later ones get `landing_pad#2`, which preserved every existing network node id. The claim that `collectNodes()` was the only enumeration point held up — the migration touched 4 call sites.
2. ~~Base Bus radius is 1400.~~ **Done.** It now follows the Landing Pad build radius. The wide radius had become actively wrong once placement worked: it auto-connected a second base 1200 units away that should have needed a cable run.
3. **Cable severance** (§6.2, optional) is not implemented.
4. **Buildings are not hauled.** GDD 5.2 says buildings occupy 2x2 cargo slots and must be flown to the site. They are currently placed from the build menu, paying from base materials. The placement, zone and connectivity rules are all real; only the hauling loop is missing.
4. **Spool physics is unchanged.** `dropLine` still creates a physics box with a crude spring past `MAX_LENGTH`. The crash bugs in the spool path are fixed (items 7-8 below) but the rope simulation itself was deliberately left alone — it is not on the critical path to working cables, and rewriting it is a separate piece of work.

**Bugs found and fixed during implementation:**

5. **Every cable action ran twice.** `index.js` registered *two* `'cableAction'` socket listeners — one calling `cableSystem` directly, one calling `Game.handleCableAction()`. Both fired on every click, so each action placed two segments and charged twice. The duplicate listener and the now-dead `handleCableAction()` are removed.
6. `Game.placeCableSegment` called `this.cableSystem.addSegment(...)`, which did not exist and threw. `addSegment()` is now implemented with length and type validation.
7. `CableSystem.attachLine` read `spool.x` / `spool.y` in the spool-connect branch, but those were only written by `update()`. A spool connected before its first physics tick read `undefined` and the distance check yielded `NaN`. Spool position is now seeded at drop time.
8. `CableSystem.pickupSpool` discarded `anchorId`, so a picked-up line forgot which building it came from. Now preserved.
9. Cable types arrived as `'power'/'fuel'/'data'` from the client but `'cable_red'/'cable_green'/'cable_blue'` from crafted items, and were compared with `===`. All types now normalise through `normalizeCableType()` at the boundary.
10. Attaching a cable to a building left the player's line live, so runs never terminated cleanly. Attaching to a building now ends the run; attaching to bare rock still chains.
11. **Cable targeting ignored the player entirely.** `getNearestInteractable()` matched any building within 50 units of the *mouse*, anywhere on the map. Two clicks could wire two buildings a kilometre apart, so walking a cable out never mattered and the whole mechanic was pointless. Targeting now requires the player to be within `CABLE_ATTACH_RANGE` (90) of the connector, enforced again on the server at 130 to allow for latency.
12. **Every cable failure was silent.** The client passed no acknowledgement callback, so `no_materials`, `too_long` and `cable_type_mismatch` all looked identical: nothing happened. All failures now surface as an on-screen reason.
13. Holding no cable and clicking did nothing with no explanation — the most common first experience. It now says what to craft and how to select it.
14. The cursor could target buildings that do not use the held network. Green pipe no longer offers a power-only building as a target.
**Known issues left alone (reported, not fixed):**

11. `buildingCosts` for `fuel_refinery`, `solar_array` and `ship_factory` (Game.js:151-175) define **12** levels, but `canAffordUpgrade` caps at level 4 (Game.js:233). Entries 5-12 are dead. The build costs in §5.3 have been corrected to match the costs actually used at runtime rather than the old table's values: **Refinery 2 Industrial, Solar 1 Industrial, Factory 5 Industrial** (from the overrides), and **Fuel Generator 20 Basic** — the generator has *no* override, so it falls through to `generateCost(20, …)` and costs Basic, not the 20 Industrial the old table claimed. §5.4 and §6.3 are balanced around the 20 Basic figure.
12. `getBuildingEffect` (Game.js:212) computes `baseValue + level·perLevel`, so a Level 1 building already gets one increment above its base value. The comment block shows the intended formula was `base + (level-1)·perLevel` and was never resolved. It still governs storage capacities. `NetworkSystem` deliberately does **not** use it — all power, fuel and data scaling is computed from the level directly with the `(level-1)` convention, so the two do not have to be reconciled before the network logic is correct.

**Naming collision — not a contradiction, do not "unify":**

13. `config.difficulty.cableMaxLength` (150) sounds like it governs cables but is only ever read for the **tether** (Player.js:121, Game.js:1958). The build-cable limit is separate and is now `difficulty.buildCableMaxLength`, defaulting to 120. Two different systems were sharing one badly-named key; `cableMaxLength` should be renamed `tetherMaxLength` when the tether is next touched.
14. `config.difficulty.powerGenerationMultiplier` / `powerConsumptionMultiplier` apply **only to ship/player power** (Player.js:71-80), never to base power. Base-grid difficulty scaling does not exist.

**Numbers that changed during implementation:**

15. **Habitat generation is 15 kW**, not the 10 kW first drafted, so the opening ladder in §5.4 closes: the first Comm Antenna must be affordable and powerable using **Basic** material only, since Industrial ore does not appear above 1385m and the antenna is what makes navigating to 1385m viable.
16. **Habitat antenna range is 250m**, not the 50m first drafted. Measured in the running game, the Habitat sits 136 units from the pad centre and the pad bounds extend ~90 further; a 50m bubble left a fresh game with no minimap at its own base.
17. **Refining is attributed to the Habitat's built-in refinery** (3/s) rather than to an abstract baseline, with the Fuel Refinery as a much faster, power-hungry addition (8/s). Same softlock protection, clearer fiction, and it gives the Fuel Refinery a distinct late-game role.
18. The build radius was **200m** in §5.2 and **~80m** in the §5.3 notes. Code has `baseValue: 200`. Standardised on **200m** — though see outstanding item 2 for why the Base Bus does not yet use it.

---

## Development History (Legacy Batches)
- **v1.10**: Server implementation of the three networks (`NetworkSystem.js`) — graph resolution, load shedding, fuel flow, data-net merging. Habitat starter refinery, landing pad starting fuel. Fixed duplicated cable actions.
- **v1.9**: Three-network model (power/fuel/data), per-building power budget, Base Bus, Habitat as starting generator, data-net minimap gating, network status UI, implementation delta.
- **v1.7**: Base building radius, Cable mechanics, Antenna network update.
- **v1.6**: Power system, Bitite refinement, 4-tier materials.
- **v1.5**: Cooperative tethering, survival pods, ping system.
- **v1.0-1.4**: Core physics, multiplayer rooms, biomes, and UI foundations.

---
*Document Version: 1.12*
*Last Updated: August 3, 2026*
