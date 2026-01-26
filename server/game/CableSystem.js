
export class CableSystem {
    constructor(game) {
        this.game=game;
        this.cables=[]; // {id, type, x1, y1, x2, y2}
        this.nextCableId=1;

        // Networks
        // Map<NodeID, NetworkID>
        this.networks={
            power: new Map(),
            fuel: new Map(),
            data: new Map()
        };

        // Next available network ID
        this.nextNetworkId=1;

        this.MAX_SEGMENT_LENGTH=120;
    }

    // Add a cable segment between two points
    // Returns {success: true/false, cable}
    addSegment(x1, y1, x2, y2, type) {
        // Validate length
        const dx=x2-x1;
        const dy=y2-y1;
        const dist=Math.sqrt(dx*dx+dy*dy);

        if (dist>this.MAX_SEGMENT_LENGTH) {
            return {success: false, reason: 'too_long', dist};
        }

        // Validate cost (1 Basic Material per 100m - roughly 1 per segment)
        // Game.js handles cost deduction before calling, OR we assume 1 item = 1 cable segment

        const cable={
            id: this.nextCableId++,
            type: type, // 'power', 'fuel', 'data'
            x1: x1,
            y1: y1,
            x2: x2,
            y2: y2
        };

        this.cables.push(cable);

        // Rebuild network connectivity (Optimization: Union-Find incrementally)
        // For now, simple rebuild if needed, or just store the visual.
        // GDD says "Data Cable merges radar networks".

        return {success: true, cable};
    }

    // Check if a point is within range of any Data Cable network connected to a specific antenna
    // This is effectively "is point visible to player?" logic.
    // Simplifying assumption: All cables connected to the Main Base (Landing Pad) share data.
    // If a remote antenna is connected via Data Cable to Main Base, its range is added to Main Base visibility.

    // Get all cable segments
    serialize() {
        return this.cables.map(c => ({
            id: c.id,
            type: c.type,
            x1: c.x1,
            y1: c.y1,
            x2: c.x2,
            y2: c.y2
        }));
    }
}
