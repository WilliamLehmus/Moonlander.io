export const TileTypes={
    EMPTY: 0,
    GROUND: 1,
    PAD: 2,
    BASE: 3,
    REGOLITH: 4,
    ROCK: 5,
    HARD_ROCK: 6,
    // Metal ores
    IRON_ORE: 10,
    TITANIUM_ORE: 11,
    COPPER_ORE: 12,
    GOLD_ORE: 13,
    PLATINUM_ORE: 14,
    HELIUM3_DEPOSIT: 15
};

export class VoxelMap {
    constructor(width=400, height=500, tileSize=8) { // Increased height from 200 to 500
        this.width=width;
        this.height=height;
        this.tileSize=tileSize;
        this.tiles=[];
        this.collisionBodies=new Map(); // "x,y" -> body
        this.physicsWorld=null;

        // Moon base location (set during generation)
        this.basePosition=null; // {x, y} in world coords
        this.basePadBounds=null; // {x1, y1, x2, y2} in world coords for landing detection

        // Initialize empty grid
        for (let y=0; y<height; y++) {
            this.tiles[y]=new Array(width).fill(TileTypes.EMPTY);
        }
    }

    setPhysicsWorld(physicsWorld) {
        this.physicsWorld=physicsWorld;
    }

    generate() {
        console.log("Generating new terrain...");

        // 1. Generate Surface Heights (surface at ~15% from top to leave room for sky)
        const surfaceHeights=new Array(this.width);
        const baseline=Math.floor(this.height*0.15);
        const amplitude=15;

        for (let x=0; x<this.width; x++) {
            // Simple noise using multiple sines
            let h=Math.sin(x*0.05)*amplitude;
            h+=Math.sin(x*0.12+1.5)*(amplitude*0.4);
            h+=Math.sin(x*0.02-0.5)*(amplitude*0.8);
            surfaceHeights[x]=baseline+Math.floor(h);
        }

        // 2. Fill Layers with depth-based rock types
        for (let x=0; x<this.width; x++) {
            const surfaceY=surfaceHeights[x];
            for (let y=0; y<this.height; y++) {
                // Edges are always solid
                if (x===0||x===this.width-1||y===this.height-1) {
                    this.tiles[y][x]=TileTypes.HARD_ROCK;
                    continue;
                }

                if (y>=surfaceY) {
                    const depth=y-surfaceY;
                    if (depth<8) {
                        this.tiles[y][x]=TileTypes.REGOLITH;
                    } else if (depth<150) {
                        this.tiles[y][x]=TileTypes.ROCK;
                    } else {
                        this.tiles[y][x]=TileTypes.HARD_ROCK;
                    }
                } else {
                    this.tiles[y][x]=TileTypes.EMPTY;
                }
            }
        }

        // 3. Create Meandering Caves (Worms/Drunkard's Walk)
        this.generateCaves(surfaceHeights);

        // 4. Generate ore clusters
        this.generateOres(surfaceHeights);

        // 5. Create Moon Base & Landing Pad
        this.createMoonBase(surfaceHeights);

        console.log(`VoxelMap generated: ${this.width}x${this.height} tiles`);
    }

    generateCaves(surfaceHeights) {
        const numWorms=15; // More worms for larger map
        const worms=[];

        // Start worms at random surface points
        for (let i=0; i<numWorms; i++) {
            const startX=Math.floor(Math.random()*(this.width-40))+20;
            worms.push({
                x: startX,
                y: surfaceHeights[startX]+5,
                angle: Math.PI/2+(Math.random()-0.5), // Mostly down
                radius: 4+Math.random()*5,
                life: 150+Math.random()*350
            });
        }

        while (worms.length>0) {
            const worm=worms.pop();

            for (let step=0; step<worm.life; step++) {
                // Carve circle
                const r=Math.floor(worm.radius);
                for (let dy=-r; dy<=r; dy++) {
                    for (let dx=-r; dx<=r; dx++) {
                        if (dx*dx+dy*dy<=worm.radius*worm.radius) {
                            const tx=Math.floor(worm.x+dx);
                            const ty=Math.floor(worm.y+dy);
                            if (tx>0&&tx<this.width-1&&ty>0&&ty<this.height-1) {
                                this.tiles[ty][tx]=TileTypes.EMPTY;
                            }
                        }
                    }
                }

                // Move worm
                worm.x+=Math.cos(worm.angle)*2;
                worm.y+=Math.sin(worm.angle)*2;

                // Update angle (meander)
                worm.angle+=(Math.random()-0.5)*0.4;

                // Bias downwards
                const targetAngle=Math.PI/2;
                worm.angle=worm.angle*0.9+targetAngle*0.1;

                // Randomly change radius
                worm.radius+=(Math.random()-0.5)*0.3;
                worm.radius=Math.max(3, Math.min(10, worm.radius));

                // Check bounds
                if (worm.x<=2||worm.x>=this.width-2||worm.y<=2||worm.y>=this.height-2) {
                    break;
                }

                // Chance to split
                if (Math.random()<0.025&&worms.length<25) {
                    worms.push({
                        x: worm.x,
                        y: worm.y,
                        angle: worm.angle+(Math.random()-0.5)*1.5,
                        radius: worm.radius*0.8,
                        life: worm.life-step
                    });
                }
            }
        }
    }

    generateOres(surfaceHeights) {
        // Define ore types with depth ranges and rarity
        const oreConfigs = [
            { type: TileTypes.IRON_ORE, minDepth: 10, maxDepth: 300, rarity: 0.015, clusterSize: 8 },
            { type: TileTypes.COPPER_ORE, minDepth: 20, maxDepth: 250, rarity: 0.012, clusterSize: 6 },
            { type: TileTypes.TITANIUM_ORE, minDepth: 80, maxDepth: 400, rarity: 0.008, clusterSize: 5 },
            { type: TileTypes.GOLD_ORE, minDepth: 150, maxDepth: 450, rarity: 0.004, clusterSize: 4 },
            { type: TileTypes.PLATINUM_ORE, minDepth: 250, maxDepth: 500, rarity: 0.002, clusterSize: 3 },
            { type: TileTypes.HELIUM3_DEPOSIT, minDepth: 300, maxDepth: 500, rarity: 0.001, clusterSize: 5 }
        ];

        // Generate ore clusters
        for (const config of oreConfigs) {
            for (let x = 5; x < this.width - 5; x++) {
                for (let y = 5; y < this.height - 5; y++) {
                    const surfaceY = surfaceHeights[Math.min(x, this.width - 1)];
                    const depth = y - surfaceY;

                    // Check if in valid depth range and tile is rock
                    if (depth >= config.minDepth && depth <= config.maxDepth) {
                        const tile = this.tiles[y][x];
                        if ((tile === TileTypes.ROCK || tile === TileTypes.HARD_ROCK) && Math.random() < config.rarity) {
                            // Create ore cluster
                            this.createOreCluster(x, y, config.type, config.clusterSize);
                        }
                    }
                }
            }
        }
    }

    createOreCluster(centerX, centerY, oreType, maxSize) {
        const clusterSize = Math.floor(maxSize * 0.5 + Math.random() * maxSize * 0.5);
        const visited = new Set();
        const queue = [[centerX, centerY]];

        let placed = 0;
        while (queue.length > 0 && placed < clusterSize) {
            const [x, y] = queue.shift();
            const key = `${x},${y}`;

            if (visited.has(key)) continue;
            visited.add(key);

            if (x <= 1 || x >= this.width - 2 || y <= 1 || y >= this.height - 2) continue;

            const tile = this.tiles[y][x];
            // Only replace rock tiles, not empty or special tiles
            if (tile === TileTypes.ROCK || tile === TileTypes.HARD_ROCK || tile === TileTypes.REGOLITH) {
                this.tiles[y][x] = oreType;
                placed++;

                // Add neighbors with decreasing probability
                const neighbors = [[x-1,y], [x+1,y], [x,y-1], [x,y+1]];
                for (const [nx, ny] of neighbors) {
                    if (Math.random() < 0.7) {
                        queue.push([nx, ny]);
                    }
                }
            }
        }
    }

    createMoonBase(surfaceHeights) {
        // Sprite dimensions (in tiles, approximate)
        const landingPadWidthTiles = 16;  // Landing platform is wider
        const landingPadHeightTiles = 8;
        const baseWidthTiles = 14;        // Moon base building
        const baseHeightTiles = 10;
        const gapTiles = 2;               // Gap between pad and base

        const totalWidth = landingPadWidthTiles + gapTiles + baseWidthTiles + 10; // Extra margin

        // Find a relatively flat spot near the center-left of the map
        let bestX = Math.floor(this.width * 0.3);
        let minVariance = Infinity;

        for (let x = 30; x < this.width - totalWidth - 30; x++) {
            let variance = 0;
            const startH = surfaceHeights[x];
            for (let i = 0; i < totalWidth; i++) {
                variance += Math.abs(surfaceHeights[x + i] - startH);
            }
            if (variance < minVariance) {
                minVariance = variance;
                bestX = x;
            }
        }

        // Use a consistent ground level for the entire base area
        const groundLevel = surfaceHeights[bestX + Math.floor(totalWidth / 2)];

        // Flatten the entire base area with extra margin
        const flattenMargin = 5;
        for (let x = bestX - flattenMargin; x < bestX + totalWidth + flattenMargin; x++) {
            if (x <= 0 || x >= this.width - 1) continue;

            // Clear everything above ground level
            for (let y = 1; y < groundLevel; y++) {
                this.tiles[y][x] = TileTypes.EMPTY;
            }

            // Create solid flat ground
            for (let y = groundLevel; y < groundLevel + 8; y++) {
                if (y < this.height - 1) {
                    this.tiles[y][x] = TileTypes.HARD_ROCK;
                }
            }
        }

        // Landing pad position (left side)
        const padStartX = bestX;
        const padEndX = padStartX + landingPadWidthTiles;

        // Mark landing pad tiles
        for (let x = padStartX; x < padEndX; x++) {
            this.tiles[groundLevel][x] = TileTypes.PAD;
        }

        // Base position (right side, after gap)
        const baseStartX = padEndX + gapTiles;
        const baseEndX = baseStartX + baseWidthTiles;

        // Mark base tiles (the sprite will be drawn over these)
        for (let y = groundLevel - baseHeightTiles; y <= groundLevel; y++) {
            for (let x = baseStartX; x < baseEndX; x++) {
                if (y > 0 && y < this.height && x > 0 && x < this.width) {
                    this.tiles[y][x] = TileTypes.BASE;
                }
            }
        }

        // Store positions for rendering
        // Landing pad center (where ships land)
        const padCenterX = padStartX + Math.floor(landingPadWidthTiles / 2);
        const padWorldPos = this.gridToWorld(padCenterX, groundLevel);

        // Base center (for sprite rendering)
        const baseCenterX = baseStartX + Math.floor(baseWidthTiles / 2);
        const baseWorldPos = this.gridToWorld(baseCenterX, groundLevel);

        // Landing pad bounds for landing detection
        const padLeftWorld = this.gridToWorld(padStartX, groundLevel);
        const padRightWorld = this.gridToWorld(padEndX - 1, groundLevel);

        this.basePadBounds = {
            x1: padLeftWorld.x - this.tileSize / 2,
            y1: padLeftWorld.y - this.tileSize * 6, // Height above pad for landing detection
            x2: padRightWorld.x + this.tileSize / 2,
            y2: padLeftWorld.y + this.tileSize / 2
        };

        // Store base and pad positions for rendering
        this.basePosition = {
            x: baseWorldPos.x,
            y: baseWorldPos.y
        };

        this.landingPadPosition = {
            x: padWorldPos.x,
            y: padWorldPos.y
        };

        // Spawn position is above the landing pad
        this.spawnPosition = {
            x: padWorldPos.x,
            y: padWorldPos.y - 50
        };

        console.log(`Moon base created: pad at (${this.landingPadPosition.x}, ${this.landingPadPosition.y}), base at (${this.basePosition.x}, ${this.basePosition.y})`);
    }

    isOnLandingPad(worldX, worldY) {
        if (!this.basePadBounds) return false;

        const b=this.basePadBounds;
        if (worldX<b.x1||worldX>b.x2||worldY<b.y1||worldY>b.y2) {
            return false;
        }

        const grid=this.worldToGrid(worldX, worldY+this.tileSize);
        const tile=this.get(grid.x, grid.y);
        return tile===TileTypes.PAD;
    }

    get(x, y) {
        if (x<0||x>=this.width||y<0||y>=this.height) {
            return TileTypes.HARD_ROCK; // Out of bounds is solid
        }
        return this.tiles[y][x];
    }

    set(x, y, value) {
        if (x<0||x>=this.width||y<0||y>=this.height) return;
        this.tiles[y][x]=value;
    }

    worldToGrid(wx, wy) {
        return {
            x: Math.floor(wx/this.tileSize),
            y: Math.floor(wy/this.tileSize)
        };
    }

    gridToWorld(gx, gy) {
        return {
            x: gx*this.tileSize+this.tileSize/2,
            y: gy*this.tileSize+this.tileSize/2
        };
    }

    destroyTile(gx, gy) {
        if (gx<=0||gx>=this.width-1||gy<=0||gy>=this.height-1) {
            return false;
        }

        const tile=this.tiles[gy][gx];
        if (tile===TileTypes.EMPTY||tile===TileTypes.BASE||tile===TileTypes.PAD) return false;

        this.tiles[gy][gx]=TileTypes.EMPTY;
        this.removeCollisionBody(gx, gy);
        return true;
    }

    createCollisionBody(gx, gy) {
        if (!this.physicsWorld||!this.physicsWorld.isReady) return null;

        const key=`${gx},${gy}`;
        if (this.collisionBodies.has(key)) return this.collisionBodies.get(key);

        const worldPos=this.gridToWorld(gx, gy);
        const body=this.physicsWorld.createBox(
            worldPos.x,
            worldPos.y,
            this.tileSize,
            this.tileSize,
            0
        );

        if (body) {
            this.collisionBodies.set(key, body);
        }
        return body;
    }

    removeCollisionBody(gx, gy) {
        if (!this.physicsWorld) return;

        const key=`${gx},${gy}`;
        const body=this.collisionBodies.get(key);
        if (body) {
            this.physicsWorld.world.removeRigidBody(body);
            this.collisionBodies.delete(key);
        }
    }

    // Check if a tile is on the surface (has at least one empty neighbor)
    isSurfaceTile(x, y) {
        if (this.tiles[y][x] === TileTypes.EMPTY) return false;

        // Check all 4 cardinal neighbors
        const neighbors = [
            [x-1, y], [x+1, y], [x, y-1], [x, y+1]
        ];

        for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
            if (this.tiles[ny][nx] === TileTypes.EMPTY) {
                return true; // Has an empty neighbor, so it's a surface tile
            }
        }
        return false;
    }

    createAllCollisionBodies() {
        console.log('Creating collision bodies (surface tiles only)...');
        let count=0;
        for (let y=0; y<this.height; y++) {
            for (let x=0; x<this.width; x++) {
                // Only create collision bodies for surface tiles
                if (this.isSurfaceTile(x, y)) {
                    this.createCollisionBody(x, y);
                    count++;
                }
            }
        }
        console.log(`Created ${count} collision bodies (optimized)`);
    }

    serialize() {
        return {
            width: this.width,
            height: this.height,
            tileSize: this.tileSize,
            tiles: this.tiles,
            basePosition: this.basePosition,
            landingPadPosition: this.landingPadPosition,
            basePadBounds: this.basePadBounds
        };
    }

    getSpawnPosition() {
        if (this.spawnPosition) {
            return this.spawnPosition;
        }
        if (this.landingPadPosition) {
            return {
                x: this.landingPadPosition.x,
                y: this.landingPadPosition.y - 50
            };
        }
        const spawnGridX = Math.floor(this.width / 2);
        const spawnGridY = 20;
        return this.gridToWorld(spawnGridX, spawnGridY);
    }
}

