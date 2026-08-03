import {normalizeCableType} from './NetworkSystem.js';

export class CableSystem {
    constructor(game) {
        this.game=game;
        this.segments=[]; // Fixed cable segments {x1, y1, x2, y2, type}
        this.spools=new Map(); // Active spools (dropped) {id, x, y, type, anchorX, anchorY, body}

        // Players carrying cables
        // Map<playerId, {type, anchorX, anchorY, anchorId}>
        this.activeLines=new Map();

        this.nextId=1;
        this.MAX_LENGTH=game.config?.difficulty?.buildCableMaxLength??120;
    }

    // Any change to the laid cable invalidates the resolved network graph.
    markNetworksDirty() {
        this.game.networks?.markDirty();
    }

    // Player starts a new cable line from a location (usually a building/pad or existing cable end)
    startLine(playerId, x, y, type, anchorId=null) {
        // Types arrive as 'power'/'fuel'/'data' from the client and as
        // 'cable_red'/'cable_green'/'cable_blue' from crafted items.
        const net=normalizeCableType(type);
        if (!net) return {success: false, reason: 'invalid_cable_type'};

        this.activeLines.set(playerId, {
            type: net,
            anchorX: x,
            anchorY: y,
            anchorId: anchorId
        });
        return {success: true, type: net};
    }

    // Direct segment creation, used by Game.placeCableSegment().
    addSegment(x1, y1, x2, y2, type) {
        const net=normalizeCableType(type);
        if (!net) return {success: false, reason: 'invalid_cable_type'};

        const dx=x2-x1;
        const dy=y2-y1;
        if (Math.sqrt(dx*dx+dy*dy)>this.MAX_LENGTH) {
            return {success: false, reason: 'too_long'};
        }

        const segment={id: this.nextId++, type: net, x1, y1, x2, y2};
        this.segments.push(segment);
        this.markNetworksDirty();
        return {success: true, segment};
    }

    // Player drops the cable line -> Becomes a physics spool
    dropLine(playerId, x, y) {
        const line=this.activeLines.get(playerId);
        if (!line) return {success: false};

        // Create physics body for spool
        const spoolId=`spool_${this.nextId++}`;
        const size=6;
        const body=this.game.physics.createBox(x, y, size, size, 5); // 5kg mass

        // Add to spools. x/y are seeded from the drop point rather than left
        // undefined: update() only fills them on the next physics tick, and
        // attachLine() may read them before then.
        this.spools.set(spoolId, {
            id: spoolId,
            type: line.type,
            x: x,
            y: y,
            anchorX: line.anchorX,
            anchorY: line.anchorY,
            anchorId: line.anchorId,
            body: body,
            bodyId: this.game.physics.bodies.indexOf(body) // Track index? Or just object
        });

        // Remove from player
        this.activeLines.delete(playerId);

        return {success: true, spoolId};
    }

    // Player picks up a dropped spool
    pickupSpool(playerId, spoolId) {
        const spool=this.spools.get(spoolId);
        if (!spool) return {success: false};

        // Remove physics body
        this.game.physics.removeBody(spool.body);

        // Add to player active lines, preserving which building the run started
        // from so the finished chain still resolves to that node.
        this.activeLines.set(playerId, {
            type: spool.type,
            anchorX: spool.anchorX,
            anchorY: spool.anchorY,
            anchorId: spool.anchorId??null
        });

        this.spools.delete(spoolId);
        return {success: true};
    }

    // Player attaches line to a target (Building or Wall) -> Finalizes segment
    // 1 Basic material per run laid (GDD 6.2).
    SEGMENT_COST=1;

    canAffordSegment(playerId) {
        const player=this.game.players.get(playerId);
        if (player?.infiniteFuel) return true;
        return this.game.baseResources.basic>=this.SEGMENT_COST;
    }

    chargeSegment(playerId, count=1) {
        const player=this.game.players.get(playerId);
        if (player?.infiniteFuel) return;
        this.game.baseResources.basic=Math.max(0, this.game.baseResources.basic-this.SEGMENT_COST*count);
        this.game.broadcast('resourcesUpdated', this.game.baseResources);
    }

    attachLine(playerId, x, y, targetId=null) {
        const line=this.activeLines.get(playerId);
        if (!line) return {success: false};

        if (!this.canAffordSegment(playerId)) {
            return {success: false, reason: 'no_materials'};
        }

        // Check if target is a Spool (Connect two loose ends)
        if (targetId&&this.spools.has(targetId)) {
            const spool=this.spools.get(targetId);

            // Check type match
            if (spool.type!==line.type) {
                return {success: false, reason: 'cable_type_mismatch'};
            }

            // Dist check to spool
            const idx=spool.x-line.anchorX;
            const idy=spool.y-line.anchorY;
            if (Math.sqrt(idx*idx+idy*idy)>this.MAX_LENGTH) {
                return {success: false, reason: 'too_long'};
            }

            // 1. Convert Spool's loose rope to a fixed segment
            this.segments.push({
                id: this.nextId++,
                type: spool.type,
                x1: spool.anchorX,
                y1: spool.anchorY,
                x2: spool.x,
                y2: spool.y
            });

            // 2. Create connecting segment (Active Line -> Spool)
            this.segments.push({
                id: this.nextId++,
                type: line.type,
                x1: line.anchorX,
                y1: line.anchorY,
                x2: spool.x,
                y2: spool.y
            });

            // 3. Remove Spool
            if (spool.body) this.game.physics.removeBody(spool.body);
            this.spools.delete(targetId);

            // 4. Finish Active Line (Connection Complete)
            this.activeLines.delete(playerId);

            this.chargeSegment(playerId);
            this.markNetworksDirty();
            return {success: true, connected: true};
        }

        // Standard Attach (Continue Line)
        const dx=x-line.anchorX;
        const dy=y-line.anchorY;
        const dist=Math.sqrt(dx*dx+dy*dy);

        if (dist>this.MAX_LENGTH) return {success: false, reason: 'too_long'};

        // Create Segment
        const segment={
            id: this.nextId++,
            type: line.type,
            x1: line.anchorX,
            y1: line.anchorY,
            x2: x,
            y2: y
        };
        this.segments.push(segment);
        this.chargeSegment(playerId);
        this.markNetworksDirty();

        // Attaching to a building ends the run there. Attaching to bare rock
        // leaves the line live so the player can keep chaining onward.
        if (targetId) {
            this.activeLines.delete(playerId);
            return {success: true, segment, connected: true};
        }

        this.activeLines.set(playerId, {
            type: line.type,
            anchorX: x,
            anchorY: y,
            anchorId: null
        });

        return {success: true, segment};
    }

    update(dt) {
        // Update spool positions from physics bodies
        for (const spool of this.spools.values()) {
            if (spool.body) {
                const ms=spool.body.getMotionState();
                if (ms) {
                    const t=new this.game.physics.ammo.btTransform();
                    ms.getWorldTransform(t);
                    const o=t.getOrigin();
                    spool.x=o.x();
                    spool.y=o.y();

                    // Rope Constraint Logic (Simple distance limit)
                    const dx=spool.x-spool.anchorX;
                    const dy=spool.y-spool.anchorY;
                    const dist=Math.sqrt(dx*dx+dy*dy);

                    if (dist>this.MAX_LENGTH) {
                        // Pull back hard
                        const factor=(dist-this.MAX_LENGTH)*0.1; // Spring k
                        const angle=Math.atan2(dy, dx);
                        const fx=-Math.cos(angle)*factor*500;
                        const fy=-Math.sin(angle)*factor*500;

                        // Apply central force
                        spool.body.applyCentralForce(new this.game.physics.ammo.btVector3(fx, fy, 0));

                        // Damping
                        const vel=spool.body.getLinearVelocity();
                        spool.body.setLinearVelocity(new this.game.physics.ammo.btVector3(vel.x()*0.9, vel.y()*0.9, 0));
                    }
                }
            }
        }
    }

    serialize() {
        // Combine fixed segments and active spool lines for client rendering
        const allCables=[...this.segments];

        // Add spools (visual lines from anchor to spool)
        for (const spool of this.spools.values()) {
            allCables.push({
                type: spool.type,
                x1: spool.anchorX,
                y1: spool.anchorY,
                x2: spool.x,
                y2: spool.y,
                id: spool.id,
                isSpool: true // Client can render spool sprite at x2,y2
            });
        }

        // Note: Active player lines are not serialized here, 
        // they are usually predicted on client or sent via player state.
        // But for other players to see your cable, we might want to add them?
        // Let's add them as 'preview' lines tied to players.
        for (const [pid, line] of this.activeLines) {
            const player=this.game.players.get(pid);
            if (player) {
                allCables.push({
                    type: line.type,
                    x1: line.anchorX,
                    y1: line.anchorY,
                    x2: player.x,
                    y2: player.y,
                    isPreview: true,
                    playerId: pid
                });
            }
        }

        return allCables;
    }
}
