
export class CableSystem {
    constructor(game) {
        this.game=game;
        this.segments=[]; // Fixed cable segments {x1, y1, x2, y2, type}
        this.spools=new Map(); // Active spools (dropped) {id, x, y, type, anchorX, anchorY, body}

        // Players carrying cables
        // Map<playerId, {type, anchorX, anchorY, anchorId}>
        this.activeLines=new Map();

        this.nextId=1;
        this.MAX_LENGTH=120;
    }

    // Player starts a new cable line from a location (usually a building/pad or existing cable end)
    startLine(playerId, x, y, type, anchorId=null) {
        this.activeLines.set(playerId, {
            type,
            anchorX: x,
            anchorY: y,
            anchorId: anchorId
        });
        return {success: true};
    }

    // Player drops the cable line -> Becomes a physics spool
    dropLine(playerId, x, y) {
        const line=this.activeLines.get(playerId);
        if (!line) return {success: false};

        // Create physics body for spool
        const spoolId=`spool_${this.nextId++}`;
        const size=6;
        const body=this.game.physics.createBox(x, y, size, size, 5); // 5kg mass

        // Add to spools
        this.spools.set(spoolId, {
            id: spoolId,
            type: line.type,
            anchorX: line.anchorX,
            anchorY: line.anchorY,
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

        // Add to player active lines
        this.activeLines.set(playerId, {
            type: spool.type,
            anchorX: spool.anchorX,
            anchorY: spool.anchorY,
            anchorId: null // We don't link to previous anchor ID perfectly unless we tracked it.
            // For now, anchor is just a position.
        });

        this.spools.delete(spoolId);
        return {success: true};
    }

    // Player attaches line to a target (Building or Wall) -> Finalizes segment
    attachLine(playerId, x, y, targetId=null) {
        const line=this.activeLines.get(playerId);
        if (!line) return {success: false};

        // Validate length
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

        // Update player's active line to start from this new point (continue chaining)
        this.activeLines.set(playerId, {
            type: line.type,
            anchorX: x,
            anchorY: y,
            anchorId: targetId
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
                    isPreview: true
                });
            }
        }

        return allCables;
    }
}
