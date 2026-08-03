# Moonlander.io — TODO

Picking-up-where-we-left-off list. Grouped by what it costs you, not by system.

**Before changing anything**, run the check harnesses — 86 checks, ~20 seconds:

```
cd server && node tests/run-all.mjs
```

They boot a real `Game` with real physics and real terrain, so they catch
integration breakage, not just unit slips. Terrain is randomly seeded per run,
so run them **two or three times** after touching map generation or placement —
several bugs found so far only appeared on some seeds.

---

## 1. Finish the base-building loop

- [ ] **Buildings are not hauled.** GDD §5.2 says a building occupies 2x2 cargo
      slots and has to be flown to the site. Right now you place it from the
      build menu and it is paid for out of base materials. The placement, zone,
      spacing, terrain and connectivity rules are all real and tested — only the
      hauling loop is missing. Needs `craftItem` + cargo/inventory work, which
      nothing has touched yet.
      *This is the biggest remaining gap between the doc and the game.*

- [ ] **You cannot remove or move a building.** No demolish, no refund, no
      relocate. Misplace a Fuel Depot and it is there forever, drawing power.
      Cheap to add (`Game.structures.delete` + refund a fraction) and it will be
      the first thing anyone asks for.

- [ ] **Second bases have no way to get power.** A remote Landing Pad starts
      dark and correctly stays dark, but the only generators are the Habitat
      (starts at home, cannot be built), the Solar Array (dies below 60m depth)
      and the Fuel Generator (needs a fuel line). Check that founding a working
      underground base is actually *possible* end to end — I verified the pad
      places and stays unpowered, but never played the full loop through.

## 2. Known-wrong numbers

- [ ] **Bitite runs out at ~4,180m** but the Core is at 4,250–5,000m. The last
      800m of the descent has no fuel source in it, so a Core run must carry its
      return fuel through the hardest stretch. That may be a *good* difficulty
      spike — but right now it is an accident, and GDD §10.1 still claims Bitite
      is found at all depths. Decide: extend the band, or keep it and write it
      up as intentional.

- [ ] **`getBuildingEffect()` has an off-by-one.** It computes
      `base + level*perLevel`, so a Level 1 building already gets one increment
      above its base value. The comment block in `Game.js` shows the intent was
      `base + (level-1)*perLevel` and it was never resolved. It governs storage
      capacities. `NetworkSystem` deliberately does *not* use it — all power,
      fuel and data scaling uses the `(level-1)` convention — so the two do not
      have to be reconciled urgently, but they do disagree.

- [ ] **`buildingCosts` has dead entries.** `fuel_refinery`, `solar_array` and
      `ship_factory` define 12 levels; `canAffordUpgrade` caps at 4. Entries
      5–12 are unreachable.

- [ ] **`config.difficulty.cableMaxLength` is misnamed.** It only ever feeds the
      *tether* (`Player.js`, `Game.js`). Build-cable length is the separate
      `buildCableMaxLength`. Rename it `tetherMaxLength` next time the tether is
      touched, before someone "fixes" the wrong one.

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

- [ ] **Multiplayer is untested for all of this.** Every system built recently
      (networks, placement, story beats) is server-authoritative and broadcasts
      to the room, but I only ever exercised it with one simulated player. Story
      beats in particular are keyed to the *team's* deepest point and have never
      been watched with two clients connected.

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
