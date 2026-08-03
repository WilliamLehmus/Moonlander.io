# Moonlander.io — TODO

Picking-up-where-we-left-off list. Grouped by what it costs you, not by system.

**Before changing anything**, run the check harnesses — 171 checks, ~30 seconds:

```
cd server && node tests/run-all.mjs
```

They boot a real `Game` with real physics and real terrain, so they catch
integration breakage, not just unit slips. Terrain is randomly seeded per run,
so run them **two or three times** after touching map generation or placement —
several bugs found so far only appeared on some seeds.

---

## 1. Finish the base-building loop

- [x] ~~**Buildings are not hauled.**~~ **Done.** A building is crafted at a
      base into a *kit*, carried in the hold, and consumed where it is placed.
      Crafting pays the materials; placing costs nothing further.

      **Decision recorded:** a kit takes **1 cargo slot**, not the 2x2 in GDD
      §5.2. Cargo is a flat array with no 2D packing, and a Scout has 3 slots —
      at 2x2 no building could be carried until a Cargo Hauler (50 Industrial,
      below 1385m), which would gate the first Comm Antenna behind the depths
      its minimap exists to help you reach. Revisit only if a real 2D grid is
      ever built.

- [x] ~~**You cannot remove a building.**~~ **Done.** Demolish refunds 50% of
      everything invested (build cost + every upgrade). The Habitat cannot be
      demolished (it is the colony's generator, refinery and antenna) and
      neither can your last Landing Pad. Buttons sit next to each instance in
      the Construction tab. *Relocating* is still not possible — demolish and
      rebuild is the workaround.

- [x] ~~**Second bases have no way to get power.**~~ **Done, and it was broken
      two ways.** The Base Bus only formed around the node literally named
      `landing_pad`, so every remote base was permanently disconnected; and a
      Fuel Generator produced its full 50 kW on an empty tank, which made the
      fuel network decorative. Both fixed, and hand-filling a generator from a
      ship's tank (GDD 6.3, never implemented) is now the bootstrap that breaks
      the generator-needs-fuel-needs-powered-depot-needs-generator circle.
      Covered by `tests/remote-base.test.mjs`.

## 2. Known-wrong numbers

- [x] ~~Bitite runs out at ~4,180m.~~ **Fixed.** Its band now runs the full
      depth. GDD §10.1 guarantees fuel at all depths, and the cap left the last
      ~800m before the Core with no way to refuel for the trip home.
- [x] ~~`getBuildingEffect()` off-by-one.~~ **Fixed.** Level 1 now equals
      `baseValue`, matching the GDD ("Fuel Depot stores 2000 at L1, +5000/level")
      and the convention `NetworkSystem` and `getAntennaRange` already used. The
      old formula handed Level 1 a free increment and shifted every storage
      capacity one level up.
- [x] ~~`buildingCosts` dead entries.~~ **Fixed.** Trimmed 12 levels to 4 for
      refinery, solar and factory; `canAffordUpgrade` caps at 4.
- [x] ~~`cableMaxLength` misnamed.~~ **Fixed.** Renamed `tetherMaxLength`, and
      `buildCableMaxLength` (120) is now explicit in the config rather than a
      hardcoded fallback.

## 3. Batch 5 bugs (from the top of the GDD)

- [x] ~~Mining message lingers.~~ **Fixed.** Floating text decayed purely by
      frame delta, so one skipped, stalled or non-finite frame could leave
      "+3 Iron" up forever. Entries now carry an absolute expiry as a backstop,
      the delta is clamped, and the list is capped.
- [x] ~~Base menu opens automatically near the pad.~~ **Already gone** — the
      only remaining `openStationMenu()` call is the B key.
- [x] ~~Moonlander teleports to (0,0) on EVA exit.~~ **Already fixed** and now
      verified: exiting at (1234,1500) leaves the pilot within 2 units and
      parks the ship exactly where it was.
- [x] ~~Station menu unreliable when docked.~~ **Fixed, and it was worse than
      reported.** Docking tested only the *home* pad's carved bounds, so every
      player-built landing pad was inert: no station menu, no kit crafting, no
      refuel, no repair. Refuelling was also hardcoded to the home pad's tank.
      Docking now resolves whichever pad you are on, and services use it.
- [x] ~~Map persistence / seed-based generation.~~ **Confirmed and improved.**
      Terrain was already per-game (each Room builds its own Game; two rooms
      verified to differ), but the seed was discarded. It is now recorded on the
      Game and sent in state, so a map can be identified and shared.
- [x] ~~Moonlander landing legs clip into the ground.~~ **Fixed, and it was a
      rendering offset rather than collision shape work.** A Scout collides as
      20x28 but renders at 40x40, and both were centred on the body origin, so
      the landing legs hung ~6 units below anything physics knew about — the
      ship rested correctly while its legs visibly sank. The collider size is
      now serialized and the sprite is lifted so its feet sit on the collider
      base. No physics change, so flight feel is untouched.
- [x] ~~Sync all light emissions (including thruster flames).~~ **Fixed.**
      Position lights and spotlights were already synced and drawn for every
      player; thruster flames emitted no light at all, despite `thrusting`
      being synced and the flame being drawn. A firing engine now casts a
      flickering warm glow — often the only light a player has once their
      power is gone. Powered buildings emit light too, so a browned-out or
      uncabled base visibly goes dark.
      Found while doing it: **Placeable Light was never buildable** — it was
      specced in `NetworkSystem` and listed in the shed order, but absent from
      the buildings table and cost list, so the one building whose entire job
      is lighting could not be placed. Now buildable at 20 Basic.

## 4. Deferred on purpose

- [ ] **Cable spool rope physics.** `dropLine` still makes a physics box with a
      crude spring past `MAX_LENGTH`. The *crash* bugs in that path are fixed
      (`spool.x` NaN, lost `anchorId`), but the simulation itself is untouched.
      It is not on the critical path — cables work without ever dropping a spool
      — and this is the thing that has eaten the most time historically. Only
      re-enter it deliberately.

- [ ] **Cable severance** (GDD §6.2, marked optional). Falling rock cutting a
      run would give cables real stakes. Nothing implemented.

- [x] ~~**Multiplayer is untested.**~~ **Done, and it found a severe bug.**
      `Player` never assigned `this.x`/`this.y` — position lived only in the
      Ammo body — yet eleven call sites read them directly. Story beats never
      fired, the game could not be won, hand-filling found nothing, cable
      previews drew to NaN, dropped items could not be picked up and the
      minimap never lit. Every unit test set those fields by hand, so the whole
      suite passed while the real game was broken. Covered now by
      `tests/multiplayer.test.mjs` (41 checks, deliberately does NOT set them)
      and `tests/integration-2clients.mjs` (two real socket clients against a
      real server; run it separately, it boots on port 3097).

## 5. Content

- [x] ~~**No Core chamber — the win fires in open cave.**~~ **Fixed.** A real
      chamber is now carved deep in the Core biome and the win fires on
      *arriving inside it*, not on crossing a depth line. Verified across eight
      seeds: the chamber lands at n=0.93–0.98 with **zero** terrain vandalism.

      Worth knowing: the first attempt forced the chamber to be reachable by
      flight, which cut 900–2400 tile corridors across the map. That was solving
      a non-problem — on about a third of seeds the natural caves stop shallow,
      because **mining through rock is how you get down**. It now sites the
      chamber on cave floor when the caves reach that deep, bridges only short
      gaps (<45 tiles), and otherwise leaves the last stretch to the drill.

- [ ] Story text is all in `server/game/Story.js`, deliberately in one place and
      easy to rewrite. Tone is B-movie corporate sci-fi; change it freely.

---

## Recent context worth not re-deriving

- **Depth**: `VoxelMap.getDepthMeters()` is the single authoritative scale.
  Surface = 0m, map bottom = 5,000m, surface read from the landing pad. Never
  hardcode a surface Y — it moves with the seed (1468 / 1500 / 1548 observed).
- **Building ids**: first instance of a type keeps the bare type name
  (`landing_pad`), later ones get `landing_pad#2`. This is what let the instance
  migration avoid touching every network node id. Keep it.
- **Build radius is 400**, Base Bus follows it. 200 fit only ~3 buildings once
  the pad and Habitat were placed. `Game.buildRadius` is the one definition —
  do not re-derive it from config elsewhere (that bug already happened once).
- **Capacities sum across instances but are gated on connectivity.** An
  unconnected Fuel Depot adds no storage. That gate is what keeps the network
  system from being cosmetic.
