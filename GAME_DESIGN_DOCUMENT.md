# Moonlander.io - Game Design Document
## A Cooperative Lunar Exploration Experience

---

# Development Requests 1
- Don't open the base menu automatically when player is close to the landing pad


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
Reach the core at 5000 meters depth. Show a victory screen with the amount of ore collected and the time taken to reach the core and the number of deaths. 

### Game lose condition
No alive player and no resources left to spawn a new lander. Show a game over screen with the amount of ore collected and the time taken to reach the core and the number of deaths.

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

### 5.1 Building Materials
Resources are processed into four tiers of construction materials at the **Crafting Station**:

| Tier | Name | Composition (Input) | Primary Use |
|------|------|-------------------|-------------|
| 1 | **Basic** | 50 Iron + 50 Copper | Level 0-3 Buildings, Scout Repairs |
| 2 | **Industrial** | 100 Silver + 100 Titanium | Level 4-6 Buildings, Cargo Hauler Upgrades |
| 3 | **Advanced** | 200 Gold + 200 Platinum | Level 7-9 Buildings, Ship Tech |
| 4 | **Quantum** | 500 Diamond | Level 10-12 Buildings, End-game Tech |

### 5.2 Building Anywhere
Players can build bases anywhere in the cave system if they carry the required construction materials. 

1. **The Anchor (Landing Pad)**: To start a new base, a **Landing Pad** must be placed first.
2. **Building Radius**: The Landing Pad generates a **200m radius** building zone. This radius is visually highlighted when the building menu is open.
3. **Resource Network**: All buildings within the same Landing Pad's radius automatically share resources. A **Fuel Depot** in range makes fuel available at the Landing Pad. 
4. **Power Requirement**: Every building (except the Solar Array/Fuel Generator) requires power to function. A Landing Pad with no power connected will not provide repair/refuel/charge services to landed ships. 

### 5.3 Building Catalog & Costs
New buildings start at Level 0. Upgrading increases their efficiency and power draw.

| Building | Build Cost (Lvl 0) | Upgrade Per Level (1-12) | Power Req (Base) | Power Scaling |
|----------|-------------------|-------------------------|------------------|---------------|
| **Landing Pad** | 2 Basic | 1 Mat of current Tier | 5 kW | +2 kW/lvl |
| **Habitat** | 1 Basic | 1 Mat of current Tier | 2 kW | +1 kW/lvl |
| **Ore Storage** | 1 Basic | 1 Mat of current Tier | 1 kW | +0.5 kW/lvl |
| **Fuel Depot** | 1 Basic | 1 Mat of current Tier | 1 kW | +0.5 kW/lvl |
| **Parts Warehouse**| 1 Basic | 1 Mat of current Tier | 1 kW | +0.5 kW/lvl |
| **Fuel Refinery** | 2 Industrial| 2 Mat of current Tier | 15 kW | +5 kW/lvl |
| **Solar Array** | 1 Industrial| 1 Mat of current Tier | generates 10kW | +5 kW/lvl |
| **Fuel Generator**| 2 Industrial| 1 Mat of current Tier | generates 50kW | +25 kW/lvl |
| **Comm Antenna** | 1 Basic | 1 Mat of current Tier | 5 kW | +2 kW/lvl |
| **Ship Factory** | 5 Industrial| 3 Mat of current Tier | 20 kW | +10 kW/lvl |
| **Crafting Station**| 2 Basic | 2 Mat of current Tier | 10 kW | +5 kW/lvl |

---

## 6. Cable Mechanics

Cables are physical ropes that connect different bases or remote buildings, enabling resource and data sharing across long distances.

### 6.1 Cable Types
1. **Power Cable (Red)**: Shares electricity between connected Landing Pads/Buildings.
2. **Fuel Cable (Green)**: Shares fuel between connected Landing Pads/Depots.
3. **Data Cable (Blue)**: Shares radar and antenna information between connected Landing Pads.

### 6.2 Placement & Constraints
- **Connection Points**: Cables connect primarily between **Landing Pads**, which act as the central distribution switch for each local base. 
- **Wall Attachment**: Cables can be "stapled" to cave walls to guide them around corners.
- **Length Limit**: A single cable section has a maximum length of **120 meters**.
- **Installation**: Players must craft the specific cable type (1 Material per 100m) and have them in their inventory or quickbar to start placing.

---

## 7. Antenna & Radar Systems

Minimap visibility is tied to the **Communications Antenna** and the **Data Cable** network.

### 7.1 Minimap Range
- **Local Coverage**: Any antenna built provides a minimap radius (100m + 100m/level).
- **No Signal**: If a player is outside of *any* active antenna range, their minimap is replaced with static. 
- **Habitat Utility**: The Habitat building provides a small, non-upgradeable 50m antenna range.

### 7.2 Data Sharing
Connecting two bases with a **Data Cable (Blue)** merges their radar networks. 
- Players in range of Antenna A can see the fog of war cleared around Antenna B.
- All buildings in the connected network are displayed as **Red Rectangles** on the minimap for all players.

---

## 8. Procedural Cave Generation

### 8.1 Biomes & Depth (5000m Total)
| Biome | Depth Range | Scaling | Hazards | Resources |
|-------|-------------|---------|---------|-----------|
| **Surface** | 0 - 510m | 0-0.102 | Meteor Showers | None |
| **Shallow Caves** | 510 - 1385m | 0.1-0.27 | Loose Rocks falling down | Iron, Copper |
| **Deep Tunnels** | 1385 - 2255m | 0.27-0.45| Flammable Gas Pockets | Silver, Titanium |
| **Crystal Caverns**| 2255 - 3130m | 0.45-0.62| Falling Stalactites | Gold, Bitite |
| **Abyssal Depths** | 3130 - 4000m | 0.62-0.8 | Lava, Extreme Heat* | Platinum |
| **The Core** | 4000 - 5000m | 0.8-1.0 | Radiation*, Static | Diamond, Helium-3 |

*\*Requires specific ship shielding upgrades to survive.*

---

## 9. Ship Classes & Upgrades

### 9.1 Ship Classes
| Feature | **Scout** (Standard) | **Cargo Hauler** | **Astronaut** (EVA) |
|---------|-----------------------|------------------|---------------------|
| **Cost** | Free (Starting) | 10 Industrial Mats | N/A |
| **Fuel** | 500 units | 1000 units | N/A |
| **Cargo Capacity** | 500 units | 1500 units | 50 units |
| **Special** | High Agility | Low Agility, High Mass | Oxygen-Limited (~67s) |

### 9.2 Ship Upgrades
Each ship can be upgraded at the **Ship Factory**. Upgrades have exactly **3 levels**.

| Upgrade | Level 1 Cost | Level 2 Cost | Level 3 Cost | Benefit per Level |
|---------|--------------|--------------|--------------|-------------------|
| **Power Gen** | 1 Basic | 1 Industrial | 1 Advanced | +25% Regen speed |
| **Thrust Force** | 2 Basic | 2 Industrial | 2 Advanced | +20% Thrust power |
| **Max Fuel** | 1 Basic | 1 Industrial | 1 Advanced | +33% Fuel tank size |
| **Laser Efficiency**| 1 Basic | 1 Industrial | 1 Advanced | -20% Mining Power draw |
| **Spotlight** | 1 Basic | 1 Industrial | 1 Advanced | +50m Light range |

---

## 10. Resource Economy

### 10.1 Ore Types & Distribution
| Resource | Primary Biome | Processing | Use |
|----------|---------------|------------|-----|
| **Iron/Copper** | Shallow | Basic Tier | Base Repairs, Tier 1 Buildings |
| **Bitite** | All Caves | Fuel Refinement| Ship & Base Fuel |
| **Silver/Titanium**| Deep Tunnels | Indust. Tier| Tier 2 Buildings, Advanced Shells |
| **Gold/Platinum** | Abyssal | Adv. Tier | Tier 3 Buildings, Electronics |
| **Diamond/He-3**| The Core | Quantum Tier| End-game Upgrades, Fusion Power |

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

### B: Glossary
- **Bitite**: Lunar hydrocarbon used for fuel synthesis.
- **RCS**: Reaction Control System (thrusters for rotation).
- **DLA**: Diffusion-Limited Aggregation (the cave generation algorithm).

---

## Development History (Legacy Batches)
- **v1.7**: Base building radius, Cable mechanics, Antenna network update.
- **v1.6**: Power system, Bitite refinement, 4-tier materials.
- **v1.5**: Cooperative tethering, survival pods, ping system.
- **v1.0-1.4**: Core physics, multiplayer rooms, biomes, and UI foundations.

---
*Document Version: 1.8*
*Last Updated: January 26, 2026*
