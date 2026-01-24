# Moonlander.io - Game Design Document
## A Cooperative Lunar Exploration Experience

---

## Table of Contents
1. [Game Overview](#game-overview)
2. [Core Philosophy](#core-philosophy)
3. [Cooperative Gameplay Systems](#cooperative-gameplay-systems)
4. [Physics-Based Mechanics](#physics-based-mechanics)
5. [Moon Base System](#moon-base-system)
6. [Procedural Cave Generation](#procedural-cave-generation)
7. [Collision & Damage System](#collision--damage-system)
8. [Resource Economy](#resource-economy)
9. [Progression Systems](#progression-systems)
10. [Technical Architecture](#technical-architecture)

---

## Game Overview

**Moonlander.io** is a cooperative multiplayer physics-based exploration game where players pilot lunar landers into the depths of a procedurally generated moon. Starting from a shared moon base on the surface, teams of 2-8 players venture into an ever-deepening cave system to extract resources, rescue stranded companions, and uncover the mysteries buried deep within the lunar crust.

### Core Gameplay Loop
1. **Prepare** - Outfit your lander at the moon base with fuel, equipment, and supplies
2. **Descend** - Navigate treacherous cave systems with your team
3. **Extract** - Mine resources from cave walls and collect artifacts
4. **Survive** - Manage fuel, hull integrity, and subsystem damage
5. **Return** - Bring resources back to upgrade the moon base
6. **Repeat** - Venture deeper into increasingly challenging depths

### Genre & Inspiration
- Physics-based flight simulation meets cooperative survival
- Inspired by: Lunar Lander (1979), Deep Rock Galactic, Astroneer, Spelunky

---

## Core Philosophy

### The "One More Run" Loop
Every expedition should feel like a calculated risk. Players push deeper for better rewards but risk losing their cargo if they can't make it back. The tension between greed and survival creates memorable moments.

### Emergent Cooperation
The best co-op moments aren't scripted - they emerge from systems. When a player runs out of fuel in a deep cavern, their teammate must make the decision: risk everything to save them, or abandon them to preserve the resources already collected.

### Physics as Gameplay
The Ammo.js physics engine isn't just for show - it's the core of every interaction. Towing, collisions, rope swings, cargo physics, and environmental hazards all leverage real physics simulation for authentic, emergent gameplay.

---

## Cooperative Gameplay Systems

### 3.1 Tether & Tow System

The tether system is the heart of cooperative play, implemented using Ammo.js rope/constraint physics.

#### Tether Mechanics
```
TETHER PROPERTIES:
- Maximum Length: 150 units (upgradeable to 300)
- Tensile Strength: 500N before snap (upgradeable)
- Elasticity: 15% stretch before tension damage
- Attachment Points: Front, Rear, Top, Bottom of each lander
```

#### Towing Operations

**Fuel Rescue Tow**
When a player runs out of fuel, they become dead weight - literally. Their lander's mass remains, requiring significant thrust from the towing player.

| Tow Scenario | Fuel Cost Multiplier | Speed Penalty |
|--------------|---------------------|---------------|
| Empty lander (no cargo) | 1.8x | -40% |
| Loaded lander (half cargo) | 2.5x | -60% |
| Fully loaded lander | 3.5x | -75% |

**Precision Towing**
- Towed landers swing realistically based on thrust vectors
- Sharp turns cause dangerous pendulum effects
- Skilled pilots can use momentum to "crack the whip" through tight passages

**Emergency Detach**
Players can emergency-detach at any time. The towed lander maintains its momentum - useful for:
- Slingshotting into resource-rich areas
- Emergency escape from cascading cave-ins
- Strategic positioning in tight spaces

#### Tether Combat Applications
- Wrap tethers around obstacles for momentum control
- Create tripwires for environmental hazards
- Pull unstable structures onto pursuing threats

### 3.2 Formation Flying

Teams can link multiple landers for coordinated movement.

**Chain Formation**
```
[Lander A] ---- [Lander B] ---- [Lander C]
    ^               ^               ^
  Leader         Middle          Anchor
```
- Leader provides primary thrust and navigation
- Middle landers can assist or conserve fuel
- Anchor provides stability and braking

**Diamond Formation**
```
        [Scout]
           |
    [Left]   [Right]
           |
       [Cargo]
```
- Scout navigates and maps ahead
- Flankers provide lighting and threat detection
- Cargo carrier stays protected in center

### 3.3 Resource Sharing

**Fuel Transfer**
- Players can dock (approach within 10 units, matching velocity within 5 units/sec)
- Transfer rate: 50 fuel/second while docked
- Minimum transfer: 100 fuel (prevents griefing micro-transfers)

**Cargo Exchange**
- Requires full dock and stationary status
- 3-second transfer time per cargo unit
- Both players vulnerable during transfer

**Emergency Supply Drop**
- Jettison supply canisters that float in low gravity
- Canisters contain: 200 fuel, 1 repair kit, 3 flares
- Canisters persist for 5 minutes before despawning

### 3.4 Rescue Missions

When a player's lander is destroyed (hull reaches 0%), they enter **Survival Pod Mode**:

**Survival Pod Specifications**
- Tiny, minimal-thrust pod ejects from destroyed lander
- 60 seconds of life support
- Weak distress beacon visible to teammates
- Can be "caught" by nearby landers using cargo bay
- Rescued players can co-pilot the rescuing lander

**Rescue Rewards**
- Rescued player keeps 25% of their collected resources
- Rescuer receives "Savior Bonus" XP multiplier
- Moon base morale boost (affects all players)

### 3.5 Communication Systems

**Ping System**
| Ping Type | Meaning | Visual |
|-----------|---------|--------|
| Yellow | "Check this out" | Pulsing circle |
| Red | "Danger/Help!" | Flashing triangle |
| Green | "Resources here" | Diamond marker |
| Blue | "Regroup here" | Arrow pointing |

**Depth Radio Degradation**
- Surface to -500m: Full communication
- -500m to -1000m: Voice becomes static-y
- -1000m to -2000m: Pings only
- Below -2000m: Line-of-sight only

This creates natural tension as teams must stay together or risk losing contact.

---

## Physics-Based Mechanics

### 4.1 Ammo.js Implementation Overview

The game leverages Ammo.js (Bullet Physics port) for all physical interactions.

**Physics Configuration**
```javascript
PHYSICS_CONFIG: {
    gravity: { x: 0, y: 1.62, z: 0 },  // Lunar gravity (1.62 m/s^2)
    fixedTimeStep: 1/60,
    maxSubSteps: 10,
    solverIterations: 20  // Higher for rope stability
}
```

### 4.2 Rope Physics System

**Rope Implementation**
Using Ammo.js `btSoftBody` or chain of `btPoint2PointConstraint`:

```
ROPE_SEGMENT_CONFIG: {
    segmentLength: 5 units,
    segmentMass: 0.1 kg,
    dampingLinear: 0.1,
    dampingAngular: 0.5,
    stiffness: 0.8,
    collisionMargin: 0.5
}
```

**Rope Behaviors**
- **Slack**: Rope hangs naturally, affected by local gravity
- **Taut**: Rope transmits forces between connected bodies
- **Overstressed**: Visual warning before snap (rope turns red)
- **Snapped**: Rope detaches, segments become debris briefly

**Rope Applications**
1. **Towing** - Primary use, connect landers
2. **Anchoring** - Attach to cave walls for stability
3. **Winching** - Raise/lower cargo through vertical shafts
4. **Rappelling** - Controlled descent into deep chasms
5. **Rescue Lines** - Deploy to stranded survival pods

### 4.3 Cargo Physics

All collected resources exist as physical objects:

**Cargo Container Types**
| Type | Mass (kg) | Value | Stability |
|------|-----------|-------|-----------|
| Ore Chunk | 5-20 | Low | High |
| Crystal Formation | 2-8 | Medium | Low (fragile) |
| Artifact | 1-5 | High | Medium |
| Liquid Canister | 10-30 | Medium | Low (sloshing) |

**Cargo Bay Mechanics**
- Cargo bay has physical collision bounds
- Overloading causes items to spill during maneuvers
- Unsecured cargo shifts, affecting center of mass
- "Secure Cargo" action takes 2 seconds but prevents shifting

**Momentum Transfer**
Collected cargo affects lander handling:
- Additional mass requires more thrust
- Off-center cargo creates rotation tendencies
- Sudden stops can launch unsecured cargo

### 4.4 Environmental Physics

**Stalactite/Stalagmite Destruction**
- Cave formations have health and mass
- Collisions can break them loose
- Falling debris is fully physical
- Can be used strategically or cause chain reactions

**Gas Pocket Eruptions**
- Pressurized gas pockets exist in cave walls
- Mining near them causes eruptions
- Eruptions apply significant force to nearby landers
- Can be used for emergency boost or to clear debris

**Lava Flows (Deep Caves)**
- Liquid simulation using particle physics
- Contact causes rapid hull damage
- Creates updrafts that affect flight
- Solidifies into climbable surfaces over time

**Ice Formations (Shadow Caves)**
- Low-friction surfaces
- Can be melted with sustained thruster contact
- Melting reveals frozen resources
- Refreezes if left alone

### 4.5 Thruster Physics

**Thrust Model**
```
THRUST_CONFIG: {
    mainEngine: {
        force: 40 N,
        fuelConsumption: 20 units/sec,
        gimbalRange: 15 degrees,
        spoolUpTime: 0.1 sec
    },
    rcsThrusters: {
        force: 8 N,
        fuelConsumption: 5 units/sec,
        responseTime: 0.05 sec
    }
}
```

**Realistic Thrust Behaviors**
- Main engine applies force at nozzle position (creates torque if off-center)
- RCS thrusters provide rotation and translation correction
- Damaged thrusters have reduced/erratic output
- Fuel consumption increases with damage

---

## Moon Base System

### 5.1 Base Overview

The Moon Base serves as the central hub, respawn point, and progression anchor. All players in a session share a single moon base that persists between expeditions.

**Base Location**: The moon base is automatically placed at the flattest area on the lunar surface during map generation. The terrain is flattened around the base to ensure safe landing.

**Base Components**:
- **Landing Platform** - A dedicated landing pad with hazard stripes where players can safely land to refuel and repair
- **Moon Base Building** - The main habitat module with solar panels and communications array

**Visual Assets**:
- `moonbase_level1.png` - The main base building sprite
- `landing_platform.png` - The landing pad sprite with yellow/black hazard markings

**Automatic Services** (when landed on pad):
- **Auto-Refuel**: 100 fuel/sec when player fuel < 1000 (costs base fuel reserves)
- **Auto-Repair**: 1 damage/sec repair (costs spare parts from base)
- Players must slow down below 15 speed to trigger "landed" state

### 5.2 Base Resources

The moon base maintains shared resources that all players draw from:

```
BASE_RESOURCES:
    Starting Fuel: 5000 units
    Starting Spare Parts: 200 units

    Resource Costs:
    - Refueling: 0.1 base fuel per 1 player fuel
    - Repair: 5 spare parts per 1 damage point
    - Respawn: 50 spare parts per respawn
```

### 5.3 Base Structures

#### Landing Pad
```
LANDING_PAD:
    Level 1: Single pad, manual landing (current)
    Level 2: Dual pads, basic landing assist
    Level 3: Quad pads, auto-landing guidance
    Level 4: Six pads, repair drones on landing

    Current Features:
    - Auto-refuel at 100 fuel/sec when landed
    - Auto-repair at 1 damage/sec when landed
    - Landing detection requires speed < 15

    Upgrades affect:
    - Number of simultaneous landings
    - Landing assist UI
    - Automatic minor repairs on touchdown
```

#### Fuel Refinery
```
FUEL_REFINERY:
    Level 1: 50 fuel/sec refill rate
    Level 2: 100 fuel/sec, can process raw ice
    Level 3: 200 fuel/sec, fuel efficiency upgrade (+10%)
    Level 4: 400 fuel/sec, emergency fuel pods available

    Special: Higher levels unlock fuel types
    - Standard Fuel (default)
    - High-Octane (1.5x thrust, 2x consumption)
    - Efficiency Blend (0.8x thrust, 0.5x consumption)
```

#### Repair Bay
```
REPAIR_BAY:
    Level 1: Hull repairs only, 5 HP/sec
    Level 2: Subsystem repairs, 10 HP/sec
    Level 3: Advanced repairs, 20 HP/sec, spare parts storage
    Level 4: Nano-repair, 40 HP/sec, automatic damage prevention

    Repair Costs (per HP):
    - Hull: 2 Metal
    - Engine: 5 Metal + 1 Crystal
    - Electronics: 3 Metal + 3 Crystal
```

#### Research Lab
```
RESEARCH_LAB:
    Function: Analyze artifacts for bonuses and lore

    Level 1: Basic analysis (24-hour cycle)
    Level 2: Standard analysis (12-hour cycle)
    Level 3: Advanced analysis (6-hour cycle)
    Level 4: Instant analysis, artifact duplication chance

    Artifact Analysis Rewards:
    - Permanent stat bonuses
    - New equipment blueprints
    - Cave map fragments
    - Lore entries
```

#### Crew Quarters
```
CREW_QUARTERS:
    Level 1: 4 player capacity
    Level 2: 6 player capacity, morale bonuses
    Level 3: 8 player capacity, respawn time reduction
    Level 4: 10 player capacity, offline progression

    Morale System:
    - High morale: +10% to all stats
    - Low morale: -10% to all stats
    - Morale affected by: successful missions, rescues, deaths
```

#### Mission Control
```
MISSION_CONTROL:
    Level 1: Basic radar (surface caves only)
    Level 2: Deep radar (-1000m visibility)
    Level 3: Full radar, hazard detection
    Level 4: Predictive radar, resource density mapping

    Features:
    - Real-time team tracking
    - Distress signal amplification
    - Emergency recall beacon (1 use per expedition)
```

#### Storage Depot
```
STORAGE_DEPOT:
    Level 1: 1000 units capacity
    Level 2: 2500 units, sorting system
    Level 3: 5000 units, automated logistics
    Level 4: 10000 units, market access

    Storage Categories:
    - Raw Materials (ore, ice, gas)
    - Refined Materials (metal, fuel, crystals)
    - Artifacts (quest items, research subjects)
    - Equipment (spare parts, tools, upgrades)
```

### 5.3 Base Defense (Optional PvE Element)

Periodic meteor showers and lunar quakes threaten the base:

**Defense Structures**
- Point Defense Turrets: Shoot down small meteors
- Shield Generators: Absorb damage from larger impacts
- Reinforced Bunkers: Protect stored resources
- Early Warning System: Alerts for incoming threats

**Threat Events**
| Event | Frequency | Damage Potential | Warning Time |
|-------|-----------|------------------|--------------|
| Micro Meteors | Common | Low | 30 sec |
| Meteor Shower | Uncommon | Medium | 60 sec |
| Lunar Quake | Rare | High (cave-ins) | 90 sec |
| Solar Flare | Very Rare | Electronics damage | 120 sec |

### 5.4 Base Upgrade Costs

| Structure | L1→L2 | L2→L3 | L3→L4 |
|-----------|-------|-------|-------|
| Landing Pad | 500M, 100C | 1500M, 400C | 4000M, 1000C, 5A |
| Fuel Refinery | 400M, 50C | 1200M, 200C | 3000M, 600C, 3A |
| Repair Bay | 600M, 150C | 1800M, 500C | 5000M, 1500C, 8A |
| Research Lab | 300M, 200C | 1000M, 600C | 2500M, 1500C, 10A |
| Crew Quarters | 400M, 50C | 1000M, 150C | 2500M, 400C, 2A |
| Mission Control | 500M, 300C | 1500M, 800C | 4000M, 2000C, 12A |
| Storage Depot | 300M, 25C | 800M, 100C | 2000M, 300C, 1A |

*M = Metal, C = Crystal, A = Artifact*

---

## Procedural Cave Generation

### 6.1 Generation Philosophy

The cave system should feel like a continuous, natural underground world - not a series of disconnected rooms. Players should experience:

- **Vertical Depth**: The cave primarily extends downward (map is 400x500 tiles = 3200x4000 world units)
- **Horizontal Branching**: Multiple paths at each depth level
- **Organic Flow**: Natural-looking cave shapes using "worm" algorithm
- **Increasing Difficulty**: Deeper = rarer ores but more hazardous
- **Resource Distribution**: Different ore types at different depths

### 6.1.1 Current Implementation

**Map Dimensions**: 400 tiles wide × 500 tiles deep (8px per tile = 3200×4000 world units)

**Terrain Layers**:
- Surface (0-15%): Empty sky
- Regolith (first 8 tiles below surface): Soft lunar soil
- Rock (8-150 tiles deep): Standard mineable rock
- Hard Rock (150+ tiles deep): Dense, harder to destroy

**Cave Generation** (Worm/Drunkard's Walk):
- 15 worms start at random surface points
- Each worm carves tunnels primarily downward
- Worms can split (up to 25 total) creating branching caves
- Radius varies 3-10 tiles creating varied tunnel widths

### 6.2 World Structure

```
SURFACE (Y = 0)
    |
    [MOON BASE] ─── [Cave Entrance]
                         |
                    [SHALLOW ZONE: 0 to -500m]
                    - Wide passages
                    - Common resources
                    - Beginner friendly
                         |
                    [MID ZONE: -500m to -1500m]
                    - Medium passages
                    - Uncommon resources
                    - Moderate hazards
                         |
                    [DEEP ZONE: -1500m to -3000m]
                    - Narrow passages
                    - Rare resources
                    - Significant hazards
                         |
                    [ABYSS ZONE: -3000m to -5000m]
                    - Extremely tight passages
                    - Legendary resources
                    - Extreme hazards
                         |
                    [THE CORE: Below -5000m]
                    - Unknown...
                    - Artifacts of unknown origin
                    - Boss encounters?
```

### 6.3 Cave Generation Algorithm

**Primary Cave Spine**
```
SPINE_GENERATION:
    1. Start at cave entrance (surface)
    2. Generate primary path downward using:
       - Perlin noise for horizontal wandering
       - Bias toward downward movement
       - Occasional vertical shafts
    3. Path width: baseWidth * (1 - depth/maxDepth * 0.7)
       - Surface: 200 units wide
       - Deep: 60 units wide
    4. Add "rest stops" - wider chambers every 200-400m depth
```

**Branch Generation**
```
BRANCH_GENERATION:
    For each segment of primary spine:
        branchChance = 0.3 + (depth / maxDepth * 0.4)
        if random() < branchChance:
            Generate branch path:
            - Angles between 30-150 degrees from spine
            - Length: 100-500 units
            - May reconnect to spine or dead-end
            - Dead-ends often contain resources
```

**Chamber Generation**
```
CHAMBER_TYPES:
    - Rest Chamber: Wide, safe, often has flat landing spots
    - Resource Chamber: Contains ore veins, crystals
    - Hazard Chamber: Environmental dangers, higher rewards
    - Artifact Chamber: Contains artifacts, may have puzzles
    - Boss Chamber: Large, unique geometry, special encounters
```

### 6.4 Wall Collision Mesh Generation

**Critical for Gameplay**: Walls must have proper collision so landers can crash into them.

**Mesh Generation Process**
```
COLLISION_MESH_GENERATION:
    1. Generate cave path as center line with width values
    2. Create wall vertices by offsetting from center line
    3. Apply noise to wall vertices for rough, natural look
    4. Generate triangulated mesh from vertices
    5. Create Ammo.js btBvhTriangleMeshShape for each cave segment
    6. Add collision bodies to physics world as static objects
```

**Wall Properties**
```
WALL_COLLISION_CONFIG:
    - Friction: 0.8 (high, rough rock)
    - Restitution: 0.2 (low bounce)
    - Collision Group: TERRAIN
    - Collision Mask: PLAYERS | CARGO | DEBRIS
```

**Segment Loading**
To handle large caves efficiently:
```
STREAMING_SYSTEM:
    - Divide cave into segments (500m vertical chunks)
    - Load segments around all players (1 segment above, 2 below)
    - Unload distant segments but retain state
    - Resource respawns after segment unload timeout (5 min)
```

### 6.5 Point of Interest Placement

**Landing Zones**
```
LANDING_ZONE_GENERATION:
    Every 100-200m depth:
        - Find wide horizontal sections
        - Flatten a 50-100 unit section
        - Mark as safe landing zone
        - May contain emergency supplies
```

**Resource Veins**
```
RESOURCE_VEIN_PLACEMENT:
    For each cave segment:
        veinCount = baseCount + depthBonus
        For each vein:
            - Position on cave wall (not floor/ceiling)
            - Type determined by depth + random
            - Size: small (10u), medium (25u), large (50u)
            - Rich veins glow faintly for visibility
```

**Hazard Placement**
```
HAZARD_PLACEMENT:
    Hazard density increases with depth
    Types by depth:
        0-500m: Loose rocks, minor steam vents
        500-1500m: Gas pockets, unstable formations
        1500-3000m: Lava pools, ice sheets, predators
        3000m+: All above + magnetic anomalies, gravity wells
```

### 6.6 Visual Depth Indicators

**Environmental Storytelling Through Depth**

| Depth Range | Visual Theme | Ambient Sounds |
|-------------|--------------|----------------|
| 0-500m | Grey lunar rock, dust particles | Wind howl, settling rocks |
| 500-1000m | Darker rock, crystal formations | Dripping, echoes |
| 1000-2000m | Bioluminescent fungi, ice | Humming, cracking ice |
| 2000-3000m | Red-hot rock veins, steam | Rumbling, hissing |
| 3000-4000m | Alien structures, artifacts | Strange frequencies |
| 4000m+ | Unknowable geometry | Silence, heartbeat |

---

## Collision & Damage System

### 7.1 Collision Detection

**Physics-Based Collision**
All collisions are detected through Ammo.js contact callbacks:

```javascript
COLLISION_CALLBACK_SETUP:
    - Register contact listener on physics world
    - Filter collisions by collision groups
    - Calculate impact velocity and angle
    - Apply damage based on collision parameters
```

**Collision Groups**
```
COLLISION_GROUPS:
    TERRAIN = 0x0001
    PLAYERS = 0x0002
    CARGO = 0x0004
    DEBRIS = 0x0008
    HAZARDS = 0x0010
    PROJECTILES = 0x0020
```

### 7.2 Impact Damage Calculation

```
DAMAGE_CALCULATION:
    impactVelocity = |relativeVelocity|
    impactAngle = angle between velocity and surface normal

    baseDamage = impactVelocity * DAMAGE_MULTIPLIER

    angleModifier:
        - Head-on (0-30 deg): 1.0x
        - Glancing (30-60 deg): 0.5x
        - Scraping (60-90 deg): 0.2x

    finalDamage = baseDamage * angleModifier * targetVulnerability
```

**Damage Thresholds**
| Impact Velocity | Result |
|-----------------|--------|
| 0-5 units/sec | No damage (landing speed) |
| 5-15 units/sec | Minor damage (5-15 HP) |
| 15-30 units/sec | Moderate damage (15-40 HP) |
| 30-50 units/sec | Severe damage (40-80 HP) |
| 50+ units/sec | Critical damage (80+ HP, subsystem failure) |

### 7.3 Hull Integrity System

**Hull Structure**
```
HULL_SYSTEM:
    maxHealth: 100 HP (upgradeable to 200)
    armor: 0 (upgradeable, reduces damage taken)

    Health States:
        100-75%: Nominal (green)
        75-50%: Damaged (yellow) - minor visual damage
        50-25%: Critical (orange) - sparks, fuel leak
        25-1%: Failing (red) - systems shutting down
        0%: Destroyed - survival pod ejects
```

**Hull Damage Effects**
```
DAMAGE_EFFECTS:
    75% HP: Cosmetic cracks, no gameplay effect
    50% HP: Fuel leak (5 fuel/sec passive loss)
    25% HP: Thruster efficiency -25%
    10% HP: Random thruster misfires
    0% HP: Explosion, survival pod ejects
```

### 7.4 Subsystem Damage

Beyond hull damage, specific subsystems can be damaged:

**Subsystems**
```
SUBSYSTEM_LIST:
    - Main Engine: Primary thrust capability
    - RCS Thrusters: Rotation and fine control
    - Navigation: Map and compass functionality
    - Communications: Radio and ping system
    - Cargo Bay: Resource storage integrity
    - Life Support: Survival pod charge time
    - Sensors: Hazard and resource detection
```

**Subsystem Damage Triggers**
| Event | Affected System | Damage |
|-------|-----------------|--------|
| Bottom impact | Main Engine | High |
| Side impact | RCS Thrusters | Medium |
| Top impact | Sensors, Communications | Medium |
| Electrical hazard | Navigation, Sensors | High |
| Heat exposure | All systems | Low/tick |
| EMP burst | All electronics | Critical |

**Damaged Subsystem Behavior**
```
MAIN_ENGINE_DAMAGE:
    100%: Full thrust
    75%: Occasional thrust stuttering
    50%: -30% thrust power
    25%: -60% thrust power, constant stuttering
    0%: No thrust, freefall

RCS_DAMAGE:
    100%: Full rotation control
    75%: Slight rotation delay
    50%: -40% rotation speed
    25%: Random rotation drift
    0%: No rotation control, spinning

NAVIGATION_DAMAGE:
    100%: Full map, compass, depth indicator
    75%: Map flickers occasionally
    50%: No map, compass works
    25%: Compass unreliable
    0%: No navigation aids

CARGO_BAY_DAMAGE:
    100%: Full capacity, items secure
    75%: Items may shift during maneuvers
    50%: -25% capacity, items fall out on impact
    25%: -50% capacity, constant item loss
    0%: No storage, all cargo ejected
```

### 7.5 Repair System

**Repair Requirements**
```
REPAIR_CONDITIONS:
    - Lander must be stationary (velocity < 2 units/sec)
    - Cannot be actively taking damage
    - Must have required resources
    - Repair takes time (interruptible)
```

**Field Repairs**
```
FIELD_REPAIR:
    Hull Repair:
        - Cost: 5 Metal per 10 HP
        - Time: 2 seconds per 10 HP
        - Max field repair: 50% of max HP

    Subsystem Repair:
        - Cost: 10 Metal + 5 Crystal per 25%
        - Time: 5 seconds per 25%
        - Max field repair: 75% functionality

    Full repairs require returning to Moon Base
```

**Repair Kit Items**
```
REPAIR_KIT:
    - Found in emergency caches
    - Dropped by teammates
    - Instant 25 HP restoration
    - One-time use

SYSTEM_PATCH:
    - Crafted at moon base
    - Restores one subsystem to 50%
    - Single use
```

### 7.6 Critical Damage Events

**Fuel Tank Rupture**
- Triggered at <25% hull HP
- Fuel leaks at 20 fuel/sec
- Creates visible fuel trail
- Fuel can be ignited by heat sources

**Oxygen Leak** (if implementing oxygen system)
- Triggered by life support damage
- Timer starts for survival pod deployment
- Can be patched with resources

**Cargo Breach**
- Triggered by cargo bay damage
- Resources spill out physically
- Must be recollected or lost

---

## Resource Economy

### 8.1 Resource Types

**Primary Resources**

| Resource | Tile Type | Location (Depth) | Rarity | Primary Use |
|----------|-----------|------------------|--------|-------------|
| Lunar Regolith | REGOLITH | Surface (0-8 tiles) | Common | Basic construction |
| Iron Ore | IRON_ORE | 10-300 tiles deep | Common | Metal production, repairs |
| Copper Ore | COPPER_ORE | 20-250 tiles deep | Common | Electronics, wiring |
| Titanium Ore | TITANIUM_ORE | 80-400 tiles deep | Uncommon | Advanced construction |
| Gold Ore | GOLD_ORE | 150-450 tiles deep | Rare | Premium components |
| Platinum Ore | PLATINUM_ORE | 250-500 tiles deep | Very Rare | High-tech equipment |
| Helium-3 Deposits | HELIUM3_DEPOSIT | 300-500 tiles deep | Very Rare | Premium fuel, research |
| Ice Deposits | (Future) | Shadow caves | Common | Fuel production |
| Quantum Crystals | (Future) | Deep-Abyss | Rare | Research, upgrades |
| Ancient Artifacts | (Future) | Special chambers | Very Rare | Unique upgrades |

**Ore Generation System**
- Ores spawn in clusters of 3-8 tiles
- Deeper ores are rarer but more valuable
- Ore clusters glow subtly to aid visibility
- Ore tiles can be mined (future feature)

**Processed Resources**

| Processed | Input | Output Ratio | Use |
|-----------|-------|--------------|-----|
| Metal | Iron Ore | 2:1 | Construction, repairs |
| Alloy | Titanium + Metal | 1:1:1 | Advanced construction |
| Fuel | Ice | 5:1 | Lander fuel |
| Premium Fuel | Helium-3 | 2:1 | High-performance fuel |
| Electronics | Silicon Crystal + Metal | 1:2:1 | Subsystem repairs |
| Research Points | Quantum Crystal | 1:100 | Tech tree |

### 8.2 Resource Collection

**Mining Mechanics**
```
MINING_SYSTEM:
    - Approach ore vein within 20 units
    - Activate mining laser (hold action key)
    - Mining time: 2-10 seconds based on vein size
    - Resources appear as physical cargo
    - Must be collected into cargo bay
```

**Vein Sizes**
| Size | Yield | Mining Time | Spawn Frequency |
|------|-------|-------------|-----------------|
| Small | 10-25 units | 2 sec | Common |
| Medium | 25-75 units | 5 sec | Uncommon |
| Large | 75-200 units | 10 sec | Rare |
| Massive | 200-500 units | 20 sec | Very Rare |

**Cargo Capacity**
```
DEFAULT_CARGO_BAY:
    Capacity: 500 units
    Weight: each unit = 0.1 mass added to lander

UPGRADED_CARGO_BAY:
    Level 2: 750 units
    Level 3: 1000 units
    Level 4: 1500 units
```

### 8.3 Risk vs Reward

**Depth Bonuses**
| Depth | Resource Multiplier | Quality Chance |
|-------|--------------------|-|
| 0-500m | 1.0x | 5% rare |
| 500-1000m | 1.25x | 15% rare |
| 1000-2000m | 1.5x | 30% rare |
| 2000-3000m | 2.0x | 50% rare |
| 3000m+ | 3.0x | 75% rare |

**The Greed Mechanic**
- More cargo = slower, harder to control lander
- Full cargo bay + low fuel = high-stakes return journey
- Losing your lander means losing ALL cargo
- Partial cargo drops create retrieval missions

### 8.4 Economy Sinks

**Fuel Consumption**
- Primary resource sink
- Deeper expeditions require more fuel investment
- Towing operations multiply fuel costs

**Repair Costs**
- Wall collisions damage hull and subsystems
- Field repairs use resources
- Full repairs at base have reduced costs

**Upgrades**
- Base structure upgrades (major sink)
- Lander upgrades (medium sink)
- Consumable crafting (minor sink)

**Loss on Death**
- 75% of carried cargo lost on lander destruction
- 25% salvageable by teammates
- Encourages cautious play at high cargo levels

---

## Progression Systems

### 9.1 Player Progression

**Experience Points**
```
XP_SOURCES:
    - Resource delivery: 1 XP per 10 units
    - Depth reached: 10 XP per 100m (first time)
    - Rescue teammate: 500 XP
    - Discover artifact: 200 XP
    - Complete expedition: 100 XP base
    - No deaths bonus: 1.5x multiplier
```

**Player Levels**
| Level | Total XP | Unlock |
|-------|----------|--------|
| 1 | 0 | Starting lander |
| 5 | 1,000 | Tether unlock |
| 10 | 5,000 | Second lander slot |
| 15 | 15,000 | Advanced thrusters |
| 20 | 35,000 | Co-pilot mode |
| 25 | 70,000 | Third lander slot |
| 30 | 120,000 | Master pilot title |

### 9.2 Lander Upgrades

**Lander Slots**
Players unlock additional lander configurations:
- Slot 1: All-rounder (default)
- Slot 2: Cargo Hauler OR Speed Runner
- Slot 3: Heavy Armor OR Support Craft

**Upgrade Categories**

*Hull Upgrades*
```
HULL_UPGRADES:
    - Reinforced Plating: +25 max HP (×3)
    - Impact Absorbers: -20% collision damage
    - Emergency Foam: Auto-repair 10 HP when critical
```

*Engine Upgrades*
```
ENGINE_UPGRADES:
    - High-Output Thruster: +25% thrust
    - Fuel Injector: +15% efficiency
    - Vectoring Nozzle: +20% control authority
    - Emergency Afterburner: 3-second boost, cooldown
```

*Cargo Upgrades*
```
CARGO_UPGRADES:
    - Expanded Bay: +250 capacity (×3)
    - Magnetic Clamps: Cargo doesn't shift
    - Quick-Release: Faster cargo operations
    - Reinforced Container: Cargo survives crashes
```

*Utility Upgrades*
```
UTILITY_UPGRADES:
    - Extended Tether: +100 tether length
    - Reinforced Cable: +200N tensile strength
    - Flare Launcher: Illuminate dark areas
    - Sonar Pulse: Reveal nearby resources
    - Emergency Beacon: Stronger rescue signal
```

### 9.3 Team Progression

**Shared Achievements**
```
TEAM_ACHIEVEMENTS:
    - "Deep Divers": Reach -1000m as a team
    - "No Miner Left Behind": 10 successful rescues
    - "Efficient Operation": Complete expedition, no deaths
    - "Heavy Haul": Deliver 10,000 resources in one run
    - "The Abyss Stares Back": Reach -5000m
```

**Moon Base Milestones**
```
BASE_MILESTONES:
    - "Established": All structures at Level 1
    - "Operational": All structures at Level 2
    - "Thriving": All structures at Level 3
    - "Legendary": All structures at Level 4
```

### 9.4 Discovery System

**Map Revelation**
- Cave layout is hidden until explored
- Explored areas remain visible on map
- Shared between all team members
- Persists between expeditions

**Points of Interest**
```
POI_DISCOVERY:
    - Artifact Chambers: Major discovery, large XP
    - Resource Hotspots: Marked on map for return visits
    - Safe Zones: Landing spots marked
    - Hazard Zones: Warnings added to map
    - Secret Passages: Shortcuts between areas
```

**Lore Fragments**
- Found near artifacts and unique locations
- Piece together the moon's history
- Unlock cosmetic rewards
- Hint at deeper game mysteries

---

## Technical Architecture

### 10.1 Room-Based Multiplayer

**Room System**
Players create or join game rooms using 6-character room codes. Each room has its own:
- Independent game instance
- Procedurally generated map
- Shared base resources
- 60Hz physics simulation

```
ROOM_ARCHITECTURE:

    [Lobby] → Create Room → [Room ABC123]
                              ↓
              Join Room → [Room ABC123] ← [Client 2]
                 ↓
            [Client 1] ←→ [Game Instance] ←→ [Client 2]
```

**Room Code Generation**
- 6 alphanumeric characters (excluding confusing chars: 0,O,1,I)
- Example: "K7MN3P", "WXYZ23"
- Case-insensitive input (auto-uppercased)
- Unique per active room

**Room Lifecycle**
```
ROOM_STATES:
    CREATING: Host initiated, map generating
    READY: Map generated, accepting players
    ACTIVE: Game in progress
    DESTROYED: All players left, room cleaned up
```

**Host Management**
- First player to create becomes host
- If host disconnects, host transfers to another player
- Room persists as long as at least one player remains
- Empty rooms are automatically destroyed

### 10.2 Client-Server Communication

```
ARCHITECTURE_OVERVIEW:

    [Client 1] ←→ [Server] ←→ [Client 2]
         ↑           ↑           ↑
      Render     Physics     Render
        UI       Authority      UI
       Input                  Input
```

**Server Authority**
- Physics simulation (Ammo.js) runs on server
- Server validates all player actions
- Clients receive state updates at 20Hz
- Clients perform local prediction for smoothness

**Client Responsibilities**
- Input collection and transmission
- State interpolation for smooth rendering
- Local sound/particle effects
- UI rendering

### 10.2 Network Protocol

**State Sync (Server → Client)**
```javascript
STATE_PACKET: {
    timestamp: Number,
    players: [{
        id: String,
        position: { x, y },
        velocity: { vx, vy },
        rotation: Number,
        angularVelocity: Number,
        fuel: Number,
        health: Number,
        subsystems: { ... },
        cargo: Number,
        state: String // 'flying', 'landed', 'crashed', 'pod'
    }],
    terrain: [...], // Only changed segments
    entities: [...], // Resources, debris, hazards
    events: [...] // Collisions, damage, pickups
}
```

**Input Sync (Client → Server)**
```javascript
INPUT_PACKET: {
    timestamp: Number,
    sequence: Number, // For reconciliation
    inputs: {
        thrust: Boolean,
        left: Boolean,
        right: Boolean,
        action: String | null,
        target: { x, y } | null
    }
}
```

### 10.3 Physics Optimization

**Sleeping Bodies**
- Static terrain and inactive debris sleep
- Wake on player proximity or collision

**Broad Phase Optimization**
```
SPATIAL_PARTITIONING:
    - Use btDbvtBroadphase (dynamic AABB tree)
    - Efficient for scenes with many static objects
    - Good performance with moving objects
```

**Constraint Solving**
```
SOLVER_CONFIG:
    - Use btSequentialImpulseConstraintSolver
    - 20 iterations for rope stability
    - Split impulse for constraint stability
```

### 10.4 Chunk System for Large Worlds

**Vertical Chunks**
```
CHUNK_SYSTEM:
    chunkHeight: 500 meters
    loadRadius: 1 chunk above, 2 chunks below player

    Each chunk contains:
    - Collision mesh
    - Resource spawn points
    - Hazard definitions
    - Navigation data
```

**Chunk Lifecycle**
```
CHUNK_STATES:
    - UNLOADED: Data exists but not in physics world
    - LOADING: Being generated or loaded from storage
    - ACTIVE: In physics world, fully simulated
    - DORMANT: In physics world but simplified
    - UNLOADING: Being removed from physics world
```

### 10.5 Deterministic Physics Considerations

For replays and anti-cheat:
```
DETERMINISM_NOTES:
    - Use fixed timestep (1/60)
    - Seed random number generators
    - Process inputs in deterministic order
    - Consider fixed-point math for critical paths
```

---

## Appendix A: Control Scheme

**Keyboard Controls**
| Key | Action |
|-----|--------|
| W / Up Arrow | Main Thrust |
| A / Left Arrow | Rotate Counter-clockwise |
| D / Right Arrow | Rotate Clockwise |
| Space | Action (Mine / Tether / Interact) |
| E | Secondary Action |
| Tab | Map |
| Q | Quick Ping |
| 1-4 | Ping Types |
| F | Toggle Flashlight |
| R | Repair (when stationary) |
| C | Cargo Menu |
| Shift | Precision Mode (reduced thrust) |
| Escape | Pause Menu |

**Gamepad Controls**
| Input | Action |
|-------|--------|
| Right Trigger | Main Thrust |
| Left Stick | Rotation |
| A Button | Action |
| B Button | Secondary Action |
| Y Button | Map |
| X Button | Repair |
| D-Pad | Ping Types |
| Bumpers | Cargo Management |

---

## Appendix B: Future Considerations

**Potential Future Features**
- PvP mode: Competing teams race for resources
- Boss encounters: Giant cave creatures
- Seasonal events: Special limited-time caves
- Custom lander builder: Design your own craft
- Modding support: User-created caves and challenges
- VR support: Immersive cockpit experience

**Stretch Goals**
- Multiple moons with different properties
- Orbital station as secondary base
- Interplanetary expeditions
- Player-built cave bases

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| Tether | Physical rope connecting two landers |
| Hull | Primary health/armor of lander |
| Subsystem | Component of lander (engine, RCS, etc.) |
| Expedition | Single journey from base into caves |
| Chunk | Vertical segment of cave world |
| POI | Point of Interest |
| RCS | Reaction Control System (rotation thrusters) |
| Cargo Bay | Storage for collected resources |
| Survival Pod | Emergency escape from destroyed lander |

---

## Appendix D: Changelog

### Version 1.3 (January 2026)
- **Dynamic Lighting System**: Implemented depth-based ambient lighting
  - Surface has natural sunlight, caves get progressively darker
  - Complete darkness at ~300 tiles deep
  - Moon base emits ambient light around landing area
- **Lander Lights**: Each lander has multiple light sources
  - Position lights: Red (left) and green (right) navigation lights
  - Front headlight: Illuminates area in front of ship
  - Spotlight: Mouse-controlled directional spotlight
- **Spotlight Features**:
  - Follows mouse cursor direction
  - 250 unit range with 30-degree cone
  - Can reveal ores up to 3 tiles deep into walls
  - Ore deposits glow when within spotlight cone
- **Damage-Based Light Effects**:
  - Lights dim as damage increases (down to 30% at max damage)
  - Flickering effect at low health (<50%)
  - Light intensity synced in multiplayer
- **Multiplayer Light Sync**: All player spotlights visible to other players

### Version 1.2 (January 2026)
- **Multiplayer Rooms**: Implemented room-based multiplayer system
  - Host creates a game with randomly generated map
  - 6-character room code for easy sharing (e.g., "ABC123")
  - Other players join via room code over internet
  - Room info bar shows room code and player count during gameplay
  - Host transfer on disconnect - room persists if players remain
  - Leave button to return to lobby
- **Lobby UI**: New lobby screen with Create Game and Join Game options
- **Room Management**: Server-side room management with automatic cleanup

### Version 1.1 (January 2026)
- **Expanded Map**: Increased map depth from 200 to 500 tiles (2.5x deeper)
- **Ore System**: Added 6 ore types (Iron, Copper, Titanium, Gold, Platinum, Helium-3) with depth-based distribution
- **Moon Base Sprites**: Replaced procedural base rendering with sprite assets
- **Landing Platform**: Added dedicated landing platform sprite separate from base building
- **Base Resources**: Implemented shared fuel and spare parts system
- **Auto Services**: Landing on pad now auto-refuels and auto-repairs
- **Respawn System**: Players can respawn at base for spare parts cost
- **Collision Particles**: Added debris, sparks, and smoke on damage
- **Death Explosion**: Dramatic particle explosion when ship is destroyed
- **Thrust Alignment**: Fixed particle effects and thrust to match sprite orientation

### Version 1.0 (January 2026)
- Initial game design document
- Core gameplay loop defined
- Physics-based flight mechanics
- Cooperative systems designed
- Procedural cave generation concept

---

*Document Version: 1.3*
*Last Updated: January 2026*
*Project: Moonlander.io*
