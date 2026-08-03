export const TileTypes={
    EMPTY: 0,
    GROUND: 1,
    PAD: 2,
    BASE: 3,
    REGOLITH: 4,
    ROCK: 5,
    HARD_ROCK: 6,
    // Metal ores - ordered by depth/value
    IRON_ORE: 10,        // Shallow, common
    COPPER_ORE: 11,      // 50-200m, common
    BITITE: 12,          // Fuel-producing material, found at various depths
    SILVER_ORE: 13,      // 200-400m
    TITANIUM_ORE: 14,    // 300-600m
    GOLD_ORE: 15,        // 400-800m
    PLATINUM_ORE: 16,    // 800-1400m
    DIAMOND: 17,         // 3500-5000m, extremely rare
    HELIUM3: 18          // Deep pockets
};

// Simple Seeded Random Number Generator
class SeededRandom {
    constructor(seed) {
        this.seed=typeof seed==='number'? seed:this.hashString(seed);
    }

    hashString(str) {
        let hash=0;
        for (let i=0; i<str.length; i++) {
            const char=str.charCodeAt(i);
            hash=((hash<<5)-hash)+char;
            hash|=0; // Convert to 32bit integer
        }
        return hash;
    }

    // Returns a value between 0 and 1
    next() {
        this.seed=(this.seed*9301+49297)%233280;
        return this.seed/233280;
    }

    // Returns a value between min and max
    range(min, max) {
        return min+this.next()*(max-min);
    }

    // Returns an integer between min and max
    intRange(min, max) {
        return Math.floor(this.range(min, max));
    }
}

export class VoxelMap {
    constructor(width=400, height=5000, tileSize=8, profile='NORMAL') {
        this.width=width;
        this.height=height;
        this.tileSize=tileSize;
        this.tiles=[];
        this.collisionBodies=new Map(); // "x,y" -> body
        this.physicsWorld=null;

        // Moon base location (set during generation)
        this.basePosition=null; // {x, y} in world coords
        this.basePadBounds=null; // {x1, y1, x2, y2} in world coords for landing detection

        // Level Designer disabled for now - causes initialization issues
        this.levelDesigner=null;

        // Initialize empty grid
        for (let y=0; y<height; y++) {
            this.tiles[y]=new Array(width).fill(TileTypes.EMPTY);
        }

        // Initialize persistent mining progress (0 to 1)
        this.miningProgress=new Float32Array(width*height);
        this.damagedVoxels=new Set(); // Set of "x,y" strings
    }

    setPhysicsWorld(physicsWorld) {
        this.physicsWorld=physicsWorld;
    }

    generate(seed=Math.random()) {
        console.log(`Generating new terrain with seed: ${seed}...`);
        const random=new SeededRandom(seed);
        this.random=random; // Store for other methods

        // 1. Generate Surface Heights (Advanced Noise)
        const surfaceHeights=new Array(this.width);
        this.generateSurfaceHeights(surfaceHeights, seed);

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
                    const normalizedDepth=y/this.height;

                    // Biome-based rock types (Updated for 4000m Core depth)
                    if (depth<10) {
                        this.tiles[y][x]=TileTypes.REGOLITH; // Lunar Surface (0-10m)
                    } else if (normalizedDepth<0.277) {
                        this.tiles[y][x]=TileTypes.ROCK; // Shallow Caves
                    } else if (normalizedDepth<0.451) {
                        this.tiles[y][x]=TileTypes.ROCK; // Deep Tunnels
                    } else if (normalizedDepth<0.626) {
                        this.tiles[y][x]=TileTypes.HARD_ROCK; // Crystal Caverns
                    } else if (normalizedDepth<0.8) {
                        this.tiles[y][x]=TileTypes.HARD_ROCK; // Abyssal Depths
                    } else {
                        // The Core - Mixed extremely hard rock
                        this.tiles[y][x]=random.next()<0.8? TileTypes.HARD_ROCK:TileTypes.ROCK;
                    }
                } else {
                    this.tiles[y][x]=TileTypes.EMPTY;
                }
            }
        }

        // 3. Create DLA Slithering Caverns
        console.log('Generating DLA slithering caves...');
        this.generateDLACaves(surfaceHeights, random);

        // 3.5 Post-generation cleanup (Kill small debris blocking paths)
        console.log('Cleaning up small clusters...');
        this.cleanupClusters(10);

        // 4. Generate ore clusters
        console.log('Generating ores...');
        this.generateOres(surfaceHeights, random);

        // 5. Decorate Terrain (Stalactites, texture variation)
        console.log('Decorating terrain...');
        this.decorateTerrain(surfaceHeights, random);

        // 6. Create Moon Base & Landing Pad
        console.log('Creating moon base...');
        this.createMoonBase(surfaceHeights);

        console.log(`VoxelMap generated: ${this.width}x${this.height} tiles`);
    }

    generateSurfaceHeights(surfaceHeights, seed) {
        // Simple 1D value noise implementation specifically for this method
        const noise=(x, s) => {
            const n=Math.sin(x*12.9898+s*78.233)*43758.5453123;
            return n-Math.floor(n);
        };

        const smoothNoise=(x, s) => {
            const i=Math.floor(x);
            const f=x-i;
            const y0=noise(i, s);
            const y1=noise(i+1, s);
            // Cubic interpolation
            const t=f*f*(3-2*f);
            return y0+(y1-y0)*t;
        };

        const fractalNoise=(x, octaves, persistence, scale, s) => {
            let total=0;
            let frequency=scale;
            let amplitude=1;
            let maxValue=0;
            for (let i=0; i<octaves; i++) {
                total+=smoothNoise(x*frequency, s+i)*amplitude;
                maxValue+=amplitude;
                amplitude*=persistence;
                frequency*=2;
            }
            return total/maxValue;
        };

        const baseHeight=this.height*0.15; // Target surface around 15% down

        for (let x=0; x<this.width; x++) {
            const nx=x/this.width;

            // 1. Base Terrain (Large rolling hills)
            let h=fractalNoise(nx, 4, 0.5, 5, seed);

            // 2. Mountain Peaks (Ridged noise for sharp peaks)
            // |noise - 0.5| * 2 creates "valleys", inverting creates peaks
            let peaks=Math.abs(fractalNoise(nx, 5, 0.5, 12, seed+100)-0.5)*2;
            peaks=Math.pow(peaks, 3); // Sharpen the peaks

            // 3. Flatness Mask (Where should it be flat?)
            // High value = flat, Low value = mountainous
            let flatness=fractalNoise(nx, 2, 0.5, 3, seed+200);
            flatness=Math.pow(flatness, 2); // Contrast

            // Combine
            // If very flat, reduce peak influence
            const finalNoise=h*0.4+peaks*(1-flatness)*1.5;

            // Map to height (0-1 -> 0-Height)
            // Amplitude varies: Flats have low amplitude, Mountains high
            const amplitude=10+(1-flatness)*50;

            surfaceHeights[x]=Math.floor(baseHeight+finalNoise*amplitude);
        }
    }

    generateDLACaves(surfaceHeights, random) {
        const numSpines=1; // Start with 1 spine per sector
        const numSectors=2; // Two main arteries as requested
        const sectorWidth=this.width/numSectors;

        // Initial seeds: Small paths into the ground
        const spinePositions=[];
        for (let i=0; i<numSectors; i++) {
            const startX=Math.floor(i*sectorWidth+sectorWidth/2+random.range(-20, 20));
            const startY=surfaceHeights[startX];

            // Carve initial entrance
            this.carveCircle(startX, startY+5, 6);
            spinePositions.push({x: startX, y: startY+5});
        }

        // DLA Simulation - Controlled growth
        // Drastically reduced for a tighter, more coherent look
        const totalSteps=600;
        for (let i=0; i<totalSteps; i++) {
            const targetSpine=spinePositions[random.intRange(0, spinePositions.length)];

            // Launch a walker even deeper ahead of the tip
            let wx=random.intRange(30, this.width-30);
            let wy=Math.min(this.height-10, targetSpine.y+random.intRange(50, 300));

            let maxWalkerLife=800;
            let lastX=wx, lastY=wy;

            while (maxWalkerLife-->0) {
                const dx=random.range(-1, 1);
                // Stronger upward bias + horizontal pull towards spine
                const dy=random.range(-1.8, 0.4);
                const hPull=(targetSpine.x-wx)*0.01;

                wx+=dx+hPull;
                wy+=dy;

                if (wx<5||wx>this.width-5||wy<5||wy>this.height-5) break;

                const tx=Math.floor(wx);
                const ty=Math.floor(wy);

                if (this.tiles[ty][tx]===TileTypes.EMPTY) {
                    // Slightly bigger radius for better playability
                    const radius=1.5+(1-ty/this.height)*1.8;
                    this.carveCircle(lastX, lastY, radius);

                    if (ty>targetSpine.y) {
                        targetSpine.x=lastX;
                        targetSpine.y=lastY;
                    }
                    break;
                }
                lastX=wx; lastY=wy;
            }
        }

        // Connection reinforcement
        spinePositions.forEach(pos => {
            this.createMainShaft(pos.x, pos.y, random);
        });
    }

    cleanupClusters(minSize=10) {
        // Fast visited tracking
        const visited=new Uint8Array(this.width*this.height);

        for (let y=0; y<this.height; y++) {
            for (let x=0; x<this.width; x++) {
                const idx=y*this.width+x;

                // If it's a solid tile and not visited
                if (this.tiles[y][x]!==TileTypes.EMPTY&&!visited[idx]) {
                    const cluster=[];
                    const queue=[[x, y]];
                    visited[idx]=1;

                    let head=0;
                    while (head<queue.length) {
                        const [cx, cy]=queue[head++];
                        cluster.push([cx, cy]);

                        // Check 4-way neighbors
                        const neighbors=[[cx-1, cy], [cx+1, cy], [cx, cy-1], [cx, cy+1]];
                        for (const [nx, ny] of neighbors) {
                            if (nx>=0&&nx<this.width&&ny>=0&&ny<this.height) {
                                const nIdx=ny*this.width+nx;
                                if (this.tiles[ny][nx]!==TileTypes.EMPTY&&!visited[nIdx]) {
                                    visited[nIdx]=1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }

                        // Optimization: if cluster already exceeds minSize, we can stop early
                        // but we still need to mark the rest of the cluster as visited to avoid re-checking
                        // So we continue the flood fill but don't need to keep track of the coordinates
                        if (queue.length>minSize*10) {
                            // This is large enough to not be "debris"
                            // Just finish marking visited
                            while (head<queue.length) {
                                const [qx, qy]=queue[head++];
                                const qNeighbors=[[qx-1, qy], [qx+1, qy], [qx, qy-1], [qx, qy+1]];
                                for (const [nqx, nqy] of qNeighbors) {
                                    if (nqx>=0&&nqx<this.width&&nqy>=0&&nqy<this.height) {
                                        const nqIdx=nqy*this.width+nqx;
                                        if (this.tiles[nqy][nqx]!==TileTypes.EMPTY&&!visited[nqIdx]) {
                                            visited[nqIdx]=1;
                                            queue.push([nqx, nqy]);
                                        }
                                    }
                                }
                            }
                            cluster.length=minSize+1; // Mark as "large"
                            break;
                        }
                    }

                    // Kill small clusters
                    if (cluster.length<minSize) {
                        for (const [cx, cy] of cluster) {
                            this.tiles[cy][cx]=TileTypes.EMPTY;
                        }
                    }
                }
            }
        }
    }

    carveCircle(centerX, centerY, radius) {
        const r=Math.ceil(radius);
        for (let dy=-r; dy<=r; dy++) {
            for (let dx=-r; dx<=r; dx++) {
                if (dx*dx+dy*dy<=radius*radius+this.random.range(-1, 1)) {
                    const tx=Math.floor(centerX+dx);
                    const ty=Math.floor(centerY+dy);
                    if (tx>1&&tx<this.width-2&&ty>1&&ty<this.height-2) {
                        this.tiles[ty][tx]=TileTypes.EMPTY;
                    }
                }
            }
        }
    }

    createMainShaft(startX, startY, random) {
        const worms=[];
        // Increased radius for a more spacious spine
        worms.push({
            x: startX, y: startY, angle: Math.PI/2, radius: 7,
            life: this.height-startY-20, type: 'TRUNK', depth: 0,
            maxLife: this.height-startY-20
        });

        while (worms.length>0) {
            const worm=worms.pop();
            for (let step=0; step<worm.life; step++) {
                this.carveCircle(worm.x, worm.y, worm.radius);
                worm.x+=Math.cos(worm.angle);
                worm.y+=Math.sin(worm.angle);

                if (worm.type==='TRUNK') {
                    const progress=1-(step/worm.maxLife);
                    // Dwindle down but maintain a minimum functional width
                    worm.radius=worm.radius*0.97+(1.8+progress*5.2)*0.03;
                    worm.angle+=(random.next()-0.5)*0.1;
                    worm.angle=worm.angle*0.97+(Math.PI/2)*0.03;

                    if (random.next()<0.02&&worm.depth<2) {
                        const branchDir=random.next()<0.5? -1:1;
                        worms.push({
                            x: worm.x, y: worm.y,
                            angle: (Math.PI/2)+branchDir*(random.range(0.2, 0.7)),
                            radius: worm.radius*0.6,
                            life: 40+random.range(0, 100),
                            type: 'BRANCH', depth: worm.depth+1
                        });
                    }
                } else {
                    worm.angle+=(random.next()-0.5)*0.25;
                    worm.angle=worm.angle*0.97+(Math.PI/2)*0.03;
                    worm.radius=Math.max(1.5, worm.radius*0.99);
                }
                if (worm.x<=5||worm.x>=this.width-5||worm.y>=this.height-5) break;
            }
        }
    }

    decorateTerrain(surfaceHeights, random) {
        for (let y=1; y<this.height-1; y++) {
            for (let x=1; x<this.width-1; x++) {
                if (this.tiles[y][x]===TileTypes.EMPTY) continue;
                const above=this.tiles[y-1][x];
                const below=this.tiles[y+1][x];

                if (above!==TileTypes.EMPTY&&below===TileTypes.EMPTY) {
                    if (random.next()<0.15) {
                        let length=Math.floor(random.range(1, 4));
                        for (let k=1; k<=length; k++) {
                            if (y+k<this.height-1&&this.tiles[y+k][x]===TileTypes.EMPTY) {
                                this.tiles[y+k][x]=this.tiles[y][x];
                            }
                        }
                    }
                }
                if (above===TileTypes.EMPTY&&below!==TileTypes.EMPTY) {
                    if (random.next()<0.15) {
                        let length=Math.floor(random.range(1, 4));
                        for (let k=1; k<=length; k++) {
                            if (y-k>0&&this.tiles[y-k][x]===TileTypes.EMPTY) {
                                this.tiles[y-k][x]=this.tiles[y][x];
                            }
                        }
                    }
                }
            }
        }
    }

    generateChambers(surfaceHeights) {
        if (!this.levelDesigner) return;
        const profile=this.levelDesigner.profile;
        const chamberFrequency=profile.chamberFrequency||0.1;

        // Find cave entrance points and add chambers along the caves
        const potentialChamberSites=[];

        // Scan for empty tiles that could host chambers
        for (let y=Math.floor(this.height*0.2); y<this.height-30; y+=20) {
            for (let x=20; x<this.width-20; x+=15) {
                if (this.tiles[y][x]===TileTypes.EMPTY) {
                    // Check if this is inside a cave (surrounded by some solid)
                    let solidNeighbors=0;
                    for (let dy=-5; dy<=5; dy++) {
                        for (let dx=-5; dx<=5; dx++) {
                            if (this.tiles[y+dy]?.[x+dx]!==TileTypes.EMPTY) {
                                solidNeighbors++;
                            }
                        }
                    }
                    if (solidNeighbors>30) { // At least some walls nearby
                        potentialChamberSites.push({x, y});
                    }
                }
            }
        }

        // Randomly select and create chambers
        const chamberCount=Math.floor(potentialChamberSites.length*chamberFrequency);
        const shuffled=potentialChamberSites.sort(() => Math.random()-0.5);

        for (let i=0; i<Math.min(chamberCount, shuffled.length); i++) {
            const site=shuffled[i];
            const template=this.levelDesigner.selectChamberTemplate(site.y);
            this.carveChamber(site.x, site.y, template);
        }

        console.log(`Created ${Math.min(chamberCount, shuffled.length)} chambers`);
    }

    carveChamber(centerX, centerY, template) {
        const width=template.minWidth+Math.floor(Math.random()*(template.maxWidth-template.minWidth));
        const height=template.minHeight+Math.floor(Math.random()*(template.maxHeight-template.minHeight));

        const halfW=Math.floor(width/2);
        const halfH=Math.floor(height/2);

        // Carve elliptical chamber
        for (let y=-halfH; y<=halfH; y++) {
            for (let x=-halfW; x<=halfW; x++) {
                // Ellipse check
                const nx=x/halfW;
                const ny=y/halfH;
                if (nx*nx+ny*ny<=1) {
                    const tx=centerX+x;
                    const ty=centerY+y;
                    if (tx>1&&tx<this.width-2&&ty>1&&ty<this.height-2) {
                        this.tiles[ty][tx]=TileTypes.EMPTY;
                    }
                }
            }
        }

        // Add flat floor for rest stops
        if (template.features?.includes('flat_floor')) {
            for (let x=-halfW+2; x<=halfW-2; x++) {
                const tx=centerX+x;
                const ty=centerY+halfH;
                if (tx>1&&tx<this.width-2&&ty<this.height-2) {
                    // Make floor flat by filling
                    this.tiles[ty][tx]=TileTypes.HARD_ROCK;
                }
            }
        }

        // Add ore walls for mineral shafts
        if (template.features?.includes('ore_walls')||template.features?.includes('rich_ore')) {
            const depth=centerY/this.height;
            let oreType=TileTypes.IRON_ORE;
            if (depth>0.7) oreType=TileTypes.PLATINUM_ORE;
            else if (depth>0.5) oreType=TileTypes.GOLD_ORE;
            else if (depth>0.3) oreType=TileTypes.TITANIUM_ORE;

            // Add ore around edges
            for (let y=-halfH; y<=halfH; y++) {
                for (let x=-halfW; x<=halfW; x++) {
                    const nx=x/halfW;
                    const ny=y/halfH;
                    const dist=Math.sqrt(nx*nx+ny*ny);
                    if (dist>0.7&&dist<=1.1&&Math.random()<0.3) {
                        const tx=centerX+x;
                        const ty=centerY+y;
                        if (tx>1&&tx<this.width-2&&ty>1&&ty<this.height-2) {
                            if (this.tiles[ty][tx]!==TileTypes.EMPTY) {
                                this.tiles[ty][tx]=oreType;
                            }
                        }
                    }
                }
            }
        }

        // Store chamber info
        if (this.levelDesigner) {
            this.levelDesigner.chambers.push({
                x: centerX,
                y: centerY,
                width,
                height,
                template: template.name
            });
        }
    }

    generateOres(surfaceHeights, random) {
        const oreConfigs=[
            {type: TileTypes.IRON_ORE, minDepth: 10, maxDepth: 400, rarity: 0.015, clusterSize: 8},
            {type: TileTypes.COPPER_ORE, minDepth: 50, maxDepth: 250, rarity: 0.018, clusterSize: 7},
            {type: TileTypes.BITITE, minDepth: 100, maxDepth: 850, rarity: 0.009, clusterSize: 6},
            {type: TileTypes.SILVER_ORE, minDepth: 200, maxDepth: 500, rarity: 0.010, clusterSize: 5},
            {type: TileTypes.TITANIUM_ORE, minDepth: 400, maxDepth: 700, rarity: 0.006, clusterSize: 5},
            {type: TileTypes.GOLD_ORE, minDepth: 600, maxDepth: 850, rarity: 0.004, clusterSize: 4},
            {type: TileTypes.PLATINUM_ORE, minDepth: 600, maxDepth: 1000, rarity: 0.003, clusterSize: 4},
            {type: TileTypes.DIAMOND, minDepth: 900, maxDepth: 1200, rarity: 0.001, clusterSize: 2},
            {type: TileTypes.HELIUM3, minDepth: 800, maxDepth: 1200, rarity: 0.001, clusterSize: 2}
        ];

        for (const config of oreConfigs) {
            for (let x=5; x<this.width-5; x++) {
                for (let y=5; y<this.height-5; y++) {
                    const surfaceY=surfaceHeights[Math.min(x, this.width-1)];
                    const depth=y-surfaceY;

                    if (depth>=config.minDepth&&depth<=config.maxDepth) {
                        const tile=this.tiles[y][x];
                        if ((tile===TileTypes.ROCK||tile===TileTypes.HARD_ROCK)&&random.next()<config.rarity) {
                            this.createOreCluster(x, y, config.type, config.clusterSize, random);
                        }
                    }
                }
            }
        }
    }

    createOreCluster(centerX, centerY, oreType, maxSize, random) {
        const clusterSize=Math.floor(maxSize*0.5+random.next()*maxSize*0.5);
        const visited=new Set();
        const queue=[[centerX, centerY]];

        let placed=0;
        while (queue.length>0&&placed<clusterSize) {
            const [x, y]=queue.shift();
            const key=`${x},${y}`;
            if (visited.has(key)) continue;
            visited.add(key);
            if (x<=1||x>=this.width-2||y<=1||y>=this.height-2) continue;

            const tile=this.tiles[y][x];
            if (tile===TileTypes.ROCK||tile===TileTypes.HARD_ROCK||tile===TileTypes.REGOLITH) {
                this.tiles[y][x]=oreType;
                placed++;
                const neighbors=[[x-1, y], [x+1, y], [x, y-1], [x, y+1]];
                for (const [nx, ny] of neighbors) {
                    if (random.next()<0.7) {
                        queue.push([nx, ny]);
                    }
                }
            }
        }
    }

    createMoonBase(surfaceHeights) {
        // Sprite dimensions (in tiles, approximate)
        const landingPadWidthTiles=16;  // Landing platform is wider
        const landingPadHeightTiles=8;
        const baseWidthTiles=14;        // Moon base building
        const baseHeightTiles=10;
        const gapTiles=2;               // Gap between pad and base

        const totalWidth=landingPadWidthTiles+gapTiles+baseWidthTiles+10; // Extra margin

        // Find a relatively flat spot near the center-left of the map
        let bestX=Math.floor(this.width*0.3);
        let minVariance=Infinity;

        for (let x=30; x<this.width-totalWidth-30; x++) {
            let variance=0;
            const startH=surfaceHeights[x];
            for (let i=0; i<totalWidth; i++) {
                variance+=Math.abs(surfaceHeights[x+i]-startH);
            }
            if (variance<minVariance) {
                minVariance=variance;
                bestX=x;
            }
        }

        // Use a consistent ground level for the entire base area
        const groundLevel=surfaceHeights[bestX+Math.floor(totalWidth/2)];

        // Flatten the entire base area with extra margin
        const flattenMargin=5;
        for (let x=bestX-flattenMargin; x<bestX+totalWidth+flattenMargin; x++) {
            if (x<=0||x>=this.width-1) continue;

            // Clear everything above ground level
            for (let y=1; y<groundLevel; y++) {
                this.tiles[y][x]=TileTypes.EMPTY;
            }

            // Create solid flat ground
            for (let y=groundLevel; y<groundLevel+8; y++) {
                if (y<this.height-1) {
                    this.tiles[y][x]=TileTypes.HARD_ROCK;
                }
            }
        }

        // Landing pad position (left side)
        const padStartX=bestX;
        const padEndX=padStartX+landingPadWidthTiles;

        // Mark landing pad tiles (Now with a 4-tile thick physical platform)
        for (let y=groundLevel-4; y<=groundLevel; y++) {
            for (let x=padStartX; x<padEndX; x++) {
                if (y>0&&y<this.height) {
                    this.tiles[y][x]=TileTypes.PAD;
                }
            }
        }

        // Base position (right side, after gap)
        const baseStartX=padEndX+gapTiles;
        const baseEndX=baseStartX+baseWidthTiles;

        // Mark base tiles (the sprite will be drawn over these)
        for (let y=groundLevel-baseHeightTiles; y<=groundLevel; y++) {
            for (let x=baseStartX; x<baseEndX; x++) {
                if (y>0&&y<this.height&&x>0&&x<this.width) {
                    this.tiles[y][x]=TileTypes.BASE;
                }
            }
        }

        // Store positions for rendering
        // Landing pad center (where ships land)
        const padCenterX=padStartX+Math.floor(landingPadWidthTiles/2);
        const padWorldPos=this.gridToWorld(padCenterX, groundLevel);

        // Base center (for sprite rendering)
        const baseCenterX=baseStartX+Math.floor(baseWidthTiles/2);
        const baseWorldPos=this.gridToWorld(baseCenterX, groundLevel);

        // Landing pad bounds for landing detection (Significanty shrunk)
        const platformY=groundLevel-4;
        const platformWorldPos=this.gridToWorld(padCenterX, platformY);
        const padLeftWorld=this.gridToWorld(padStartX, groundLevel);
        const padRightWorld=this.gridToWorld(padEndX-1, groundLevel);

        this.basePadBounds={
            x1: padLeftWorld.x-this.tileSize*4,
            y1: platformWorldPos.y-this.tileSize*8, // Reduced from 25 to 8 for tighter docking
            x2: padRightWorld.x+this.tileSize*4,
            y2: platformWorldPos.y+this.tileSize*2
        };



        // Store base and pad positions for rendering
        this.basePosition={
            x: baseWorldPos.x,
            y: baseWorldPos.y
        };

        this.landingPadPosition={
            x: padWorldPos.x,
            y: padWorldPos.y
        };

        // NEW: Store positions for all buildings
        // The Landing Pad and Habitat are the starting base (GDD 5.4). Both need
        // a position here or they cannot act as network nodes or cable endpoints:
        // getBuildingLocation() is what makes a building addressable at all.
        // The Habitat sits on the moonbase sprite, which is what it renders as.
        this.buildingPositions=[
            {id: 'landing_pad', x: padWorldPos.x, y: padWorldPos.y},
            {id: 'habitat', x: baseWorldPos.x, y: baseWorldPos.y},
            {id: 'ore_storage', x: baseWorldPos.x+120, y: baseWorldPos.y},
            {id: 'fuel_depot', x: baseWorldPos.x+240, y: baseWorldPos.y},
            {id: 'parts_warehouse', x: baseWorldPos.x+360, y: baseWorldPos.y},
            {id: 'fuel_refinery', x: baseWorldPos.x+480, y: baseWorldPos.y},
            {id: 'solar_array', x: baseWorldPos.x+600, y: baseWorldPos.y},
            {id: 'fuel_generator', x: baseWorldPos.x+720, y: baseWorldPos.y},
            {id: 'communications_antenna', x: baseWorldPos.x+840, y: baseWorldPos.y},
            {id: 'ship_factory', x: baseWorldPos.x+960, y: baseWorldPos.y},
            {id: 'crafting_station', x: baseWorldPos.x+1080, y: baseWorldPos.y}
        ];

        // Ensure ground is flat under all buildings
        const endBuildingX=baseStartX+(10*15); // Approximate 15 tiles per building
        for (let x=baseStartX; x<baseStartX+150; x++) {
            for (let y=groundLevel; y<groundLevel+8; y++) {
                if (y<this.height-1&&x<this.width-1) {
                    this.tiles[y][x]=TileTypes.HARD_ROCK;
                }
            }
        }

        // Spawn position is above the landing pad
        // Spawn position is above the landing pad
        this.spawnPosition={
            x: padWorldPos.x,
            y: padWorldPos.y-150
        };

        console.log(`Moon base created: pad at (${this.landingPadPosition.x}, ${this.landingPadPosition.y}), base at (${this.basePosition.x}, ${this.basePosition.y})`);
    }

    getBuildingLocation(id) {
        if (!this.buildingPositions) return null;
        return this.buildingPositions.find(b => b.id===id);
    }

    isOnLandingPad(worldX, worldY) {
        if (!this.basePadBounds) return false;

        const b=this.basePadBounds;
        if (worldX<b.x1||worldX>b.x2||worldY<b.y1||worldY>b.y2) {
            return false;
        }

        return true;
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
        // Reset mining progress when tile type changes
        this.miningProgress[y*this.width+x]=0;
    }

    damageTile(x, y, amount) {
        if (x<0||x>=this.width||y<0||y>=this.height) return 0;
        const idx=y*this.width+x;
        this.miningProgress[idx]+=amount;
        if (this.miningProgress[idx]>0) {
            this.damagedVoxels.add(`${x},${y}`);
        }
        return this.miningProgress[idx];
    }

    getMiningProgress(x, y) {
        if (x<0||x>=this.width||y<0||y>=this.height) return 0;
        return this.miningProgress[y*this.width+x];
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
        this.miningProgress[gy*this.width+gx]=0; // Reset progress
        this.damagedVoxels.delete(`${gx},${gy}`);

        // 1. Remove the old collision body (handles merged bodies internally)
        this.removeCollisionBody(gx, gy);

        // 2. Check all 4 neighbors. If they are now surface tiles, ensure they have collision.
        this.ensureTileCollision(gx-1, gy);
        this.ensureTileCollision(gx+1, gy);
        this.ensureTileCollision(gx, gy-1);
        this.ensureTileCollision(gx, gy+1);

        return true;
    }

    ensureTileCollision(gx, gy) {
        if (gx<0||gx>=this.width||gy<0||gy>=this.height) return;

        // If it's solid and now on the surface, it needs a body
        if (this.tiles[gy][gx]!==TileTypes.EMPTY&&this.isSurfaceTile(gx, gy)) {
            if (!this.collisionBodies.has(`${gx},${gy}`)) {
                this.createCollisionBody(gx, gy);
            }
        } else {
            // If it's no longer a surface tile (rare during destruction, but possible if it was a floating pixel)
            // Or if it was already empty. 
            // We just leave it.
        }
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
            // Remove the body from physics world
            this.physicsWorld.world.removeRigidBody(body);

            // If it's a merged body, clean up all its cell mappings in the Map
            if (body._voxelRange) {
                const {startX, endX, y}=body._voxelRange;
                for (let x=startX; x<=endX; x++) {
                    this.collisionBodies.delete(`${x},${y}`);
                }
            } else {
                this.collisionBodies.delete(key);
            }

            // Clean up Ammo object (optional but good practice)
            // Note: In some Ammo builds, you should destroy shapes etc. 
            // but here we reuse shapes if possible or let Ammo handle it.
        }
    }

    // Check if a tile is on the surface (has at least one empty neighbor)
    isSurfaceTile(x, y) {
        if (this.tiles[y][x]===TileTypes.EMPTY) return false;

        // Check all 4 cardinal neighbors
        const neighbors=[
            [x-1, y], [x+1, y], [x, y-1], [x, y+1]
        ];

        for (const [nx, ny] of neighbors) {
            if (nx<0||nx>=this.width||ny<0||ny>=this.height) continue;
            if (this.tiles[ny][nx]===TileTypes.EMPTY) {
                return true; // Has an empty neighbor, so it's a surface tile
            }
        }
        return false;
    }

    createAllCollisionBodies() {
        console.log('Creating collision bodies (Horizontal merging optimization)...');
        let count=0;

        // Horizontal scanline merging
        for (let y=0; y<this.height; y++) {
            let startX=-1;
            for (let x=0; x<this.width; x++) {
                // Determine if this tile needs a collision body
                const tile=this.tiles[y][x];
                const isSolid=tile!==TileTypes.EMPTY&&tile!==TileTypes.BASE;
                const needsBody=isSolid&&this.isSurfaceTile(x, y);

                if (needsBody) {
                    if (startX===-1) startX=x;
                } else {
                    if (startX!==-1) {
                        // Create a merged box for the range [startX, x-1]
                        this.createMergedCollisionBody(startX, x-1, y);
                        count++;
                        startX=-1;
                    }
                }
            }
            // Catch trailing segment
            if (startX!==-1) {
                this.createMergedCollisionBody(startX, this.width-1, y);
                count++;
            }
        }

        console.log(`Created ${count} optimized collision bodies (down from ~${this.width*this.height*0.2})`);

        // Create landing platform collision body if bounds exist
        if (this.basePadBounds&&this.physicsWorld&&this.physicsWorld.isReady) {
            // Fix: Position platform slightly above the actual grid tiles to ensure docking interaction.
            // landingPadPosition.y is middle of the tile (groundLevel * 8 + 4).
            // We set centered platform at y - 2, with height 8.
            // Top surface will be at (y - 2) - 4 = y - 6.
            // Which is (groundLevel * 8 + 4) - 6 = groundLevel * 8 - 2.
            // This is 2 pixels ABOVE the terrain tiles (groundLevel * 8).
            const platformY=this.landingPadPosition.y-2;
            const platformWidth=(this.basePadBounds.x2-this.basePadBounds.x1);
            const platformHeight=8;
            const platformX=(this.basePadBounds.x1+this.basePadBounds.x2)/2;

            const padBody=this.physicsWorld.createBox(
                platformX,
                platformY,
                platformWidth,
                platformHeight,
                0
            );
            if (padBody) {
                padBody.setFriction(10.0); // Extreme friction for landing stability
                padBody.setRestitution(0.1); // Low bounce
            }
            console.log(`Created landing platform at y=${platformY} (visual surface at ${platformY-4})`);
        }
    }

    createMergedCollisionBody(startX, endX, y) {
        if (!this.physicsWorld||!this.physicsWorld.isReady) return null;

        const widthTiles=(endX-startX)+1;
        const width=widthTiles*this.tileSize;

        // Center position of the merged box
        const worldX=(startX*this.tileSize+endX*this.tileSize+this.tileSize)/2;
        const worldY=y*this.tileSize+this.tileSize/2;

        const body=this.physicsWorld.createBox(
            worldX,
            worldY,
            width,
            this.tileSize,
            0
        );

        if (body) {
            // Map every tile in the merged box to this body so destroyTile still works
            for (let x=startX; x<=endX; x++) {
                this.collisionBodies.set(`${x},${y}`, body);
            }
            // Store the range on the body for potential splitting in the future
            body._voxelRange={startX, endX, y};
        }
        return body;
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

    getBuildingLocation(id) {
        if (!this.buildingPositions) return null;
        return this.buildingPositions.find(p => p.id===id);
    }

    getSpawnPosition() {
        if (this.spawnPosition) {
            // Add random X spread for multiple players (+/- 50 pixels)
            return {
                x: this.spawnPosition.x+(Math.random()-0.5)*100,
                y: this.spawnPosition.y
            };
        }
        if (this.landingPadPosition) {
            return {
                x: this.landingPadPosition.x,
                y: this.landingPadPosition.y-50
            };
        }
        const spawnGridX=Math.floor(this.width/2);
        const spawnGridY=20;
        return this.gridToWorld(spawnGridX, spawnGridY);
    }
}

