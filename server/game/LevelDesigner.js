/**
 * LevelDesigner - Specialist module for creating interesting, balanced,
 * and challenging procedural map generation for 2D cave exploration games.
 *
 * Design Philosophy:
 * - Risk vs Reward: Deeper = more dangerous but more valuable
 * - Multiple valid paths: No single "correct" route
 * - Emergent gameplay: Systems create unexpected situations
 * - Landmark variety: Distinct areas players can remember and navigate by
 * - Flow and pacing: Alternating tension and relief
 */

// TileTypes defined locally to avoid circular import
const TileTypes={
    EMPTY: 0,
    GROUND: 1,
    PAD: 2,
    BASE: 3,
    REGOLITH: 4,
    ROCK: 5,
    HARD_ROCK: 6,
    IRON_ORE: 10,
    TITANIUM_ORE: 11,
    COPPER_ORE: 12,
    GOLD_ORE: 13,
    PLATINUM_ORE: 14,
    HELIUM3_DEPOSIT: 15
};

// ============================================
// LEVEL GENERATION PROFILES
// ============================================

export const LevelProfiles={
    // Beginner-friendly with wide tunnels and gradual difficulty
    EASY: {
        name: 'Easy',
        caveWidthMin: 8,
        caveWidthMax: 15,
        branchChance: 0.3,
        hazardDensity: 0.1,
        oreDensity: 1.2,
        chamberFrequency: 0.15,
        verticalBias: 0.6, // How much caves prefer going down vs sideways
    },

    // Balanced challenge with varied tunnel sizes
    NORMAL: {
        name: 'Normal',
        caveWidthMin: 5,
        caveWidthMax: 12,
        branchChance: 0.4,
        hazardDensity: 0.25,
        oreDensity: 1.0,
        chamberFrequency: 0.12,
        verticalBias: 0.5,
    },

    // Tight tunnels, more hazards, strategic resource placement
    HARD: {
        name: 'Hard',
        caveWidthMin: 3,
        caveWidthMax: 8,
        branchChance: 0.5,
        hazardDensity: 0.4,
        oreDensity: 0.8,
        chamberFrequency: 0.08,
        verticalBias: 0.4,
    },

    // Extreme challenge - claustrophobic with sparse resources
    NIGHTMARE: {
        name: 'Nightmare',
        caveWidthMin: 2,
        caveWidthMax: 5,
        branchChance: 0.6,
        hazardDensity: 0.6,
        oreDensity: 0.5,
        chamberFrequency: 0.05,
        verticalBias: 0.3,
    }
};

// ============================================
// BIOME DEFINITIONS
// ============================================

export const Biomes={
    SURFACE: {
        name: 'Lunar Surface',
        depthStart: 0,
        depthEnd: 0.102,
        primaryTile: TileTypes.REGOLITH,
        ambientLight: 1.0,
        hazards: [],
        ores: [],
        description: 'The barren lunar surface with loose regolith'
    },

    SHALLOW_CAVES: {
        name: 'Shallow Caves',
        depthStart: 0.102,
        depthEnd: 0.277,
        primaryTile: TileTypes.ROCK,
        ambientLight: 0.6,
        hazards: ['loose_rocks'],
        ores: [TileTypes.IRON_ORE, TileTypes.COPPER_ORE],
        description: 'Upper cave system with iron and copper'
    },

    DEEP_TUNNELS: {
        name: 'Deep Tunnels',
        depthStart: 0.277,
        depthEnd: 0.451,
        primaryTile: TileTypes.ROCK,
        ambientLight: 0.3,
        hazards: ['gas_pockets'],
        ores: [TileTypes.SILVER_ORE, TileTypes.TITANIUM_ORE],
        description: 'Twisting tunnels with silver and titanium'
    },

    CRYSTAL_CAVERNS: {
        name: 'Crystal Caverns',
        depthStart: 0.451,
        depthEnd: 0.626,
        primaryTile: TileTypes.HARD_ROCK,
        ambientLight: 0.15,
        hazards: ['unstable_formations'],
        ores: [TileTypes.GOLD_ORE, TileTypes.BITITE],
        description: 'Crystalline formations and gold veins'
    },

    ABYSSAL_DEPTHS: {
        name: 'Abyssal Depths',
        depthStart: 0.626,
        depthEnd: 0.8,
        primaryTile: TileTypes.HARD_ROCK,
        ambientLight: 0.05,
        hazards: ['lava_proximity'],
        ores: [TileTypes.PLATINUM_ORE],
        description: 'Near-total darkness with precious platinum'
    },

    THE_CORE: {
        name: 'The Core',
        depthStart: 0.8,
        depthEnd: 1.0,
        primaryTile: TileTypes.HARD_ROCK,
        ambientLight: 0.0,
        hazards: ['radiation', 'magnetic_anomalies'],
        ores: [TileTypes.DIAMOND],
        description: 'The mysterious lunar core with Diamond'
    }
};

// ============================================
// CHAMBER TEMPLATES
// ============================================

export const ChamberTemplates={
    // Large open area for rest and refueling
    REST_STOP: {
        name: 'Rest Stop',
        minWidth: 15,
        maxWidth: 25,
        minHeight: 10,
        maxHeight: 15,
        features: ['flat_floor', 'emergency_supplies'],
        spawnWeight: 1.0,
        description: 'Safe landing zone with flat floor'
    },

    // Ore-rich vertical shaft
    MINERAL_SHAFT: {
        name: 'Mineral Shaft',
        minWidth: 8,
        maxWidth: 12,
        minHeight: 20,
        maxHeight: 40,
        features: ['ore_walls', 'vertical'],
        spawnWeight: 0.8,
        description: 'Vertical shaft with ore-lined walls'
    },

    // Wide cavern with multiple exits
    CROSSROADS: {
        name: 'Crossroads',
        minWidth: 20,
        maxWidth: 30,
        minHeight: 15,
        maxHeight: 20,
        features: ['multiple_exits', 'landmark'],
        spawnWeight: 0.6,
        description: 'Hub chamber connecting multiple tunnels'
    },

    // Narrow squeeze with rewards at the end
    TREASURE_POCKET: {
        name: 'Treasure Pocket',
        minWidth: 6,
        maxWidth: 10,
        minHeight: 6,
        maxHeight: 10,
        features: ['dead_end', 'rich_ore', 'tight_entrance'],
        spawnWeight: 0.5,
        description: 'Hidden pocket with concentrated ore'
    },

    // Dangerous but rewarding
    HAZARD_ZONE: {
        name: 'Hazard Zone',
        minWidth: 12,
        maxWidth: 20,
        minHeight: 12,
        maxHeight: 20,
        features: ['hazards', 'rare_ore', 'challenging_navigation'],
        spawnWeight: 0.4,
        description: 'Dangerous area with rare resources'
    },

    // Ancient structure hints
    ARTIFACT_CHAMBER: {
        name: 'Artifact Chamber',
        minWidth: 15,
        maxWidth: 20,
        minHeight: 15,
        maxHeight: 20,
        features: ['unusual_geometry', 'artifact', 'mystery'],
        spawnWeight: 0.1,
        description: 'Strange chamber with alien artifacts'
    }
};

// ============================================
// LEVEL DESIGNER CLASS
// ============================================

export class LevelDesigner {
    constructor(width, height, tileSize, profile=LevelProfiles.NORMAL) {
        this.width=width;
        this.height=height;
        this.tileSize=tileSize;
        this.profile=profile;

        // Analysis data
        this.chambers=[];
        this.tunnels=[];
        this.oreDeposits=[];
        this.pointsOfInterest=[];
    }

    /**
     * Get the biome at a given depth (0-1 normalized)
     */
    getBiomeAtDepth(normalizedDepth) {
        for (const [key, biome] of Object.entries(Biomes)) {
            if (normalizedDepth>=biome.depthStart&&normalizedDepth<biome.depthEnd) {
                return biome;
            }
        }
        return Biomes.THE_CORE;
    }

    /**
     * Get appropriate tile type for a depth
     */
    getTileTypeForDepth(y) {
        const normalizedDepth=y/this.height;
        const biome=this.getBiomeAtDepth(normalizedDepth);
        return biome.primaryTile;
    }

    /**
     * Calculate ore spawn chance based on depth and ore type
     */
    getOreSpawnChance(y, oreType) {
        const normalizedDepth=y/this.height;
        const biome=this.getBiomeAtDepth(normalizedDepth);

        // Check if this ore can spawn in this biome
        if (!biome.ores.includes(oreType)) {
            return 0;
        }

        // Base chance modified by profile
        const baseChance=0.02*this.profile.oreDensity;

        // Rarer ores have lower base chance
        const rarityMultiplier={
            [TileTypes.IRON_ORE]: 1.0,
            [TileTypes.COPPER_ORE]: 0.9,
            [TileTypes.TITANIUM_ORE]: 0.6,
            [TileTypes.GOLD_ORE]: 0.3,
            [TileTypes.PLATINUM_ORE]: 0.15,
            [TileTypes.HELIUM3_DEPOSIT]: 0.08
        };

        return baseChance*(rarityMultiplier[oreType]||0.5);
    }

    /**
     * Generate a worm path for cave carving
     * Uses "drunkard's walk" with directional bias
     */
    generateWormPath(startX, startY, length, preferredDirection=null) {
        const path=[];
        let x=startX;
        let y=startY;
        let direction=preferredDirection||(Math.PI/2); // Default: down

        for (let i=0; i<length; i++) {
            path.push({x, y, radius: this.getWormRadius(y)});

            // Adjust direction with some randomness
            const verticalBias=this.profile.verticalBias;
            const targetDirection=Math.PI/2; // Down

            // Blend current direction toward target with randomness
            direction+=(Math.random()-0.5)*1.5; // Random wobble
            direction=direction*(1-verticalBias*0.1)+targetDirection*verticalBias*0.1;

            // Clamp to prevent going back up too much
            direction=Math.max(0, Math.min(Math.PI, direction));

            // Move
            const speed=3+Math.random()*2;
            x+=Math.cos(direction)*speed;
            y+=Math.sin(direction)*speed;

            // Bounds check
            x=Math.max(5, Math.min(this.width-5, x));
            y=Math.max(5, Math.min(this.height-5, y));
        }

        return path;
    }

    /**
     * Get worm radius based on depth (tunnels get narrower deeper)
     */
    getWormRadius(y) {
        const normalizedDepth=y/this.height;
        const minRadius=this.profile.caveWidthMin;
        const maxRadius=this.profile.caveWidthMax;

        // Radius decreases with depth
        const depthFactor=1-normalizedDepth*0.5;
        const radius=minRadius+(maxRadius-minRadius)*depthFactor;

        // Add some variation
        return radius+(Math.random()-0.5)*2;
    }

    /**
     * Decide if a branch should spawn at this point
     */
    shouldBranch(y, existingBranches) {
        const normalizedDepth=y/this.height;
        const baseChance=this.profile.branchChance;

        // More branches in mid-depths
        const depthMultiplier=1-Math.abs(normalizedDepth-0.5)*0.5;

        // Reduce chance if many branches already
        const branchPenalty=Math.max(0, 1-existingBranches*0.1);

        return Math.random()<baseChance*depthMultiplier*branchPenalty;
    }

    /**
     * Select a chamber template appropriate for the depth
     */
    selectChamberTemplate(y) {
        const normalizedDepth=y/this.height;

        // Weight templates by depth appropriateness
        const validTemplates=Object.entries(ChamberTemplates).filter(([key, template]) => {
            // Rest stops more common near surface
            if (key==='REST_STOP'&&normalizedDepth>0.7) return false;
            // Artifact chambers only deep
            if (key==='ARTIFACT_CHAMBER'&&normalizedDepth<0.5) return false;
            // Treasure pockets more common deep
            if (key==='TREASURE_POCKET'&&normalizedDepth<0.3) return false;
            return true;
        });

        // Weighted random selection
        const totalWeight=validTemplates.reduce((sum, [, t]) => sum+t.spawnWeight, 0);
        let random=Math.random()*totalWeight;

        for (const [key, template] of validTemplates) {
            random-=template.spawnWeight;
            if (random<=0) {
                return template;
            }
        }

        return ChamberTemplates.REST_STOP;
    }

    /**
     * Generate ore cluster at position
     */
    generateOreCluster(centerX, centerY, oreType, size='medium') {
        const sizes={
            small: {count: 3, radius: 2},
            medium: {count: 6, radius: 3},
            large: {count: 12, radius: 5},
            massive: {count: 20, radius: 7}
        };

        const config=sizes[size]||sizes.medium;
        const positions=[];

        for (let i=0; i<config.count; i++) {
            const angle=Math.random()*Math.PI*2;
            const dist=Math.random()*config.radius;
            const x=Math.floor(centerX+Math.cos(angle)*dist);
            const y=Math.floor(centerY+Math.sin(angle)*dist);
            positions.push({x, y, type: oreType});
        }

        this.oreDeposits.push({
            center: {x: centerX, y: centerY},
            type: oreType,
            positions
        });

        return positions;
    }

    /**
     * Analyze a generated map for balance metrics
     */
    analyzeMap(tiles) {
        const analysis={
            totalEmpty: 0,
            totalSolid: 0,
            oresByType: {},
            oresByDepth: [],
            averageTunnelWidth: 0,
            chamberCount: 0,
            deadEnds: 0,
            connectivityScore: 0
        };

        // Count tiles
        for (let y=0; y<this.height; y++) {
            for (let x=0; x<this.width; x++) {
                const tile=tiles[y][x];
                if (tile===TileTypes.EMPTY) {
                    analysis.totalEmpty++;
                } else {
                    analysis.totalSolid++;
                    if (tile>=TileTypes.IRON_ORE) {
                        analysis.oresByType[tile]=(analysis.oresByType[tile]||0)+1;
                    }
                }
            }
        }

        // Calculate cave percentage
        analysis.cavePercentage=analysis.totalEmpty/(this.width*this.height);

        // Analyze ore distribution by depth
        const depthBuckets=10;
        for (let i=0; i<depthBuckets; i++) {
            analysis.oresByDepth[i]={depth: i/depthBuckets, ores: 0};
        }

        for (let y=0; y<this.height; y++) {
            const bucket=Math.floor((y/this.height)*depthBuckets);
            for (let x=0; x<this.width; x++) {
                if (tiles[y][x]>=TileTypes.IRON_ORE) {
                    analysis.oresByDepth[bucket].ores++;
                }
            }
        }

        return analysis;
    }

    /**
     * Generate design recommendations based on analysis
     */
    getDesignRecommendations(analysis) {
        const recommendations=[];

        // Check cave percentage
        if (analysis.cavePercentage<0.15) {
            recommendations.push({
                type: 'warning',
                message: 'Map may be too dense. Consider adding more caves.',
                metric: 'cavePercentage',
                value: analysis.cavePercentage,
                target: 0.2
            });
        } else if (analysis.cavePercentage>0.4) {
            recommendations.push({
                type: 'warning',
                message: 'Map may be too open. Consider reducing cave size.',
                metric: 'cavePercentage',
                value: analysis.cavePercentage,
                target: 0.25
            });
        }

        // Check ore distribution
        const deepOres=analysis.oresByDepth.slice(-3).reduce((sum, b) => sum+b.ores, 0);
        const shallowOres=analysis.oresByDepth.slice(0, 3).reduce((sum, b) => sum+b.ores, 0);

        if (deepOres<shallowOres*0.5) {
            recommendations.push({
                type: 'balance',
                message: 'Deep areas may not have enough ore rewards.',
                metric: 'deepOreRatio',
                value: deepOres/(shallowOres||1)
            });
        }

        // Check for rare ore presence
        if (!analysis.oresByType[TileTypes.PLATINUM_ORE]) {
            recommendations.push({
                type: 'content',
                message: 'No platinum ore found. Consider adding deep rare ore deposits.',
                metric: 'platinumPresence'
            });
        }

        return recommendations;
    }

    /**
     * Log design metrics for debugging
     */
    logDesignMetrics(tiles) {
        const analysis=this.analyzeMap(tiles);
        const recommendations=this.getDesignRecommendations(analysis);

        console.log('\n=== Level Design Analysis ===');
        console.log(`Profile: ${this.profile.name}`);
        console.log(`Dimensions: ${this.width}x${this.height}`);
        console.log(`Cave percentage: ${(analysis.cavePercentage*100).toFixed(1)}%`);
        console.log('\nOre distribution:');
        for (const [type, count] of Object.entries(analysis.oresByType)) {
            console.log(`  Type ${type}: ${count} tiles`);
        }
        console.log('\nOre by depth:');
        for (const bucket of analysis.oresByDepth) {
            const bar='█'.repeat(Math.floor(bucket.ores/10));
            console.log(`  ${(bucket.depth*100).toFixed(0)}%: ${bar} (${bucket.ores})`);
        }

        if (recommendations.length>0) {
            console.log('\nRecommendations:');
            for (const rec of recommendations) {
                console.log(`  [${rec.type.toUpperCase()}] ${rec.message}`);
            }
        }
        console.log('=============================\n');

        return analysis;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Smooth a cave using cellular automata
 */
export function smoothCaves(tiles, iterations=2) {
    const width=tiles[0].length;
    const height=tiles.length;

    for (let iter=0; iter<iterations; iter++) {
        const newTiles=tiles.map(row => [...row]);

        for (let y=1; y<height-1; y++) {
            for (let x=1; x<width-1; x++) {
                // Skip special tiles
                if (tiles[y][x]===TileTypes.PAD||tiles[y][x]===TileTypes.BASE) {
                    continue;
                }

                // Count solid neighbors
                let solidCount=0;
                for (let dy=-1; dy<=1; dy++) {
                    for (let dx=-1; dx<=1; dx++) {
                        if (tiles[y+dy][x+dx]!==TileTypes.EMPTY) {
                            solidCount++;
                        }
                    }
                }

                // Apply cellular automata rule
                if (solidCount>=5) {
                    newTiles[y][x]=tiles[y][x]||TileTypes.ROCK;
                } else if (solidCount<=3) {
                    newTiles[y][x]=TileTypes.EMPTY;
                }
            }
        }

        tiles=newTiles;
    }

    return tiles;
}

/**
 * Ensure all caves are connected
 */
export function ensureConnectivity(tiles, startX, startY) {
    const width=tiles[0].length;
    const height=tiles.length;

    // Flood fill from start to find connected caves
    const visited=new Set();
    const toVisit=[{x: startX, y: startY}];
    const connected=new Set();

    while (toVisit.length>0) {
        const {x, y}=toVisit.pop();
        const key=`${x},${y}`;

        if (visited.has(key)) continue;
        visited.add(key);

        if (x<0||x>=width||y<0||y>=height) continue;
        if (tiles[y][x]!==TileTypes.EMPTY) continue;

        connected.add(key);

        toVisit.push({x: x+1, y});
        toVisit.push({x: x-1, y});
        toVisit.push({x, y: y+1});
        toVisit.push({x, y: y-1});
    }

    // Find disconnected regions and connect them
    // (Implementation would carve tunnels between regions)

    return connected.size;
}

/**
 * Add interesting features to caves
 */
export function addCaveFeatures(tiles, designer) {
    const width=tiles[0].length;
    const height=tiles.length;

    // Add stalactites/stalagmites at cave ceilings/floors
    for (let y=1; y<height-1; y++) {
        for (let x=1; x<width-1; x++) {
            if (tiles[y][x]!==TileTypes.EMPTY) continue;

            // Stalactite: solid above, empty below
            if (tiles[y-1][x]!==TileTypes.EMPTY&&tiles[y+1][x]===TileTypes.EMPTY) {
                if (Math.random()<0.03) {
                    // Small stalactite
                    tiles[y][x]=designer.getTileTypeForDepth(y);
                }
            }

            // Stalagmite: solid below, empty above
            if (tiles[y+1][x]!==TileTypes.EMPTY&&tiles[y-1][x]===TileTypes.EMPTY) {
                if (Math.random()<0.03) {
                    tiles[y][x]=designer.getTileTypeForDepth(y);
                }
            }
        }
    }

    return tiles;
}

export default LevelDesigner;
