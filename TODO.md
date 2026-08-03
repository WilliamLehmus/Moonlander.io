# Moonlander.io — TODO

Picking-up-where-we-left-off list. Grouped by what it costs you, not by system.

**Before changing anything**, run the check harnesses — 162 checks, ~30 seconds:

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

## 3. Batch 5 bugs (still open, from the top of the GDD)

- [ ] Mining success message ("3 iron") sometimes lingers and is never removed.
- [ ] Base menu opens automatically when the player gets near the landing pad —
      it should not.
- [ ] Moonlander landing legs clip into the ground.
- [ ] Moonlander teleports to (0,0) when the player exits to EVA.
- [ ] Station menu access is unreliable when docked on a landing pad.
- [ ] Map persistence: confirm per-game seed-based generation actually holds.
- [ ] Sync all light emissions (including thruster flames) in multiplayer.

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

- [ ] **The story stops at the Core reveal.** Six transmissions + a victory
      screen. There is no Core *chamber* — the win fires on crossing 4,700m in
      open cave, not on arriving somewhere built. A carved chamber with the
      monolith in it would make arrival feel like arrival. (Reachability is
      already proven: flood fill shows connected open space down to 4,975m, so
      no approach shaft is needed.)

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
