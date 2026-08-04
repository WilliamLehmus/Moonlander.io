// How close a player must physically be to a building to hook a cable onto it.
// Shared with main.js so the highlight, the click test and the server check all
// agree -- previously the client let you attach to anything under the cursor,
// anywhere on the map, which is why walking a cable out never mattered.
export const CABLE_ATTACH_RANGE=90;

// Particle class for fire/smoke/debris effects
class Particle {
    constructor(x, y, vx, vy, type='fire') {
        this.x=x;
        this.y=y;
        this.vx=vx;
        this.vy=vy;
        this.type=type; // 'fire', 'smoke', 'debris', or 'spark'
        this.life=1.0;

        // Configure based on type
        if (type==='fire') {
            this.maxLife=0.5;
            this.size=4+Math.random()*4;
        } else if (type==='smoke') {
            this.maxLife=1.2;
            this.size=6+Math.random()*6;
        } else if (type==='debris') {
            this.maxLife=1.5+Math.random()*1.0;
            this.size=3+Math.random()*5;
            this.rotation=Math.random()*Math.PI*2;
            this.rotationSpeed=(Math.random()-0.5)*15;
            this.color=Math.random()<0.5? '#888':'#666'; // Metal grays
        } else if (type==='spark') {
            this.maxLife=0.3+Math.random()*0.3;
            this.size=2+Math.random()*2;
        }

        this.decay=1/this.maxLife;
    }

    update(dt, voxelMap, tileSize) {
        // Apply gravity based on type
        let gravity;
        if (this.type==='fire') gravity=50;
        else if (this.type==='smoke') gravity=-20;
        else if (this.type==='debris') gravity=150; // Heavy debris falls fast
        else if (this.type==='spark') gravity=100;
        else gravity=50;

        this.vy+=gravity*dt;

        // Rotate debris
        if (this.type==='debris'&&this.rotation!==undefined) {
            this.rotation+=this.rotationSpeed*dt;
        }

        // Move
        const nextX=this.x+this.vx*dt;
        const nextY=this.y+this.vy*dt;

        // Check voxel collision
        if (voxelMap) {
            const gridX=Math.floor(nextX/tileSize);
            const gridY=Math.floor(nextY/tileSize);

            if (gridY>=0&&gridY<voxelMap.length&&
                gridX>=0&&gridX<voxelMap[0].length&&
                voxelMap[gridY][gridX]>0) { // Any non-empty tile is solid
                // Bounce off voxel
                const currentGridX=Math.floor(this.x/tileSize);
                const currentGridY=Math.floor(this.y/tileSize);

                if (currentGridX!==gridX) {
                    this.vx*=-0.5; // Bounce X with energy loss
                }
                if (currentGridY!==gridY) {
                    this.vy*=-0.5; // Bounce Y with energy loss
                }

                // Spawn smoke on collision for fire particles
                if (this.type==='fire'&&Math.random()<0.3) {
                    return {spawnSmoke: true, x: this.x, y: this.y};
                }
            } else {
                this.x=nextX;
                this.y=nextY;
            }
        } else {
            this.x=nextX;
            this.y=nextY;
        }

        // Decay life
        this.life-=this.decay*dt;
        return false;
    }

    draw(ctx) {
        if (this.life<=0) return;

        const alpha=this.life;
        const size=this.size*(0.5+this.life*0.5);

        if (this.type==='fire') {
            // Fire gradient: yellow -> orange -> red
            const r=255;
            const g=Math.floor(200*this.life);
            const b=0;
            ctx.fillStyle=`rgba(${r}, ${g}, ${b}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, size, 0, Math.PI*2);
            ctx.fill();
        } else if (this.type==='smoke') {
            // Smoke: gray fading out
            const gray=100+Math.floor(50*this.life);
            ctx.fillStyle=`rgba(${gray}, ${gray}, ${gray}, ${alpha*0.6})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, size, 0, Math.PI*2);
            ctx.fill();
        } else if (this.type==='debris') {
            // Debris: rotating metal fragments
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rotation||0);
            ctx.fillStyle=this.color||'#777';
            ctx.globalAlpha=alpha;
            // Draw irregular polygon shape
            ctx.beginPath();
            ctx.moveTo(-size, -size*0.5);
            ctx.lineTo(size*0.5, -size);
            ctx.lineTo(size, size*0.3);
            ctx.lineTo(-size*0.3, size);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        } else if (this.type==='spark') {
            // Sparks: bright orange/yellow points
            const r=255;
            const g=150+Math.floor(105*this.life);
            ctx.fillStyle=`rgba(${r}, ${g}, 50, ${alpha})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, size, 0, Math.PI*2);
            ctx.fill();
        }
    }
}

export class Renderer {
    constructor(canvas, soundManager) {
        this.canvas=canvas;
        this.soundManager=soundManager;
        this.ctx=canvas.getContext('2d');

        this.mouseX=0;
        this.mouseY=0;

        // Lighting system (must be created before resize)
        this.lightCanvas=document.createElement('canvas');
        this.lightCtx=this.lightCanvas.getContext('2d');

        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Voxel map data
        this.voxelMap=null;
        this.tileSize=8;
        this.mapWidth=0;
        this.mapHeight=0;

        // Camera
        this.cameraX=0;
        this.cameraY=0;
        this.cameraSmoothing=0.1;

        // Tile colors
        this.rockColor='#8d6e63';
        this.rockBorderColor='#5d4037';
        this.landingPadColor='#4a6b8a';
        this.moonBaseColor='#9b9b9b';

        // Moon base data
        this.basePosition=null;
        this.landingPadPosition=null;
        this.basePadBounds=null;

        // Sprite sheet for lander
        this.landerSprite=new Image();
        this.landerSprite.src='/sprites/moonlander_sprites.png';
        this.spriteLoaded=false;
        this.landerSprite.onload=() => {
            this.spriteLoaded=true;
            // 4x3 grid with 12 damage levels
            this.spriteFrameWidth=this.landerSprite.width/4;
            this.spriteFrameHeight=this.landerSprite.height/3;
            console.log(`Lander sprite loaded: ${this.spriteFrameWidth}x${this.spriteFrameHeight} per frame`);
        };

        // Cargo ship sprite
        this.cargoShipSprite=new Image();
        this.cargoShipSprite.src='/sprites/moonlander_cargo_sprites.png';
        this.cargoShipSpriteLoaded=false;
        this.cargoShipSprite.onload=() => {
            this.cargoShipSpriteLoaded=true;
            console.log(`Cargo ship sprite loaded`);
        };

        // Moon base sprite
        this.moonBaseSprite=new Image();
        this.moonBaseSprite.src='/sprites/moonbase_level1.png';
        this.moonBaseSpriteLoaded=false;
        this.moonBaseSprite.onload=() => {
            this.moonBaseSpriteLoaded=true;
            console.log(`Moon base sprite loaded: ${this.moonBaseSprite.width}x${this.moonBaseSprite.height}`);
        };

        // Landing platform sprite
        this.landingPlatformSprite=new Image();
        this.landingPlatformSprite.src='/sprites/landing_platform.png';
        this.landingPlatformSpriteLoaded=false;
        this.landingPlatformSprite.onload=() => {
            this.landingPlatformSpriteLoaded=true;
            console.log(`Landing platform sprite loaded: ${this.landingPlatformSprite.width}x${this.landingPlatformSprite.height}`);
        };

        // Materials sprite sheet
        this.materialsSprite=new Image();
        this.materialsSprite.src='/sprites/materials_spritesheet.png';
        this.materialsSpriteLoaded=false;
        this.materialsSprite.onload=() => {
            this.materialsSpriteLoaded=true;
            console.log(`Materials sprite sheet loaded`);
        };

        // Ores sprite sheet
        this.oresSprite=new Image();
        this.oresSprite.src='/sprites/ores_spritesheet.png';
        this.oresSpriteLoaded=false;
        this.oresSprite.onload=() => {
            this.oresSpriteLoaded=true;
            console.log(`Ores sprite sheet loaded`);
        };

        // NEW: Load building sprites
        this.buildingSprites={};
        const buildingSubtypes=[
            'ore_storage', 'fuel_depot', 'parts_warehouse',
            'fuel_refinery', 'solar_array', 'fuel_generator',
            'communications_antenna', 'ship_factory', 'crafting_station',
            'placeable_light'
        ];
        this.buildingsLoadedCount=0;
        buildingSubtypes.forEach(id => {
            const img=new Image();
            img.src=`/sprites/${id}.png`;
            img.onload=() => {
                this.buildingSprites[id]=img;
                this.buildingsLoadedCount++;
            };
        });

        // Particles
        this.particles=[];

        // Track previous damage for collision effects
        this.previousDamage=new Map();

        // Temporary message display
        this.message=null;
        this.messageTime=0;
        this.lastTime=performance.now();

        // Floating text for ore pickups
        this.floatingTexts=[];

        // Chat messages (displayed in bottom-left)
        this.chatMessages=[];
        this.chatDisplayDuration=8000; // 8 seconds to display

        // Lighting configuration
        this.surfaceY=0; // Will be set from map data (where full light starts)
        this.fullDarkDepth=300; // Tiles deep where it's completely dark
        this.spotlightRange=250; // How far the spotlight reaches
        this.spotlightAngle=Math.PI/6; // 30 degree cone
        this.positionLightRadius=40; // Small lights on the lander
        this.spotlightDepthPenetration=2; // Reduced from 3 to 2 to match new visual style (Outer + 1 inner)

        // Quickbar selection
        this.selectedQuickbarSlot=0;

        // Listen for quickbar selection events
        window.addEventListener('quickbarSelect', (e) => {
            this.selectedQuickbarSlot=e.detail.slot;
        });

        // NEW: Load Biome Backgrounds
        this.biomeBackgrounds={};
        const biomes=[
            'surface', 'shallow_caves', 'deep_tunnels',
            'crystal_caverns', 'abyssal_depths', 'the_core'
        ];
        biomes.forEach(id => {
            const img=new Image();
            img.src=`/backgrounds/biome_${id}.png`;
            img.onload=() => {
                this.biomeBackgrounds[id]=img;
            };
        });

        // NEW: Load Cable Spool Sprites
        this.cableSprites={};
        const cableTypes=['cable_red', 'cable_blue', 'cable_green'];
        cableTypes.forEach(id => {
            const img=new Image();
            img.src=`/sprites/${id}.png`;
            img.onload=() => {
                this.cableSprites[id]=img;
            };
        });

        // Debug flags
        this.debugVisualizeColliders=false;
    }

    resize() {
        this.canvas.width=window.innerWidth;
        this.canvas.height=window.innerHeight;
        // Also resize light canvas
        this.lightCanvas.width=this.canvas.width;
        this.lightCanvas.height=this.canvas.height;
    }

    setVoxelMap(data) {
        this.voxelMap=data.tiles;
        this.tileSize=data.tileSize;
        this.mapWidth=data.width;
        this.mapHeight=data.height;
        console.log(`Voxel map loaded: ${this.mapWidth}x${this.mapHeight} at ${this.tileSize}px`);
    }

    setMousePos(x, y) {
        this.mouseX=x;
        this.mouseY=y;
    }

    setTerrain(data) {
        if (data.tiles) {
            this.setVoxelMap(data);
        }
        if (data.basePosition) {
            this.basePosition=data.basePosition;
            console.log(`Moon base at: ${this.basePosition.x}, ${this.basePosition.y}`);
            // Set surface Y for lighting (base is on the surface)
            this.surfaceY=this.basePosition.y;
        }
        if (data.landingPadPosition) {
            this.landingPadPosition=data.landingPadPosition;
            console.log(`Landing pad at: ${this.landingPadPosition.x}, ${this.landingPadPosition.y}`);
        }
        if (data.basePadBounds) {
            this.basePadBounds=data.basePadBounds;
        }
        // Removed dynamic building positions from map data
        if (data.config&&data.config.difficulty) {
            console.log("Applying game config:", data.config);
            this.fullDarkDepth=data.config.difficulty.lightLossDepth||300;
        }
    }

    updateTile(x, y, value) {
        if (this.voxelMap&&y>=0&&y<this.mapHeight&&x>=0&&x<this.mapWidth) {
            this.voxelMap[y][x]=value;
        }
    }

    spawnThrustParticles(player) {
        const {x, y, angle, thrusting, fuel}=player;
        if (!thrusting||fuel<=0) return;

        // Sprite points UP at angle=0, so adjust by -PI/2 for calculations
        const thrustAngle=angle-Math.PI/2;

        // Spawn position at back of ship (opposite of thrust direction)
        const spawnDist=15;
        const backX=x-Math.cos(thrustAngle)*spawnDist;
        const backY=y-Math.sin(thrustAngle)*spawnDist;

        // Spawn fire particles
        for (let i=0; i<3; i++) {
            const spread=(Math.random()-0.5)*0.8;
            const speed=150+Math.random()*100;
            const particleAngle=thrustAngle+Math.PI+spread;

            const vx=Math.cos(particleAngle)*speed+(Math.random()-0.5)*30;
            const vy=Math.sin(particleAngle)*speed+(Math.random()-0.5)*30;

            this.particles.push(new Particle(
                backX+(Math.random()-0.5)*8,
                backY+(Math.random()-0.5)*8,
                vx, vy, 'fire'
            ));
        }

        // Occasionally spawn smoke
        if (Math.random()<0.3) {
            const speed=50+Math.random()*50;
            const particleAngle=thrustAngle+Math.PI+(Math.random()-0.5)*1.0;
            this.particles.push(new Particle(
                backX+(Math.random()-0.5)*10,
                backY+(Math.random()-0.5)*10,
                Math.cos(particleAngle)*speed,
                Math.sin(particleAngle)*speed,
                'smoke'
            ));
        }
    }

    spawnDeathExplosion(player) {
        const {x, y}=player;

        // Big explosion with lots of debris, fire, sparks, and smoke
        const debrisCount=25;
        const fireCount=40;
        const sparkCount=50;
        const smokeCount=20;

        // Debris flying everywhere
        for (let i=0; i<debrisCount; i++) {
            const speed=100+Math.random()*200;
            const dir=Math.random()*Math.PI*2;
            this.particles.push(new Particle(
                x+(Math.random()-0.5)*30,
                y+(Math.random()-0.5)*30,
                Math.cos(dir)*speed,
                Math.sin(dir)*speed-50,
                'debris'
            ));
        }

        // Fire burst
        for (let i=0; i<fireCount; i++) {
            const speed=50+Math.random()*150;
            const dir=Math.random()*Math.PI*2;
            this.particles.push(new Particle(
                x+(Math.random()-0.5)*20,
                y+(Math.random()-0.5)*20,
                Math.cos(dir)*speed,
                Math.sin(dir)*speed,
                'fire'
            ));
        }

        // Sparks scattering
        for (let i=0; i<sparkCount; i++) {
            const speed=150+Math.random()*250;
            const dir=Math.random()*Math.PI*2;
            this.particles.push(new Particle(
                x+(Math.random()-0.5)*15,
                y+(Math.random()-0.5)*15,
                Math.cos(dir)*speed,
                Math.sin(dir)*speed,
                'spark'
            ));
        }

        // Smoke cloud
        for (let i=0; i<smokeCount; i++) {
            const speed=30+Math.random()*60;
            const dir=Math.random()*Math.PI*2;
            this.particles.push(new Particle(
                x+(Math.random()-0.5)*40,
                y+(Math.random()-0.5)*40,
                Math.cos(dir)*speed,
                Math.sin(dir)*speed-30,
                'smoke'
            ));
        }
    }

    spawnDamageParticles(player, damageAmount) {
        const {x, y, angle}=player;

        // Scale particle count based on damage amount
        const debrisCount=Math.floor(3+damageAmount*5);
        const sparkCount=Math.floor(5+damageAmount*8);
        const smokeCount=Math.floor(2+damageAmount*3);

        // Spawn debris (metal fragments flying off)
        for (let i=0; i<debrisCount; i++) {
            const speed=80+Math.random()*120;
            const dir=Math.random()*Math.PI*2;
            this.particles.push(new Particle(
                x+(Math.random()-0.5)*20,
                y+(Math.random()-0.5)*20,
                Math.cos(dir)*speed,
                Math.sin(dir)*speed-30, // Slight upward bias
                'debris'
            ));
        }

        // Spawn sparks
        for (let i=0; i<sparkCount; i++) {
            const speed=100+Math.random()*150;
            const dir=Math.random()*Math.PI*2;
            this.particles.push(new Particle(
                x+(Math.random()-0.5)*15,
                y+(Math.random()-0.5)*15,
                Math.cos(dir)*speed,
                Math.sin(dir)*speed,
                'spark'
            ));
        }

        // Spawn smoke cloud
        for (let i=0; i<smokeCount; i++) {
            const speed=20+Math.random()*40;
            const dir=Math.random()*Math.PI*2;
            this.particles.push(new Particle(
                x+(Math.random()-0.5)*25,
                y+(Math.random()-0.5)*25,
                Math.cos(dir)*speed,
                Math.sin(dir)*speed-15,
                'smoke'
            ));
        }
    }

    updateParticles(dt) {
        const newSmoke=[];

        this.particles=this.particles.filter(p => {
            const result=p.update(dt, this.voxelMap, this.tileSize);
            if (result&&result.spawnSmoke) {
                newSmoke.push(new Particle(
                    result.x, result.y,
                    (Math.random()-0.5)*30,
                    -20-Math.random()*20,
                    'smoke'
                ));
            }
            return p.life>0;
        });

        this.particles.push(...newSmoke);

        // Limit particles
        if (this.particles.length>800) {
            this.particles=this.particles.slice(-800);
        }
    }

    // Calculate ambient darkness based on depth (0 = full light, 1 = complete darkness)
    calculateAmbientDarkness(worldY) {
        // Altitude above which it's always bright (surface + buffer)
        const lightBuffer=200;
        const depthBelowSurface=worldY-(this.surfaceY+lightBuffer);

        if (depthBelowSurface<=0) return 0; // Above or near surface = full light

        const darknessTileDepth=this.fullDarkDepth*this.tileSize;
        const darkness=Math.min(1, depthBelowSurface/darknessTileDepth);
        return darkness; // Allow full 100% darkness (was capped at 0.95)
    }

    // Calculate light intensity based on damage (1 = full, 0 = no light)
    calculateLightIntensity(damage) {
        const maxDamage=11;
        const healthPercent=1-(damage/maxDamage);
        // Light dims as damage increases
        return 0.3+healthPercent*0.7; // Min 30% light at max damage
    }

    // Check if light should flicker (returns multiplier 0-1)
    getLightFlicker(damage, time) {
        const maxDamage=11;
        const healthPercent=1-(damage/maxDamage);

        if (healthPercent>0.5) return 1; // No flicker above 50% health

        // Flicker intensity increases with damage
        const flickerChance=(1-healthPercent)*0.5;
        const flickerSpeed=10+(1-healthPercent)*30;

        // Create irregular flicker pattern
        const noise=Math.sin(time*flickerSpeed)*Math.cos(time*flickerSpeed*1.3);
        const flicker=noise>(1-flickerChance*2)? 0.3:1;

        return flicker;
    }

    // Draw the lighting layer
    drawLighting(players, myId, cameraX, cameraY) {
        const lCtx=this.lightCtx;
        const time=performance.now()/1000;

        // Find local player for calculating ambient darkness at their position
        const myPlayer=players.find(p => p.id===myId);
        const ambientDarkness=myPlayer? this.calculateAmbientDarkness(myPlayer.y):0.5;

        // Clear light canvas with darkness based on depth
        lCtx.clearRect(0, 0, this.lightCanvas.width, this.lightCanvas.height);
        lCtx.fillStyle=`rgba(0, 0, 15, ${ambientDarkness})`;
        lCtx.fillRect(0, 0, this.lightCanvas.width, this.lightCanvas.height);

        // Always process lights for glow additive pass (even in daylight)
        const isDark=ambientDarkness>0.02;

        // Use 'destination-out' to cut holes in the darkness for lights
        // Use 'destination-out' only if it's dark to reveals the base scene
        if (isDark) {
            lCtx.globalCompositeOperation='destination-out';
        } else {
            // In daylight, draw lights with 'lighter' to create a subtle additive glow
            lCtx.globalCompositeOperation='lighter';
        }

        // Draw lights for each player - only if it's dark
        if (isDark) {
            for (const player of players) {
                if (player.dead) continue;

                const screenX=player.x-cameraX;
                const screenY=player.y-cameraY;
                const damage=player.damage||0;

                // Calculate light intensity and flicker
                const intensity=this.calculateLightIntensity(damage);
                const flicker=this.getLightFlicker(damage, time+player.id.charCodeAt(0));
                const finalIntensity=intensity*flicker;

                // Position lights (small lights on the lander body)
                if (player.lightsOn!==false) {
                    this.drawPositionLights(lCtx, screenX, screenY, player.angle, finalIntensity);
                }

                // Spotlight
                if (player.spotlightOn!==false) {
                    this.drawSpotlight(lCtx, screenX, screenY, player.spotlightAngle||0, finalIntensity, player.id===myId);
                }

                // Thruster flame. `thrusting` was already synced for every
                // player and the flame was already drawn, but it emitted no
                // light -- so a burning engine lit nothing, for you or anyone
                // watching you. It is often the only light source a player has
                // left when their power is gone.
                if (player.thrusting) {
                    this.drawThrusterGlow(lCtx, screenX, screenY, player.angle||0, time+player.id.charCodeAt(0));
                }
            }
        }

        // Powered buildings emit light. Placeable Lights exist purely for this;
        // everything else gets a smaller working glow so a live base reads as
        // inhabited and, more usefully, so an unpowered one visibly goes dark.
        if (this._lightNodes) {
            for (const node of this._lightNodes) {
                const bx=node.x-cameraX;
                const by=node.y-cameraY;
                if (bx<-400||by<-400||bx>this.canvas.width+400||by>this.canvas.height+400) continue;

                const isLamp=node.key==='placeable_light';
                const radius=isLamp? 190:110;
                const strength=isLamp? 1:0.55;

                const g=lCtx.createRadialGradient(bx, by-10, 0, bx, by-10, radius);
                if (isDark) {
                    g.addColorStop(0, `rgba(255,255,255,${strength})`);
                    g.addColorStop(1, 'rgba(255,255,255,0)');
                } else {
                    g.addColorStop(0, `rgba(255,235,190,${0.28*strength})`);
                    g.addColorStop(1, 'rgba(255,235,190,0)');
                }
                lCtx.fillStyle=g;
                lCtx.beginPath();
                lCtx.arc(bx, by-10, radius, 0, Math.PI*2);
                lCtx.fill();
            }
        }

        // Draw ambient light around moon base with additive glow
        if (this.basePosition) {
            const baseScreenX=this.basePosition.x-cameraX;
            const baseScreenY=this.basePosition.y-cameraY;
            const baseRadius=250;

            const baseGradient=lCtx.createRadialGradient(baseScreenX, baseScreenY-30, 0, baseScreenX, baseScreenY-30, baseRadius);

            if (isDark) {
                // Erase darkness pass
                lCtx.globalCompositeOperation='destination-out';
                baseGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
                baseGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
                baseGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
                lCtx.fillStyle=baseGradient;
                lCtx.beginPath();
                lCtx.arc(baseScreenX, baseScreenY-30, baseRadius, 0, Math.PI*2);
                lCtx.fill();

                // Add color pass
                lCtx.globalCompositeOperation='lighter';
                const colorGradient=lCtx.createRadialGradient(baseScreenX, baseScreenY-30, 0, baseScreenX, baseScreenY-30, baseRadius);
                colorGradient.addColorStop(0, 'rgba(255, 255, 200, 0.4)');
                colorGradient.addColorStop(1, 'rgba(255, 255, 100, 0)');
                lCtx.fillStyle=colorGradient;
                lCtx.fill();
            } else {
                // Pure glow pass for daylight
                lCtx.globalCompositeOperation='lighter';
                baseGradient.addColorStop(0, 'rgba(255, 255, 220, 0.3)');
                baseGradient.addColorStop(1, 'rgba(255, 255, 150, 0)');
                lCtx.fillStyle=baseGradient;
                lCtx.beginPath();
                lCtx.arc(baseScreenX, baseScreenY-30, baseRadius, 0, Math.PI*2);
                lCtx.fill();
            }
        }

        // Reset composite operation
        lCtx.globalCompositeOperation='source-over';
    }

    // Draw small position lights on the lander
    drawPositionLights(ctx, x, y, angle, intensity) {
        const lightRadius=this.positionLightRadius*intensity;

        // Front light (pointing forward)
        const frontOffset=15;
        const frontX=x+Math.cos(angle-Math.PI/2)*frontOffset;
        const frontY=y+Math.sin(angle-Math.PI/2)*frontOffset;

        const frontGradient=ctx.createRadialGradient(frontX, frontY, 0, frontX, frontY, lightRadius);
        frontGradient.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
        frontGradient.addColorStop(0.5, `rgba(255, 255, 200, ${intensity*0.5})`);
        frontGradient.addColorStop(1, 'rgba(255, 255, 200, 0)');
        ctx.fillStyle=frontGradient;
        ctx.beginPath();
        ctx.arc(frontX, frontY, lightRadius, 0, Math.PI*2);
        ctx.fill();

        // Left position light (red tint)
        const sideOffset=12;
        const leftX=x+Math.cos(angle+Math.PI)*sideOffset*0.5+Math.cos(angle-Math.PI/2+Math.PI/2)*sideOffset;
        const leftY=y+Math.sin(angle+Math.PI)*sideOffset*0.5+Math.sin(angle-Math.PI/2+Math.PI/2)*sideOffset;

        const leftGradient=ctx.createRadialGradient(leftX, leftY, 0, leftX, leftY, lightRadius*0.5);
        leftGradient.addColorStop(0, `rgba(255, 100, 100, ${intensity*0.8})`);
        leftGradient.addColorStop(1, 'rgba(255, 100, 100, 0)');
        ctx.fillStyle=leftGradient;
        ctx.beginPath();
        ctx.arc(leftX, leftY, lightRadius*0.5, 0, Math.PI*2);
        ctx.fill();

        // Right position light (green tint)
        const rightX=x+Math.cos(angle+Math.PI)*sideOffset*0.5+Math.cos(angle-Math.PI/2-Math.PI/2)*sideOffset;
        const rightY=y+Math.sin(angle+Math.PI)*sideOffset*0.5+Math.sin(angle-Math.PI/2-Math.PI/2)*sideOffset;

        const rightGradient=ctx.createRadialGradient(rightX, rightY, 0, rightX, rightY, lightRadius*0.5);
        rightGradient.addColorStop(0, `rgba(100, 255, 100, ${intensity*0.8})`);
        rightGradient.addColorStop(1, 'rgba(100, 255, 100, 0)');
        ctx.fillStyle=rightGradient;
        ctx.beginPath();
        ctx.arc(rightX, rightY, lightRadius*0.5, 0, Math.PI*2);
        ctx.fill();
    }

    // Raycast helper
    castRay(startX, startY, angle, maxDist) {
        if (!this.voxelMap) return maxDist;

        const step=this.tileSize/2;
        let dist=0;

        while (dist<maxDist) {
            dist+=step;
            const wx=startX+Math.cos(angle)*dist;
            const wy=startY+Math.sin(angle)*dist;

            const gx=Math.floor(wx/this.tileSize);
            const gy=Math.floor(wy/this.tileSize);

            if (gy>=0&&gy<this.mapHeight&&gx>=0&&gx<this.mapWidth) {
                if (this.voxelMap[gy][gx]>0) {
                    // Hit a wall
                    return dist;
                }
            } else {
                // Out of bounds counts as "wall" for light blocking? 
                // Or maybe just let it go. Let's let it go until maxDist.
            }
        }
        return maxDist;
    }

    // Draw the main spotlight with raycasted occlusion
    // Warm, unsteady glow under a firing engine. Drawn into the same lighting
    // layer as the other emitters, so it carves darkness in caves and adds
    // additive glow in daylight exactly like position lights do.
    drawThrusterGlow(ctx, x, y, angle, time) {
        // The flame sits below the lander in its local frame.
        const offset=18;
        const fx=x+Math.sin(angle)*offset;
        const fy=y+Math.cos(angle)*offset;

        // Rapid flicker so it reads as combustion rather than a lamp.
        const flicker=0.75+Math.sin(time*47)*0.15+Math.sin(time*23)*0.10;
        const radius=70*flicker;

        const g=ctx.createRadialGradient(fx, fy, 0, fx, fy, radius);
        g.addColorStop(0, `rgba(255, 220, 150, ${0.95*flicker})`);
        g.addColorStop(0.45, `rgba(255, 150, 60, ${0.45*flicker})`);
        g.addColorStop(1, 'rgba(255, 120, 40, 0)');

        ctx.fillStyle=g;
        ctx.beginPath();
        ctx.arc(fx, fy, radius, 0, Math.PI*2);
        ctx.fill();
    }

    drawSpotlight(ctx, x, y, spotlightAngle, intensity, isLocalPlayer) {
        const range=this.spotlightRange*intensity;
        const coneAngle=this.spotlightAngle;
        const numRays=40; // Higher number = smoother shadows but more CPU

        // 1. Cast rays to find collision points
        const points=[];
        const startCone=spotlightAngle-coneAngle;
        const totalCone=coneAngle*2;

        for (let i=0; i<=numRays; i++) {
            const angle=startCone+(totalCone*i/numRays);
            const dist=this.castRay(this.cameraX+x, this.cameraY+y, angle, range);
            points.push({angle, dist});
        }

        // 2. Define the two visibility paths
        // "Clear" path: Visible area. We add tileSize/2 into the wall so the wall FACE is fully lit.
        // "Semi" path: The fade-out area behind the wall.
        const clearOffset=this.tileSize*0.8;
        const semiOffset=this.tileSize*1.8;

        // Draw Semi-transparent layer (Deeper penetration) - Low opacity erase
        // This clears darkness partially (e.g. 50%)
        ctx.save();
        ctx.globalCompositeOperation='destination-out';

        // Create gradients for falloff
        const gradient=ctx.createRadialGradient(0, 0, 0, 0, 0, range+semiOffset);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${0.5*intensity})`); // 50% max opacity erase
        gradient.addColorStop(0.8, `rgba(255, 255, 255, ${0.3*intensity})`);
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle=gradient;
        ctx.translate(x, y); // Local coords

        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (const p of points) {
            // Extend distance for semi-transparency layer
            // Clamp to max range though
            const d=Math.min(range+semiOffset, p.dist+semiOffset);
            ctx.lineTo(Math.cos(p.angle)*d, Math.sin(p.angle)*d);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Draw Clear layer (Surface) - Full opacity erase
        ctx.save();
        ctx.globalCompositeOperation='destination-out';

        const clearGradient=ctx.createRadialGradient(0, 0, 0, 0, 0, range);
        clearGradient.addColorStop(0, `rgba(255, 255, 255, ${1.0*intensity})`);
        clearGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle=clearGradient;
        ctx.translate(x, y);

        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (const p of points) {
            // Extend just enough to light the wall face
            const d=Math.min(range, p.dist+clearOffset);
            ctx.lineTo(Math.cos(p.angle)*d, Math.sin(p.angle)*d);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Optional: Add a "light beam" effect (additive) on top for atmosphere
        // This is purely visual, not erasing darkness
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        ctx.translate(x, y);

        // Simpler beam for atmospheric glow, respecting walls somewhat but softer
        const beamGradient=ctx.createRadialGradient(0, 0, 0, 0, 0, range*0.8);
        beamGradient.addColorStop(0, `rgba(255, 255, 200, ${0.1*intensity})`);
        beamGradient.addColorStop(1, 'rgba(255, 255, 200, 0)');

        ctx.fillStyle=beamGradient;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (const p of points) {
            const d=Math.min(range*0.8, p.dist+semiOffset); // Use semiOffset instead of undefined width
            ctx.lineTo(Math.cos(p.angle)*d, Math.sin(p.angle)*d);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    // Draw ore glow effects visible through darkness when within spotlight cone
    drawOreGlow(players, myId) {
        // Disabled: We want strictly limited visibility. No X-ray vision for ores.
        // Ores will only be visible if the spotlight mask (drawSpotlight) reveals them.
        return;


        const TileTypes={
            IRON_ORE: 10, TITANIUM_ORE: 11, COPPER_ORE: 12,
            GOLD_ORE: 13, PLATINUM_ORE: 14, HELIUM3_DEPOSIT: 15
        };

        const oreGlowColors={
            [TileTypes.IRON_ORE]: 'rgba(205, 133, 63, 0.4)',
            [TileTypes.COPPER_ORE]: 'rgba(218, 165, 32, 0.4)',
            [TileTypes.TITANIUM_ORE]: 'rgba(176, 196, 222, 0.4)',
            [TileTypes.GOLD_ORE]: 'rgba(255, 236, 139, 0.5)',
            [TileTypes.PLATINUM_ORE]: 'rgba(255, 255, 255, 0.5)',
            [TileTypes.HELIUM3_DEPOSIT]: 'rgba(127, 255, 212, 0.5)'
        };

        const ctx=this.ctx;
        const penetration=this.spotlightDepthPenetration;
        const time=performance.now();

        // For each player's spotlight, reveal ores within cone
        for (const player of players) {
            if (player.dead) continue;

            const spotAngle=player.spotlightAngle||0;
            const range=this.spotlightRange;
            const coneAngle=this.spotlightAngle;

            // Find ores within spotlight cone
            const revealedOres=new Set();

            const rayCount=20;
            for (let i=0; i<rayCount; i++) {
                const rayAngle=spotAngle-coneAngle+(coneAngle*2*i/(rayCount-1));

                let solidTilesHit=0;
                for (let dist=0; dist<range&&solidTilesHit<=penetration; dist+=this.tileSize) {
                    const worldX=player.x+Math.cos(rayAngle)*dist;
                    const worldY=player.y+Math.sin(rayAngle)*dist;

                    const gridX=Math.floor(worldX/this.tileSize);
                    const gridY=Math.floor(worldY/this.tileSize);

                    if (gridY>=0&&gridY<this.mapHeight&&gridX>=0&&gridX<this.mapWidth) {
                        const tile=this.voxelMap[gridY][gridX];
                        if (tile>0) {
                            solidTilesHit++;
                            // If this is an ore within penetration depth, mark it
                            if (tile>=TileTypes.IRON_ORE&&tile<=TileTypes.DIAMOND&&solidTilesHit<=penetration) {
                                revealedOres.add(`${gridX},${gridY},${tile}`);
                            }
                        }
                    }
                }
            }

            // Draw glow for revealed ores
            for (const oreKey of revealedOres) {
                const [gx, gy, tile]=oreKey.split(',').map(Number);
                const glowColor=oreGlowColors[tile];
                if (!glowColor) continue;

                const wx=gx*this.tileSize+this.tileSize/2-this.cameraX;
                const wy=gy*this.tileSize+this.tileSize/2-this.cameraY;

                // Pulsing glow effect
                const pulse=0.7+Math.sin(time/300+gx+gy)*0.3;

                const gradient=ctx.createRadialGradient(wx, wy, 0, wx, wy, this.tileSize*1.5);
                gradient.addColorStop(0, glowColor.replace('0.4', (0.4*pulse).toFixed(2)).replace('0.5', (0.5*pulse).toFixed(2)));
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

                ctx.fillStyle=gradient;
                ctx.beginPath();
                ctx.arc(wx, wy, this.tileSize*1.5, 0, Math.PI*2);
                ctx.fill();
            }
        }
    }

    // Draw tiles that are revealed by spotlights (can see through first few layers)
    drawRevealedTiles(players, cameraX, cameraY) {
        if (!this.voxelMap) return;

        const ctx=this.ctx;
        const penetration=this.spotlightDepthPenetration;

        for (const player of players) {
            if (player.dead) continue;

            const spotAngle=player.spotlightAngle||0;
            const range=this.spotlightRange;
            const coneAngle=this.spotlightAngle;

            // Cast rays within the spotlight cone
            const rayCount=30;
            for (let i=0; i<rayCount; i++) {
                const rayAngle=spotAngle-coneAngle+(coneAngle*2*i/(rayCount-1));

                // March along the ray
                let tilesHit=0;
                for (let dist=0; dist<range&&tilesHit<penetration; dist+=this.tileSize/2) {
                    const worldX=player.x+Math.cos(rayAngle)*dist;
                    const worldY=player.y+Math.sin(rayAngle)*dist;

                    const gridX=Math.floor(worldX/this.tileSize);
                    const gridY=Math.floor(worldY/this.tileSize);

                    if (gridY>=0&&gridY<this.mapHeight&&gridX>=0&&gridX<this.mapWidth) {
                        const tile=this.voxelMap[gridY][gridX];
                        if (tile>0) {
                            tilesHit++;
                            // This tile is within the penetration depth - mark it as revealed
                            // The ore glow will show through the darkness
                        }
                    }
                }
            }
        }
    }

    // Draw Parallax backgrounds based on depth and biome
    drawBackgrounds(myPlayer) {
        if (!myPlayer) return;

        // Calculate depth relative to surface level
        // surfaceY is set from basePosition (approx 800-1600px usually)
        // If surfaceY is not set yet, fallback to 0 (top of map)
        const surfaceLevel=this.surfaceY||0;
        const totalMapHeight=this.mapHeight*this.tileSize;

        // Calculate "underground depth" (0 at surface, 1 at bottom of map)
        // We use a safe denominator (avoid divide by zero)
        const undergroundRange=Math.max(1, totalMapHeight-surfaceLevel);
        const relativeDepth=(myPlayer.y-surfaceLevel)/undergroundRange;

        // Clamp for safety, though allowing negative (sky) is fine (maps to surface)
        // We treat everything above surface + small buffer as "Surface Biome"
        const normalizedDepth=Math.max(-0.1, relativeDepth);

        let currentBiome='surface';
        let mixBiome='surface';
        let mixAlpha=0;

        // Biome triggers based on RELATIVE depth from surface
        // 0.0 = Surface Level
        // 1.0 = Bottom of Map

        if (normalizedDepth<0.15) {
            currentBiome='surface';
            mixBiome='shallow_caves';
            // Start mixing in shallow caves as we go down from 0.10 to 0.15
            mixAlpha=Math.max(0, (normalizedDepth-0.10)/0.05);
        } else if (normalizedDepth<0.30) {
            currentBiome='shallow_caves';
            mixBiome='deep_tunnels';
            mixAlpha=Math.max(0, (normalizedDepth-0.25)/0.05);
        } else if (normalizedDepth<0.50) {
            currentBiome='deep_tunnels';
            mixBiome='crystal_caverns';
            mixAlpha=Math.max(0, (normalizedDepth-0.45)/0.05);
        } else if (normalizedDepth<0.70) {
            currentBiome='crystal_caverns';
            mixBiome='abyssal_depths';
            mixAlpha=Math.max(0, (normalizedDepth-0.65)/0.05);
        } else if (normalizedDepth<0.85) {
            currentBiome='abyssal_depths';
            mixBiome='the_core';
            mixAlpha=Math.max(0, (normalizedDepth-0.80)/0.05);
        } else {
            currentBiome='the_core';
            mixBiome='the_core';
            mixAlpha=0;
        }

        // Draw primary biome
        this.renderParallaxLayer(currentBiome);

        // Draw mixing biome (transition)
        if (mixAlpha>0) {
            this.ctx.globalAlpha=mixAlpha;
            this.renderParallaxLayer(mixBiome);
            this.ctx.globalAlpha=1.0;
        }
    }

    renderParallaxLayer(biomeId) {
        const bg=this.biomeBackgrounds[biomeId];
        if (!bg||bg.width===0) return;

        // Parallax factors
        const factorX=0.2;
        const factorY=0.1;

        // Scale it to cover vertically and tile horizontally
        const scale=(this.canvas.height*1.5)/bg.height; // Oversize slightly for safety
        const width=bg.width*scale;
        const height=bg.height*scale;

        // Calculate offset based on camera
        let offsetX=-(this.cameraX*factorX)%width;
        let offsetY=-(this.cameraY*factorY)%height;

        // Fill screen with repeats
        for (let x=offsetX-width; x<this.canvas.width+width; x+=width) {
            for (let y=offsetY-height; y<this.canvas.height+height; y+=height) {
                this.ctx.drawImage(bg, x, y, width, height);
            }
        }
    }

    // Draw debug collision boxes for buildings, pad, and players
    drawDebugColliders(state) {
        this.ctx.lineWidth=2;

        // 1. Draw Landing Pad Bounds
        if (state.basePadBounds) {
            this.ctx.strokeStyle='#0f0'; // Pad is green
            this.ctx.strokeRect(
                state.basePadBounds.x1,
                state.basePadBounds.y1,
                state.basePadBounds.x2-state.basePadBounds.x1,
                state.basePadBounds.y2-state.basePadBounds.y1
            );
            this.ctx.fillStyle='rgba(0, 255, 0, 0.2)';
            this.ctx.fillRect(
                state.basePadBounds.x1,
                state.basePadBounds.y1,
                state.basePadBounds.x2-state.basePadBounds.x1,
                state.basePadBounds.y2-state.basePadBounds.y1
            );
        }

        // 2. Draw Moon Base Bounds
        if (this.basePosition&&this.moonBaseSpriteLoaded) {
            const baseScale=0.18;
            const w=this.moonBaseSprite.width*baseScale;
            const h=this.moonBaseSprite.height*baseScale;
            const x=this.basePosition.x-w/2;
            const y=this.basePosition.y-h+60;

            this.ctx.strokeStyle='#0af'; // Base is blue
            this.ctx.strokeRect(x, y, w, h);
            this.ctx.fillStyle='rgba(0, 170, 255, 0.2)';
            this.ctx.fillRect(x, y, w, h);
        }

        // 3. Draw Building Bounds
        if (state.activeBuildings&&this.buildingsLoadedCount>0) {
            const baseScale=0.18;
            const buildingScale=baseScale*0.5;

            state.activeBuildings.forEach(b => {
                const sprite=this.buildingSprites[b.type||b.id]; // id is now instance-scoped (e.g. 'fuel_depot#2')
                if (sprite) {
                    const w=sprite.width*buildingScale;
                    const h=sprite.height*buildingScale;
                    const x=b.x-w/2;
                    const y=b.y-h+30;

                    this.ctx.strokeStyle='#f0f'; // Buildings are purple
                    this.ctx.strokeRect(x, y, w, h);
                    this.ctx.fillStyle='rgba(255, 0, 255, 0.2)';
                    this.ctx.fillRect(x, y, w, h);
                }
            });
        }

        // 4. Draw Player/Ship Colliders
        state.players.forEach(p => {
            if (p.dead&&!p.inPod) return;

            // Simple approximation of collision box based on ship type
            let w=20, h=28; // Scout
            if (p.shipType==='cargo') {w=30; h=30;}
            else if (p.shipType==='eva') {w=6; h=12;}

            this.ctx.save();
            this.ctx.translate(p.x, p.y);
            this.ctx.rotate(p.angle);

            this.ctx.strokeStyle='#f00'; // Entities are red
            this.ctx.strokeRect(-w/2, -h/2, w, h);
            this.ctx.fillStyle='rgba(255, 0, 0, 0.1)';
            this.ctx.fillRect(-w/2, -h/2, w, h);

            this.ctx.restore();
        });
    }

    draw(state, myId) {
        const now=performance.now();
        const dt=(now-this.lastTime)/1000;
        this.lastTime=now;

        // Find my player for camera
        const myPlayer=state.players.find(p => p.id===myId);

        // Update camera to follow player
        if (myPlayer) {
            const targetX=myPlayer.x-this.canvas.width/2;
            const targetY=myPlayer.y-this.canvas.height/2;
            this.cameraX+=(targetX-this.cameraX)*this.cameraSmoothing;
            this.cameraY+=(targetY-this.cameraY)*this.cameraSmoothing;
        }

        // Spawn thrust particles for all players
        for (const player of state.players) {
            this.spawnThrustParticles(player);
        }

        // Check for damage increases and spawn collision particles
        for (const player of state.players) {
            const prevDamage=this.previousDamage.get(player.id)||0;
            const currentDamage=player.damage||0;
            const wasDead=this.previousDamage.get(player.id+'_dead')||false;

            if (currentDamage>prevDamage) {
                // Damage increased! Collision happened.
                const damageDiff=currentDamage-prevDamage;
                this.spawnDamageParticles(player, damageDiff);

                // Play sound if this is the local player or close enough (playing for all now)
                if (this.soundManager) {
                    this.soundManager.playCollision();
                }
            }

            // Check for death transition - spawn big explosion
            if (player.dead&&!wasDead) {
                this.spawnDeathExplosion(player);
            }

            this.previousDamage.set(player.id, currentDamage);
            this.previousDamage.set(player.id+'_dead', player.dead);
        }


        // Update particles
        this.updateParticles(dt);

        // Update floating texts
        this.updateFloatingTexts(dt);

        // Clear background with moon sky color
        this.ctx.fillStyle='#0a0a14';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw Parallax Backgrounds
        this.drawBackgrounds(myPlayer);

        this.ctx.save();

        // Apply camera transform
        this.ctx.translate(-this.cameraX, -this.cameraY);

        // Draw voxel terrain
        this.drawVoxelTerrain();

        // Draw moon base structure
        this.drawMoonBase(state);

        // Draw particles (behind ships)
        for (const particle of this.particles) {
            particle.draw(this.ctx);
        }

        // Draw tethers
        const drawnTethers=new Set();
        for (const player of state.players) {
            if (player.tetheredTo&&!drawnTethers.has(player.id)) {
                const other=state.players.find(p => p.id===player.tetheredTo);
                if (other) {
                    this.drawTether(player, other);
                    drawnTethers.add(player.id);
                    drawnTethers.add(player.tetheredTo);
                }
            }
        }

        // Draw docking indicators
        for (const player of state.players) {
            if (player.dockingTarget&&!player.dead) {
                this.drawDockingIndicator(player, state.players);
            }
        }

        // Draw survival pods (before players so they appear behind)
        for (const player of state.players) {
            if (player.inPod) {
                this.drawSurvivalPod(player, player.id===myId);
            }
        }

        // Draw parked vehicles
        if (state.vehicles) {
            this.drawVehicles(state.vehicles);
        }

        // Draw players
        for (const player of state.players) {
            this.drawPlayer(player, player.id===myId);
        }

        // Draw mining lasers
        for (const player of state.players) {
            if (player.mining&&player.miningTarget) {
                this.drawMiningLaser(player);
            }
        }

        // Draw pings
        for (const player of state.players) {
            if (player.activePing) {
                this.drawPing(player.activePing, player.id===myId);
            }
        }

        this.ctx.restore();

        // Draw lighting overlay (after restoring camera transform)
        // Only buildings that actually have power emit light, so a browned-out
        // or uncabled base is visibly dark.
        this._lightNodes=Object.values(state.networks?.nodes||{})
            .filter(n => n.power==='ok'||n.power==='brownout');
        this.drawLighting(state.players, myId, this.cameraX, this.cameraY);
        this.ctx.drawImage(this.lightCanvas, 0, 0);

        // Draw ore glow effects on top of darkness (ores glow faintly in the dark)
        this.drawOreGlow(state.players, myId);

        // Draw wreckages
        if (state.wreckages&&state.wreckages.length>0) {
            this.drawWreckages(state.wreckages);
        }

        // Draw dropped items (jettisoned ore)
        if (state.droppedItems&&state.droppedItems.length>0) {
            this.drawDroppedItems(state.droppedItems);
        }



        // Draw targeted player interaction UI
        this.drawInteractionUI(state.players, myId);

        // Draw floating texts (ore pickups, etc.)
        this.drawFloatingTexts();

        // Draw debug colliders if enabled
        if (this.debugVisualizeColliders) {
            this.ctx.save();
            this.ctx.translate(-this.cameraX, -this.cameraY);
            this.drawDebugColliders(state);
            this.ctx.restore();
        }

        // Draw HUD (not affected by camera or lighting)
        this.drawHUD(myPlayer, state);

        // Draw minimap
        this.drawMinimap(myPlayer, state);

        // Draw chat messages
        this.drawChat();

        // Draw contextual controls help (bottom left)
        this.drawControlsHelp(myPlayer);

        // Draw death screen if player is dead
        this.drawDeathScreen(myPlayer, state);

        // Draw any temporary messages
        this.drawMessage();
    }

    drawVoxelTerrain() {
        if (!this.voxelMap) return;

        const startX=Math.max(0, Math.floor(this.cameraX/this.tileSize)-1);
        const startY=Math.max(0, Math.floor(this.cameraY/this.tileSize)-1);
        const endX=Math.min(this.mapWidth, Math.ceil((this.cameraX+this.canvas.width)/this.tileSize)+1);
        const endY=Math.min(this.mapHeight, Math.ceil((this.cameraY+this.canvas.height)/this.tileSize)+1);

        const TileTypes={
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
            BITITE: 12,          // Fuel-producing material
            SILVER_ORE: 13,      // 200-400m
            TITANIUM_ORE: 14,    // 300-600m
            GOLD_ORE: 15,        // 400-800m
            PLATINUM_ORE: 16,    // 800-1400m
            DIAMOND: 17,         // 3500-5000m, extremely rare
            HELIUM3: 18
        };

        const getRockColors=(y) => {
            const normalizedDepth=y/this.mapHeight;
            if (normalizedDepth<0.102) {
                return {main: '#d1c4b9', border: '#a89a8e'}; // Regolith/Surface
            } else if (normalizedDepth<0.277) {
                return {main: '#7d6b5d', border: '#4d3d32'}; // Shallow (Warm Brown)
            } else if (normalizedDepth<0.451) {
                return {main: '#5d5d5d', border: '#3a3a3a'}; // Deep (Gray)
            } else if (normalizedDepth<0.626) {
                return {main: '#4d4d7d', border: '#333355'}; // Crystal (Blueish/Dark Purple)
            } else if (normalizedDepth<0.8) {
                return {main: '#2d3d2d', border: '#1a241a'}; // Abyssal (Dark Green/Black)
            } else {
                return {main: '#5d2d2d', border: '#3a1a1a'}; // Core (Reddish)
            }
        };

        const tileColors={
            [TileTypes.GROUND]: {main: '#8b7a6b', border: '#5d4e42'},
            [TileTypes.REGOLITH]: {main: '#d1c4b9', border: '#a89a8e'},
            [TileTypes.ROCK]: null, // Handled dynamically
            [TileTypes.HARD_ROCK]: null, // Handled dynamically
            [TileTypes.PAD]: {main: '#6a8bba', border: '#4a6b8a'},
            [TileTypes.BASE]: {main: '#c0c0c0', border: '#666666'},
            // Ore colors - distinct and visible, ordered by depth
            [TileTypes.IRON_ORE]: {main: '#8b4513', border: '#5c2e0e', glow: '#cd853f'},      // Rusty brown
            [TileTypes.COPPER_ORE]: {main: '#b87333', border: '#8b4513', glow: '#daa520'},    // Copper orange
            [TileTypes.BITITE]: {main: '#2f2f2f', border: '#1a1a1a', glow: '#4a4a4a'},        // Dark coal-like
            [TileTypes.SILVER_ORE]: {main: '#c0c0c0', border: '#808080', glow: '#e8e8e8'},    // Silver
            [TileTypes.TITANIUM_ORE]: {main: '#708090', border: '#4a5568', glow: '#b0c4de'},  // Silvery blue
            [TileTypes.GOLD_ORE]: {main: '#ffd700', border: '#b8860b', glow: '#ffec8b'},      // Gold
            [TileTypes.PLATINUM_ORE]: {main: '#e5e4e2', border: '#a9a9a9', glow: '#ffffff'},  // Platinum white
            [TileTypes.DIAMOND]: {main: '#b9f2ff', border: '#87ceeb', glow: '#e0ffff'},       // Crystal blue
            [TileTypes.HELIUM3]: {main: '#7fffd4', border: '#458b74', glow: '#c0ffc0'}        // Minty green
        };

        for (let y=startY; y<endY; y++) {
            for (let x=startX; x<endX; x++) {
                const tile=this.voxelMap[y][x];
                if (tile===TileTypes.EMPTY) continue;

                // Skip BASE tiles - they'll be covered by sprite
                if (tile===TileTypes.BASE) continue;

                let colors=tileColors[tile]||tileColors[TileTypes.GROUND];
                if (tile===TileTypes.ROCK||tile===TileTypes.HARD_ROCK||tile===TileTypes.GROUND) {
                    colors=getRockColors(y);
                }
                const wx=x*this.tileSize;
                const wy=y*this.tileSize;

                // OCCLUSION LOGIC: Determine exposure level
                let exposureLevel=3; // Default to Deep (Concealed)

                // Check direct neighbors (Up, Down, Left, Right) for AIR (0)
                // Boundary checks included
                const u=(y>0&&this.voxelMap[y-1][x]===0);
                const d=(y<this.mapHeight-1&&this.voxelMap[y+1][x]===0);
                const l=(x>0&&this.voxelMap[y][x-1]===0);
                const r=(x<this.mapWidth-1&&this.voxelMap[y][x+1]===0);

                if (u||d||l||r) {
                    exposureLevel=1; // Surface
                } else {
                    // Check secondary neighbors (radius 2)
                    // We check if any neighbor (u,d,l,r) touches air.
                    // This effectively checks the "cross" shape at distance 2.
                    // Also check diagonals to be generous (square radius 2)?
                    // Let's stick to the "Next tile behind outer voxel" rule.

                    // Simple check: iterate -2 to +2. If any 0 found, it's Near.
                    let foundAir=false;
                    for (let oy=-2; oy<=2; oy++) {
                        for (let ox=-2; ox<=2; ox++) {
                            const ny=y+oy;
                            const nx=x+ox;
                            if (Math.abs(ox)<=1&&Math.abs(oy)<=1) continue; // Skip center and dist 1 (already checked)

                            if (ny>=0&&ny<this.mapHeight&&nx>=0&&nx<this.mapWidth) {
                                if (this.voxelMap[ny][nx]===0) {
                                    foundAir=true;
                                    break;
                                }
                            }
                        }
                        if (foundAir) break;
                    }
                    if (foundAir) exposureLevel=2; // Near Surface
                }

                // Render based on Exposure Level
                if (exposureLevel===3) {
                    // Deep: Completely concealed (Black Rock)
                    this.ctx.fillStyle='#050505'; // Almost black
                    this.ctx.fillRect(wx, wy, this.tileSize, this.tileSize);
                    // No borders, no details
                } else {
                    // Surface or Near Surface: Draw normally (with opacity for Near)

                    if (exposureLevel===2) {
                        this.ctx.save();
                        this.ctx.globalAlpha=0.4; // 40% visibility for "inner" layer
                        // Draw black background first so opacity doesn't show background clear color
                        this.ctx.fillStyle='#000';
                        this.ctx.fillRect(wx, wy, this.tileSize, this.tileSize);
                    }

                    this.ctx.fillStyle=colors.main;
                    this.ctx.fillRect(wx, wy, this.tileSize, this.tileSize);

                    // Skip PAD tiles too - landing platform sprite will cover them
                    if (tile===TileTypes.PAD) {
                        if (exposureLevel===2) this.ctx.restore();
                        continue;
                    }

                    // Add glow effect for ore tiles (only if visible)
                    if (tile>=TileTypes.IRON_ORE&&tile<=TileTypes.HELIUM3&&colors.glow) {
                        this.ctx.fillStyle=colors.glow;
                        this.ctx.globalAlpha=(exposureLevel===2? 0.2:1)*(0.3+Math.sin(performance.now()/500+x+y)*0.15);
                        this.ctx.fillRect(wx+2, wy+2, this.tileSize-4, this.tileSize-4);
                        if (exposureLevel!==2) this.ctx.globalAlpha=1;
                    }

                    this.ctx.strokeStyle=colors.border;
                    this.ctx.lineWidth=0.5;
                    this.ctx.strokeRect(wx, wy, this.tileSize, this.tileSize);

                    if (exposureLevel===2) {
                        this.ctx.restore();
                    }
                }
            }
        }
    }

    drawMoonBase(state) {
        // Draw landing platform sprite
        if (this.landingPadPosition&&this.landingPlatformSpriteLoaded) {
            const padX=this.landingPadPosition.x;
            const padY=this.landingPadPosition.y;

            // Scale the sprite to fit nicely (adjust as needed)
            const padScale=0.18;
            const padWidth=this.landingPlatformSprite.width*padScale;
            const padHeight=this.landingPlatformSprite.height*padScale;

            this.ctx.drawImage(
                this.landingPlatformSprite,
                padX-padWidth/2,
                padY-padHeight+80, // Position so bottom aligns with ground (+60 offset to fix hovering)
                padWidth,
                padHeight
            );
        }

        // Draw moon base sprite
        if (this.basePosition&&this.moonBaseSpriteLoaded) {
            const baseX=this.basePosition.x;
            const baseY=this.basePosition.y;

            // Scale the sprite to fit nicely
            const baseScale=0.18;
            const baseWidth=this.moonBaseSprite.width*baseScale;
            const baseHeight=this.moonBaseSprite.height*baseScale;

            this.ctx.drawImage(
                this.moonBaseSprite,
                baseX-baseWidth/2,
                baseY-baseHeight+60, // Position so bottom aligns with ground (+60 offset to fix hovering)
                baseWidth,
                baseHeight
            );
        }

        // Fallback if sprites not loaded - draw simple shapes
        if (!this.moonBaseSpriteLoaded&&this.basePosition) {
            const x=this.basePosition.x;
            const y=this.basePosition.y;
            this.ctx.fillStyle='#3a4a5a';
            this.ctx.fillRect(x-40, y-40, 80, 40);
            this.ctx.fillStyle='#fff';
            this.ctx.font='bold 10px monospace';
            this.ctx.textAlign='center';
            this.ctx.fillText('MOON BASE', x, y-45);
        }

        if (!this.landingPlatformSpriteLoaded&&this.landingPadPosition) {
            const x=this.landingPadPosition.x;
            const y=this.landingPadPosition.y;
            this.ctx.fillStyle='#4a6b8a';
            this.ctx.fillRect(x-50, y-5, 100, 10);
            this.ctx.fillStyle='#ffff00';
            this.ctx.fillRect(x-50, y-5, 100, 2);
        }

        // NEW: Draw active buildings from Game State
        if (state&&state.activeBuildings&&this.buildingsLoadedCount>0) {
            const baseScale=0.18;
            const buildingScale=baseScale*0.5; // 50% scale

            state.activeBuildings.forEach(b => {
                const sprite=this.buildingSprites[b.type||b.id]; // id is now instance-scoped (e.g. 'fuel_depot#2')
                if (sprite) {
                    const w=sprite.width*buildingScale;
                    const h=sprite.height*buildingScale;
                    this.ctx.drawImage(
                        sprite,
                        b.x-w/2,
                        b.y-h+30, // Offset to align with ground
                        w, h
                    );
                }
            });
        }
    }

    drawSurvivalPod(player, isMe) {
        const {podX, podY, podLifeSupport, beaconPulse, color}=player;

        this.ctx.save();

        // Draw distress beacon (pulsing ring)
        const beaconSize=30+Math.sin(beaconPulse)*15;
        const beaconAlpha=0.3+Math.sin(beaconPulse)*0.2;

        this.ctx.strokeStyle=`rgba(255, 0, 0, ${beaconAlpha})`;
        this.ctx.lineWidth=2;
        this.ctx.beginPath();
        this.ctx.arc(podX, podY, beaconSize, 0, Math.PI*2);
        this.ctx.stroke();

        // Second pulsing ring
        const beacon2Size=50+Math.sin(beaconPulse+Math.PI)*20;
        const beacon2Alpha=0.2+Math.sin(beaconPulse+Math.PI)*0.1;
        this.ctx.strokeStyle=`rgba(255, 50, 50, ${beacon2Alpha})`;
        this.ctx.beginPath();
        this.ctx.arc(podX, podY, beacon2Size, 0, Math.PI*2);
        this.ctx.stroke();

        // Draw pod body (small capsule)
        this.ctx.fillStyle=color;
        this.ctx.strokeStyle='#fff';
        this.ctx.lineWidth=1;

        // Capsule shape
        this.ctx.beginPath();
        this.ctx.ellipse(podX, podY, 6, 10, 0, 0, Math.PI*2);
        this.ctx.fill();
        this.ctx.stroke();

        // Window
        this.ctx.fillStyle='#88f';
        this.ctx.beginPath();
        this.ctx.arc(podX, podY-3, 3, 0, Math.PI*2);
        this.ctx.fill();

        // Life support indicator
        const lifePercent=podLifeSupport/60;
        const barWidth=20;
        const barHeight=3;
        const barX=podX-barWidth/2;
        const barY=podY+15;

        this.ctx.fillStyle='#333';
        this.ctx.fillRect(barX, barY, barWidth, barHeight);

        // Color based on remaining time
        let barColor='#0f0';
        if (lifePercent<0.5) barColor='#ff0';
        if (lifePercent<0.25) barColor='#f00';

        this.ctx.fillStyle=barColor;
        this.ctx.fillRect(barX, barY, barWidth*lifePercent, barHeight);

        // Time remaining text
        this.ctx.fillStyle='#fff';
        this.ctx.font='10px monospace';
        this.ctx.textAlign='center';
        this.ctx.fillText(`${Math.ceil(podLifeSupport)}s`, podX, barY+12);

        // SOS text
        if (Math.sin(beaconPulse*2)>0) {
            this.ctx.fillStyle='#f00';
            this.ctx.font='bold 12px monospace';
            this.ctx.fillText('SOS', podX, podY-20);
        }

        this.ctx.restore();
    }

    drawTether(p1, p2) {
        const dx=p2.x-p1.x;
        const dy=p2.y-p1.y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        const tension=p1.tetherTension||0;

        // Color based on tension: green (slack) -> yellow -> red (about to snap)
        let color;
        if (tension<0.3) {
            color='#44ff44';
        } else if (tension<0.7) {
            color='#ffff44';
        } else {
            color='#ff4444';
        }

        this.ctx.save();

        // Draw rope with slight sag when slack
        const segments=10;
        const sag=Math.max(0, 20-tension*25); // More sag when slack

        this.ctx.strokeStyle=color;
        this.ctx.lineWidth=2;
        this.ctx.shadowColor=color;
        this.ctx.shadowBlur=tension>0.5? 5:0;

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);

        for (let i=1; i<=segments; i++) {
            const t=i/segments;
            const x=p1.x+dx*t;
            // Parabolic sag, maximum at middle
            const sagAmount=sag*Math.sin(t*Math.PI);
            const y=p1.y+dy*t+sagAmount;

            if (i===1) {
                this.ctx.lineTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }

        this.ctx.stroke();

        // Draw tension indicator at midpoint
        if (tension>0) {
            const midX=(p1.x+p2.x)/2;
            const midY=(p1.y+p2.y)/2+sag*0.5;

            this.ctx.fillStyle=color;
            this.ctx.font='10px monospace';
            this.ctx.textAlign='center';
            this.ctx.fillText(`${Math.floor(tension*100)}%`, midX, midY-10);
        }

        this.ctx.restore();
    }

    drawDockingIndicator(player, allPlayers) {
        const target=allPlayers.find(p => p.id===player.dockingTarget);
        if (!target||target.dead) return;

        const {x, y, isDocked, fuelTransferring}=player;

        // Draw connection line
        this.ctx.save();

        if (isDocked) {
            // Docked - solid green connection
            this.ctx.strokeStyle=fuelTransferring? '#00ffff':'#00ff00';
            this.ctx.lineWidth=fuelTransferring? 3:2;
            this.ctx.setLineDash([]);
        } else {
            // In range but not docked - dashed yellow line
            this.ctx.strokeStyle='#ffff00';
            this.ctx.lineWidth=1;
            this.ctx.setLineDash([5, 5]);
        }

        // Draw line between ships
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(target.x, target.y);
        this.ctx.stroke();

        // If fuel transferring, draw fuel particles
        if (fuelTransferring) {
            const midX=(x+target.x)/2;
            const midY=(y+target.y)/2;

            // Animated flow effect
            const t=(performance.now()/500)%1;
            const flowX=x+(target.x-x)*t;
            const flowY=y+(target.y-y)*t;

            // Draw flow particle
            this.ctx.fillStyle='#00ffff';
            this.ctx.shadowColor='#00ffff';
            this.ctx.shadowBlur=10;
            this.ctx.beginPath();
            this.ctx.arc(flowX, flowY, 4, 0, Math.PI*2);
            this.ctx.fill();

            // Second particle offset
            const t2=(t+0.5)%1;
            const flowX2=x+(target.x-x)*t2;
            const flowY2=y+(target.y-y)*t2;
            this.ctx.beginPath();
            this.ctx.arc(flowX2, flowY2, 4, 0, Math.PI*2);
            this.ctx.fill();
        }

        this.ctx.restore();
    }

    drawPing(ping, isMyPing) {
        const {type, x, y, timestamp}=ping;
        const age=(Date.now()-timestamp)/1000; // Age in seconds
        const maxAge=5; // 5 seconds
        const alpha=Math.max(0, 1-age/maxAge);

        if (alpha<=0) return;

        // Pulsing animation
        const pulse=0.7+Math.sin(performance.now()/200)*0.3;
        const size=15+pulse*5;

        this.ctx.save();
        this.ctx.globalAlpha=alpha;

        const pingColors={
            yellow: {fill: '#ffff00', stroke: '#ffaa00', glow: 'rgba(255, 255, 0, 0.5)'},
            red: {fill: '#ff4444', stroke: '#ff0000', glow: 'rgba(255, 0, 0, 0.5)'},
            green: {fill: '#44ff44', stroke: '#00ff00', glow: 'rgba(0, 255, 0, 0.5)'},
            blue: {fill: '#4444ff', stroke: '#0088ff', glow: 'rgba(0, 150, 255, 0.5)'}
        };

        const colors=pingColors[type]||pingColors.yellow;

        // Draw glow
        this.ctx.shadowColor=colors.glow;
        this.ctx.shadowBlur=20*pulse;

        this.ctx.fillStyle=colors.fill;
        this.ctx.strokeStyle=colors.stroke;
        this.ctx.lineWidth=2;

        // Draw shape based on type
        this.ctx.beginPath();
        switch (type) {
            case 'yellow': // Circle - "Check this out"
                this.ctx.arc(x, y, size, 0, Math.PI*2);
                break;
            case 'red': // Triangle - "Danger/Help!"
                this.ctx.moveTo(x, y-size);
                this.ctx.lineTo(x+size, y+size*0.8);
                this.ctx.lineTo(x-size, y+size*0.8);
                this.ctx.closePath();
                break;
            case 'green': // Diamond - "Resources here"
                this.ctx.moveTo(x, y-size);
                this.ctx.lineTo(x+size, y);
                this.ctx.lineTo(x, y+size);
                this.ctx.lineTo(x-size, y);
                this.ctx.closePath();
                break;
            case 'blue': // Arrow/chevron - "Regroup here"
                this.ctx.moveTo(x, y-size);
                this.ctx.lineTo(x+size, y);
                this.ctx.lineTo(x, y+size*0.5);
                this.ctx.lineTo(x-size, y);
                this.ctx.closePath();
                break;
        }
        this.ctx.fill();
        this.ctx.stroke();

        // Expanding ring effect
        const ringSize=size+age*40;
        const ringAlpha=Math.max(0, 0.5-age*0.15);
        this.ctx.strokeStyle=colors.fill;
        this.ctx.globalAlpha=alpha*ringAlpha;
        this.ctx.lineWidth=2;
        this.ctx.beginPath();
        this.ctx.arc(x, y, ringSize, 0, Math.PI*2);
        this.ctx.stroke();

        this.ctx.restore();
    }

    drawMiningLaser(player) {
        const {x, y, miningTarget, miningProgress}=player;
        if (!miningTarget) return;

        const targetX=miningTarget.worldX;
        const targetY=miningTarget.worldY;

        // Pulsing effect based on progress
        const pulse=0.5+Math.sin(performance.now()/100)*0.3+miningProgress*0.2;

        // Draw main laser beam
        this.ctx.save();
        this.ctx.strokeStyle=`rgba(0, 200, 255, ${pulse*0.8})`;
        this.ctx.lineWidth=3;
        this.ctx.shadowColor='#00ffff';
        this.ctx.shadowBlur=10;

        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(targetX, targetY);
        this.ctx.stroke();

        // Inner brighter beam
        this.ctx.strokeStyle=`rgba(150, 255, 255, ${pulse})`;
        this.ctx.lineWidth=1;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(targetX, targetY);
        this.ctx.stroke();

        // Impact point glow
        const glowSize=8+miningProgress*5;
        const gradient=this.ctx.createRadialGradient(targetX, targetY, 0, targetX, targetY, glowSize);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${pulse})`);
        gradient.addColorStop(0.3, `rgba(0, 200, 255, ${pulse*0.7})`);
        gradient.addColorStop(1, 'rgba(0, 200, 255, 0)');

        this.ctx.fillStyle=gradient;
        this.ctx.beginPath();
        this.ctx.arc(targetX, targetY, glowSize, 0, Math.PI*2);
        this.ctx.fill();

        // Spawn mining particles
        if (Math.random()<0.3) {
            const speed=30+Math.random()*50;
            const dir=Math.random()*Math.PI*2;
            this.particles.push(new Particle(
                targetX+(Math.random()-0.5)*10,
                targetY+(Math.random()-0.5)*10,
                Math.cos(dir)*speed,
                Math.sin(dir)*speed-20,
                'spark'
            ));
        }

        this.ctx.restore();
    }

    drawPlayer(player, isMe) {
        const {x, y, angle, color, thrusting, dead, damage=0, shipType}=player;

        if (dead) return;

        if (shipType==='eva') {
            this.drawEVAPlayer(player, isMe);
            return;
        }

        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);

        if (this.spriteLoaded) {
            // Select sprite based on ship type
            let sprite=this.landerSprite;
            let width=40;
            let height=40*(this.spriteFrameHeight/this.spriteFrameWidth);

            if (player.shipType==='cargo'&&this.cargoShipSpriteLoaded) {
                sprite=this.cargoShipSprite;
                width=50; // Cargo ship is bigger
                height=50*(this.spriteFrameHeight/this.spriteFrameWidth);
            }

            // Draw sprite from sprite sheet
            // 4x3 grid, damage level 0-11
            const damageLevel=Math.min(11, Math.max(0, Math.floor(damage)));
            const frameX=damageLevel%4;
            const frameY=Math.floor(damageLevel/4);

            const srcX=frameX*this.spriteFrameWidth;
            const srcY=frameY*this.spriteFrameHeight;

            // Sit the sprite's feet on the collider's base.
            //
            // The sprite is drawn much larger than the physics box (a Scout
            // collides as 20x28 but renders at 40x40) and both were centred on
            // the body origin, so the bottom of the art -- the landing legs --
            // hung ~6 units below anything the physics engine knew about. The
            // ship rested correctly while its legs visibly sank into the ground.
            const colliderH=player.colliderH||height;
            const footOffset=Math.max(0, (height-colliderH)/2);

            this.ctx.drawImage(
                sprite,
                srcX, srcY,
                this.spriteFrameWidth, this.spriteFrameHeight,
                -width/2, -height/2-footOffset,
                width, height
            );

        } else {
            // Fallback: draw procedural ship
            this.ctx.fillStyle=color;
            this.ctx.strokeStyle=isMe? '#fff':'#aaa';
            this.ctx.lineWidth=2;

            this.ctx.beginPath();
            this.ctx.moveTo(15, 0);
            this.ctx.lineTo(-10, -10);
            this.ctx.lineTo(-5, 0);
            this.ctx.lineTo(-10, 10);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    drawEVAPlayer(player, isMe) {
        const {x, y, vx, vy, color, thrusting, angle}=player;
        const time=performance.now();

        this.ctx.save();
        this.ctx.translate(x, y);
        // Stick figure stays upright, but leans slightly with velocity
        const lean=vx*0.02;
        this.ctx.rotate(lean);

        this.ctx.strokeStyle=color;
        this.ctx.lineWidth=2;
        this.ctx.lineCap='round';

        // Procedural animation
        const speed=Math.sqrt(vx*vx+vy*vy);
        const isWalking=speed>5&&!thrusting;
        const walkPhase=(time*0.01*speed*0.1)%(Math.PI*2);

        // Limbs positions
        const torsoTop={x: 0, y: -6};
        const torsoBottom={x: 0, y: 2};

        // Head
        this.ctx.beginPath();
        this.ctx.arc(0, -9, 3, 0, Math.PI*2);
        this.ctx.fillStyle=color;
        this.ctx.fill();
        this.ctx.stroke();

        // Torso
        this.ctx.beginPath();
        this.ctx.moveTo(torsoTop.x, torsoTop.y);
        this.ctx.lineTo(torsoBottom.x, torsoBottom.y);
        this.ctx.stroke();

        // Arms
        let leftArmEnd, rightArmEnd;
        if (thrusting) {
            // Arms out for stability
            leftArmEnd={x: -6, y: -2};
            rightArmEnd={x: 6, y: -2};
        } else {
            // Sway arms when walking
            const armSway=isWalking? Math.sin(walkPhase)*5:0;
            leftArmEnd={x: -4-armSway, y: 0+armSway*0.5};
            rightArmEnd={x: 4+armSway, y: 0-armSway*0.5};
        }

        this.ctx.beginPath();
        this.ctx.moveTo(torsoTop.x, torsoTop.y);
        this.ctx.lineTo(leftArmEnd.x, leftArmEnd.y);
        this.ctx.moveTo(torsoTop.x, torsoTop.y);
        this.ctx.lineTo(rightArmEnd.x, rightArmEnd.y);
        this.ctx.stroke();

        // Legs
        let leftLegEnd, rightLegEnd;
        if (thrusting) {
            // Legs tuck in/down
            leftLegEnd={x: -2, y: 8};
            rightLegEnd={x: 2, y: 8};
        } else {
            // Walk cycle
            const legSway=isWalking? Math.sin(walkPhase)*5:0;
            const legLift=isWalking? Math.abs(Math.cos(walkPhase))*3:0;
            leftLegEnd={x: -3-legSway, y: 8-legLift};
            rightLegEnd={x: 3+legSway, y: 8-(isWalking? Math.abs(Math.cos(walkPhase+Math.PI))*3:0)};
        }

        this.ctx.beginPath();
        this.ctx.moveTo(torsoBottom.x, torsoBottom.y);
        this.ctx.lineTo(leftLegEnd.x, leftLegEnd.y);
        this.ctx.moveTo(torsoBottom.x, torsoBottom.y);
        this.ctx.lineTo(rightLegEnd.x, rightLegEnd.y);
        this.ctx.stroke();

        this.ctx.restore();
    }

    drawVehicles(vehicles) {
        for (const vehicle of vehicles) {
            this.ctx.save();
            this.ctx.translate(vehicle.x, vehicle.y);
            this.ctx.rotate(vehicle.angle||0);

            // Re-use ship drawing logic but for a static object
            if (this.spriteLoaded) {
                let sprite=this.landerSprite;
                let width=40;
                let height=40*(this.spriteFrameHeight/this.spriteFrameWidth);

                if (vehicle.type==='cargo'&&this.cargoShipSpriteLoaded) {
                    sprite=this.cargoShipSprite;
                    width=50;
                    height=50*(this.spriteFrameHeight/this.spriteFrameWidth);
                }

                const damageLevel=Math.min(11, Math.max(0, Math.floor(vehicle.damage||0)));
                const frameX=damageLevel%4;
                const frameY=Math.floor(damageLevel/4);

                this.ctx.drawImage(
                    sprite,
                    frameX*this.spriteFrameWidth, frameY*this.spriteFrameHeight,
                    this.spriteFrameWidth, this.spriteFrameHeight,
                    -width/2, -height/2,
                    width, height
                );
            } else {
                this.ctx.fillStyle='#555';
                this.ctx.fillRect(-10, -10, 20, 20);
            }

            // Draw "Parked" label above vehicle
            this.ctx.rotate(-vehicle.angle||0);
            this.ctx.fillStyle='rgba(0, 255, 255, 0.5)';
            this.ctx.font='10px monospace';
            this.ctx.textAlign='center';
            this.ctx.fillText('[E] BOARD', 0, -30);

            this.ctx.restore();
        }
    }

    drawWreckages(wreckages) {
        for (const wreckage of wreckages) {
            this.ctx.save();
            this.ctx.translate(wreckage.x, wreckage.y);
            this.ctx.rotate(wreckage.angle||0);

            if (this.spriteLoaded) {
                // Select sprite based on ship type
                let sprite=this.landerSprite;
                let drawWidth=40;
                let drawHeight=40*(this.spriteFrameHeight/this.spriteFrameWidth);

                if (wreckage.shipType==='cargo'&&this.cargoShipSpriteLoaded) {
                    sprite=this.cargoShipSprite;
                    drawWidth=50; // Cargo ship is bigger
                    drawHeight=50*(this.spriteFrameHeight/this.spriteFrameWidth);
                }

                // Draw sprite from sprite sheet - max damage frame (11)
                const damageLevel=11;
                const frameX=damageLevel%4;
                const frameY=Math.floor(damageLevel/4);

                const srcX=frameX*this.spriteFrameWidth;
                const srcY=frameY*this.spriteFrameHeight;

                // Darken it
                this.ctx.filter='brightness(0.7) sepia(0.3)';

                this.ctx.drawImage(
                    sprite,
                    srcX, srcY,
                    this.spriteFrameWidth, this.spriteFrameHeight,
                    -drawWidth/2, -drawHeight/2,
                    drawWidth, drawHeight
                );

                this.ctx.filter='none';

            } else {
                // Fallback: draw procedural destroyed ship
                this.ctx.fillStyle='#444'; // Dark gray
                this.ctx.strokeStyle='#222';
                this.ctx.lineWidth=2;

                this.ctx.beginPath();
                this.ctx.moveTo(15, 0);
                this.ctx.lineTo(-10, -10);
                this.ctx.lineTo(-5, 0);
                this.ctx.lineTo(-10, 10);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }

            // Draw cargo bag if it has cargo
            if (wreckage.cargo&&wreckage.cargo.length>0) {
                this.ctx.fillStyle='#dcb15b'; // Gold-ish bag color
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 8, 0, Math.PI*2);
                this.ctx.fill();
                this.ctx.strokeStyle='#000';
                this.ctx.stroke();
            }

            this.ctx.restore();
        }
    }

    drawDroppedItems(droppedItems) {
        // Ore colors by type
        const oreColors={
            'IRON_ORE': '#cd853f',
            'COPPER_ORE': '#daa520',
            'BITITE': '#4a4a4a',
            'SILVER_ORE': '#c0c0c0',
            'TITANIUM_ORE': '#b0c4de',
            'GOLD_ORE': '#ffd700',
            'PLATINUM_ORE': '#e5e4e2',
            'DIAMOND': '#b9f2ff',
            'HELIUM3': '#7fffd4'
        };

        for (const item of droppedItems) {
            const screenX=item.x-this.cameraX;
            const screenY=item.y-this.cameraY;

            // Skip if off-screen
            if (screenX<-50||screenX>this.canvas.width+50||
                screenY<-50||screenY>this.canvas.height+50) continue;

            this.ctx.save();
            this.ctx.translate(screenX, screenY);

            // Draw cable spool if sprite exists
            if (this.cableSprites&&this.cableSprites[item.type]) {
                const sprite=this.cableSprites[item.type];
                // Draw sprite centered, slightly larger than ores
                const size=24;
                this.ctx.drawImage(sprite, -size/2, -size/2, size, size);
                this.ctx.restore();
                continue;
            }

            const color=oreColors[item.type]||'#888888';

            // Draw ore chunk
            this.ctx.fillStyle=color;
            this.ctx.strokeStyle='#222';
            this.ctx.lineWidth=1;

            // Draw irregular ore shape
            this.ctx.beginPath();
            this.ctx.moveTo(-4, -3);
            this.ctx.lineTo(2, -5);
            this.ctx.lineTo(5, -1);
            this.ctx.lineTo(3, 4);
            this.ctx.lineTo(-2, 5);
            this.ctx.lineTo(-5, 1);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            // Add glow effect
            this.ctx.shadowColor=color;
            this.ctx.shadowBlur=8;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 3, 0, Math.PI*2);
            this.ctx.fill();
            this.ctx.shadowBlur=0;

            this.ctx.restore();
        }
    }

    // Draw contextual controls (only shows relevant actions)
    drawControlsHelp(myPlayer) {
        if (!myPlayer) return;

        const helpX=20;
        const controls=[];

        // Always show basic movement
        if (myPlayer.shipType==='eva') {
            controls.push(['W', 'Jump']);
            controls.push(['A/D', 'Move']);
        } else {
            controls.push(['W', 'Thrust']);
            controls.push(['A/D', 'Rotate']);
        }

        // Context: Mining (only when not on pad)
        if (!myPlayer.onPad&&myPlayer.shipType!=='eva') {
            controls.push(['SPACE', 'Mine']);
        }

        // Context: Vehicle interactions
        if (myPlayer.shipType==='eva') {
            controls.push(['E', 'Enter Vehicle']);
        } else {
            controls.push(['X', 'Exit (hold 2s)']);
        }

        // Context: At a building. The station menu opens beside any structure,
        // so the hint has to appear at outposts too, not only on the pad.
        if (myPlayer.onPad||myPlayer.nearBuilding) {
            controls.push(['B', 'Station Menu']);
        }
        if (myPlayer.onPad) {
            controls.push(['T', 'Transfer Cargo']);
        }

        // Context: Has cargo
        if (myPlayer.cargoAmount>0) {
            controls.push(['J', 'Jettison']);
        }

        // Context: Ship systems
        if (myPlayer.shipType!=='eva') {
            controls.push(['L', 'Spotlight']);
            controls.push(['G', 'Tether']);
        }

        // Context: Dead
        if (myPlayer.dead) {
            controls.push(['R', 'Respawn']);
        }

        // Always show these
        controls.push(['ESC', 'Menu']);

        // Calculate panel height
        const panelHeight=controls.length*15+20;
        const helpY=this.canvas.height-panelHeight-20;

        // Draw semi-transparent background
        this.ctx.fillStyle='rgba(0, 0, 0, 0.5)';
        this.ctx.fillRect(helpX-5, helpY-15, 145, panelHeight);

        this.ctx.textAlign='left';

        controls.forEach((ctrl, i) => {
            const [key, desc]=ctrl;

            // Draw shortcut key
            this.ctx.fillStyle='#6af';
            this.ctx.font='bold 11px monospace';
            this.ctx.shadowColor='#00aaff';
            this.ctx.shadowBlur=3;
            this.ctx.fillText(key.padEnd(6), helpX, helpY+i*15);

            // Draw description
            this.ctx.shadowBlur=0;
            this.ctx.fillStyle='#aaa';
            this.ctx.font='11px monospace';
            this.ctx.fillText(desc, helpX+55, helpY+i*15);
        });
    }

    drawInteractionUI(players, myId) {
        const myPlayer=players.find(p => p.id===myId);
        if (!myPlayer||myPlayer.dead) return;

        let targetPlayer=null;
        const mouseWorldX=this.mouseX+this.cameraX;
        const mouseWorldY=this.mouseY+this.cameraY;

        // Find player under mouse
        for (const player of players) {
            if (player.id===myId||player.dead) continue;

            const dx=player.x-mouseWorldX;
            const dy=player.y-mouseWorldY;
            const dist=Math.sqrt(dx*dx+dy*dy);

            if (dist<30) { // Targeting radius
                targetPlayer=player;
                break;
            }
        }

        if (targetPlayer) {
            const screenX=targetPlayer.x-this.cameraX;
            const screenY=targetPlayer.y-this.cameraY;
            const myScreenX=myPlayer.x-this.cameraX;
            const myScreenY=myPlayer.y-this.cameraY;

            // Draw dotted line
            this.ctx.save();
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeStyle='rgba(0, 255, 255, 0.6)';
            this.ctx.lineWidth=2;
            this.ctx.beginPath();
            this.ctx.moveTo(myScreenX, myScreenY);
            this.ctx.lineTo(screenX, screenY);
            this.ctx.stroke();

            // Draw interaction options near target
            const optionsX=screenX+30;
            const optionsY=screenY-30;

            this.ctx.fillStyle='rgba(0, 0, 0, 0.8)';
            this.ctx.strokeStyle='#0ff';
            this.ctx.lineWidth=1;
            this.ctx.beginPath();
            this.ctx.roundRect(optionsX, optionsY, 150, 70, 5);
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.fillStyle='#fff';
            this.ctx.font='12px monospace';
            this.ctx.textAlign='left';
            this.ctx.fillText(`[T] Open Cargo`, optionsX+10, optionsY+20);
            this.ctx.fillText(`[G] Tether / Tow`, optionsX+10, optionsY+40);
            this.ctx.fillText(`[R] Use Spare Parts`, optionsX+10, optionsY+60);

            // Draw targeted player name
            this.ctx.fillStyle='#0ff';
            this.ctx.font='bold 14px monospace';
            this.ctx.textAlign='center';
            this.ctx.fillText(targetPlayer.nickname||'Player', screenX, screenY-45);

            this.ctx.restore();
        }
    }

    drawMinimap(myPlayer, state) {
        if (!myPlayer||!this.voxelMap) return;

        const mapWidth=150;
        const mapHeight=200;
        const mapX=this.canvas.width-mapWidth-20;
        const mapY=this.canvas.height-mapHeight-20;

        // Calculate scale
        const scaleX=mapWidth/(this.mapWidth*this.tileSize);
        const scaleY=mapHeight/(this.mapHeight*this.tileSize);
        const scale=Math.min(scaleX, scaleY);

        // Check antenna range - if player is too deep, scramble minimap
        const antennaRange=state.antennaRange||2000; // Default if not provided
        const surfaceY=this.surfaceY||0;
        const playerDepth=Math.max(0, myPlayer.y-surfaceY);
        const isOutOfRange=playerDepth>antennaRange;

        // Draw background
        this.ctx.fillStyle='rgba(0, 0, 30, 0.8)';
        this.ctx.fillRect(mapX, mapY, mapWidth, mapHeight);
        this.ctx.strokeStyle=isOutOfRange? '#f44':'#446';
        this.ctx.lineWidth=2;
        this.ctx.strokeRect(mapX, mapY, mapWidth, mapHeight);

        // If out of antenna range, show scrambled display
        if (isOutOfRange) {
            this.drawScrambledMinimap(mapX, mapY, mapWidth, mapHeight);
            return;
        }

        // Draw terrain (very simplified - just sample points)
        this.ctx.fillStyle='#444';
        const sampleStep=8; // Sample every N tiles
        const chunkSize=20; // Must match server
        const chunksX=Math.ceil(this.mapWidth/chunkSize);

        // Default to all explored if no grid provided (backwards compatibility)
        const explorationGrid=state.explorationGrid;

        for (let gy=0; gy<this.mapHeight; gy+=sampleStep) {
            for (let gx=0; gx<this.mapWidth; gx+=sampleStep) {
                // Check exploration status
                if (explorationGrid) {
                    const cx=Math.floor(gx/chunkSize);
                    const cy=Math.floor(gy/chunkSize);
                    const idx=cy*chunksX+cx;
                    if (!explorationGrid[idx]) continue; // Skip unexplored
                }

                const tile=this.voxelMap[gy]?.[gx];
                if (tile&&tile>0) {
                    const mx=mapX+gx*this.tileSize*scale;
                    const my=mapY+gy*this.tileSize*scale;

                    // Color based on tile type
                    if (tile>=10) {
                        this.ctx.fillStyle='#ff0'; // Ore
                    } else if (tile===2) {
                        this.ctx.fillStyle='#0af'; // Pad
                    } else if (tile===3) {
                        this.ctx.fillStyle='#aaa'; // Base
                    } else {
                        // Different shades for depth in minimap
                        const depth=gy/this.mapHeight;
                        const val=Math.floor(68-depth*20);
                        this.ctx.fillStyle=`rgb(${val}, ${val}, ${val})`;
                    }

                    this.ctx.fillRect(mx, my, sampleStep*this.tileSize*scale, sampleStep*this.tileSize*scale);
                }
            }
        }

        // Draw moon base position
        if (this.basePosition) {
            const baseMapX=mapX+this.basePosition.x*scale;
            const baseMapY=mapY+this.basePosition.y*scale;
            this.ctx.fillStyle='#fff';
            this.ctx.fillRect(baseMapX-3, baseMapY-3, 6, 6);
        }

        // Draw all players
        for (const player of state.players) {
            if (player.dead) continue;

            const px=mapX+player.x*scale;
            const py=mapY+player.y*scale;

            // Draw player dot
            // Only draw teammates if their antenna is on
            if (player.id===myPlayer.id) {
                this.ctx.fillStyle='#0f0'; // Self is green
                this.ctx.beginPath();
                this.ctx.arc(px, py, 3, 0, Math.PI*2);
                this.ctx.fill();
            } else if (player.antennaOn!==false) {
                this.ctx.fillStyle='#0af'; // Teammates are cyan
                this.ctx.beginPath();
                this.ctx.arc(px, py, 3, 0, Math.PI*2);
                this.ctx.fill();
            }

            // Draw ping if active
            if (player.activePing) {
                const pingX=mapX+player.activePing.x*scale;
                const pingY=mapY+player.activePing.y*scale;
                const pingColors={yellow: '#ff0', red: '#f00', green: '#0f0', blue: '#00f'};
                this.ctx.fillStyle=pingColors[player.activePing.type]||'#ff0';
                this.ctx.beginPath();
                this.ctx.arc(pingX, pingY, 4, 0, Math.PI*2);
                this.ctx.fill();
            }
        }

        // Draw viewport indicator
        const vpX=mapX+this.cameraX*scale;
        const vpY=mapY+this.cameraY*scale;
        const vpW=this.canvas.width*scale;
        const vpH=this.canvas.height*scale;
        this.ctx.strokeStyle='rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth=1;
        this.ctx.strokeRect(vpX, vpY, vpW, vpH);

        // Label
        this.ctx.fillStyle='#888';
        this.ctx.font='10px monospace';
        this.ctx.textAlign='center';
        this.ctx.fillText('MINIMAP', mapX+mapWidth/2, mapY-5);
    }

    drawHUD(myPlayer, state) {
        if (!myPlayer) return;

        this.ctx.fillStyle='white';
        this.ctx.font='16px monospace';
        this.ctx.textAlign='left';

        // Shift down by 10% of screen height to avoid top bar obstruction
        const topOffset=this.canvas.height*0.1;

        const barX=20;
        const barY=20+topOffset;
        const barWidth=200;
        const barHeight=20;

        // Fuel bar (only if not EVA)
        const isEVA=myPlayer.shipType==='eva';
        if (!isEVA) {
            const maxFuel=myPlayer.maxFuel||500;
            const fuelPercent=Math.max(0, myPlayer.fuel/maxFuel);
            this.ctx.fillStyle='#333';
            this.ctx.fillRect(barX, barY, barWidth, barHeight);
            this.ctx.fillStyle=fuelPercent>0.3? '#4a4':'#a44';
            this.ctx.fillRect(barX, barY, barWidth*fuelPercent, barHeight);
            this.ctx.strokeStyle='#fff';
            this.ctx.lineWidth=2;
            this.ctx.strokeRect(barX, barY, barWidth, barHeight);
            this.ctx.fillStyle='#fff';
            this.ctx.fillText(`FUEL: ${Math.floor(myPlayer.fuel)}/${maxFuel}`, barX, barY+barHeight+20);
        } else {
            // Oxygen bar for EVA
            const oxygen=myPlayer.oxygen||0;
            const maxOxygen=myPlayer.maxOxygen||100;
            const oxPercent=Math.max(0, oxygen/maxOxygen);
            this.ctx.fillStyle='#333';
            this.ctx.fillRect(barX, barY, barWidth, barHeight);
            this.ctx.fillStyle=oxPercent>0.5? '#0ff':oxPercent>0.2? '#aa4':'#f00';
            this.ctx.fillRect(barX, barY, barWidth*oxPercent, barHeight);
            this.ctx.strokeStyle='#fff';
            this.ctx.lineWidth=2;
            this.ctx.strokeRect(barX, barY, barWidth, barHeight);
            this.ctx.fillStyle='#fff';
            this.ctx.fillText(`OXYGEN: ${Math.floor(oxygen)}%`, barX, barY+barHeight+20);
        }

        // Power bar
        const maxPower=myPlayer.maxPower||100;
        const powerPercent=Math.max(0, (myPlayer.power||0)/maxPower);
        const lightsOn=myPlayer.lightsOn!==false;
        const spotlightOn=myPlayer.spotlightOn!==false;
        const antennaOn=myPlayer.antennaOn!==false;

        this.ctx.fillStyle='#333';
        this.ctx.fillRect(barX, barY+50, barWidth, barHeight);
        this.ctx.fillStyle=powerPercent>0.3? '#44a':powerPercent>0.1? '#aa4':'#a44';
        this.ctx.fillRect(barX, barY+50, barWidth*powerPercent, barHeight);
        this.ctx.strokeStyle='#0af';
        this.ctx.strokeRect(barX, barY+50, barWidth, barHeight);
        this.ctx.fillStyle='#0af';
        this.ctx.fillText(`POWER: ${Math.floor(myPlayer.power||0)}/${maxPower}`, barX, barY+barHeight+70);

        // System status
        this.ctx.font='10px monospace';
        const systemsText=`LIGHTS:${lightsOn? 'ON':'OFF'} SPOTLIGHT:${spotlightOn? 'ON':'OFF'} ANTENNA:${antennaOn? 'ON':'OFF'}`;
        this.ctx.fillText(systemsText, barX, barY+barHeight+85);
        this.ctx.font='16px monospace';

        // Damage bar
        const damage=myPlayer.damage||0;
        const damagePercent=Math.min(1, damage/11);
        this.ctx.fillStyle='#333';
        this.ctx.fillRect(barX, barY+100, barWidth, barHeight);
        this.ctx.fillStyle=damagePercent<0.5? '#4a4':damagePercent<0.8? '#aa4':'#a44';
        this.ctx.fillRect(barX, barY+100, barWidth*damagePercent, barHeight);
        this.ctx.strokeStyle='#fff';
        this.ctx.strokeRect(barX, barY+100, barWidth, barHeight);
        this.ctx.fillStyle='#fff';
        this.ctx.fillText(`DAMAGE: ${Math.floor(damage)}/11`, barX, barY+barHeight+120);

        // Velocity
        const speed=Math.sqrt(myPlayer.vx*myPlayer.vx+myPlayer.vy*myPlayer.vy);
        this.ctx.fillText(`SPEED: ${speed.toFixed(1)}`, barX, barY+barHeight+145);

        // Depth indicator
        const surfaceY=this.surfaceY||0;
        const depth=Math.max(0, myPlayer.y-surfaceY);
        const depthMeters=Math.floor(depth/8); // 8 pixels per meter
        this.ctx.fillText(`DEPTH: ${depthMeters}m`, barX+120, barY+barHeight+145);

        // Cargo bar
        const cargoAmount=myPlayer.cargoAmount||0;
        const cargoCapacity=myPlayer.cargoCapacity||500;
        const cargoPercent=cargoAmount/cargoCapacity;
        this.ctx.fillStyle='#333';
        this.ctx.fillRect(barX, barY+170, barWidth, barHeight);
        this.ctx.fillStyle=cargoPercent<0.8? '#44a':'#a4a';
        this.ctx.fillRect(barX, barY+170, barWidth*cargoPercent, barHeight);
        this.ctx.strokeStyle='#fff';
        this.ctx.strokeRect(barX, barY+170, barWidth, barHeight);
        this.ctx.fillStyle='#fff';
        this.ctx.fillText(`CARGO: ${Math.floor(cargoAmount)}/${cargoCapacity}`, barX, barY+barHeight+190);

        // Mass/Weight info
        const totalMass=1.0+(cargoAmount*0.002);
        this.ctx.fillStyle='#aaa';
        this.ctx.font='12px monospace';
        this.ctx.fillText(`TOTAL MASS: ${totalMass.toFixed(2)}t`, barX, barY+barHeight+205);

        // Oxygen bar for ships too
        if (!isEVA) {
            const oxygen=myPlayer.oxygen||100;
            const maxOxygen=myPlayer.maxOxygen||100;
            const oxPercent=Math.max(0, oxygen/maxOxygen);
            const oxY=barY+220;
            this.ctx.fillStyle='#333';
            this.ctx.fillRect(barX, oxY, barWidth, barHeight);
            this.ctx.fillStyle=oxPercent>0.5? '#0ff':oxPercent>0.2? '#aa4':'#f00';
            this.ctx.fillRect(barX, oxY, barWidth*oxPercent, barHeight);
            this.ctx.strokeStyle='#fff';
            this.ctx.strokeRect(barX, oxY, barWidth, barHeight);
            this.ctx.fillStyle='#fff';
            this.ctx.fillText(`OXYGEN: ${Math.floor(oxygen)}%`, barX, oxY+barHeight+20);
        }

        // Mining progress indicator
        if (myPlayer.mining&&myPlayer.miningProgress>0) {
            const miningY=barY+260; // Shifted down for oxygen bar
            this.ctx.fillStyle='#333';
            this.ctx.fillRect(barX, miningY, barWidth, barHeight/2);
            this.ctx.fillStyle='#0af';
            this.ctx.fillRect(barX, miningY, barWidth*myPlayer.miningProgress, barHeight/2);
            this.ctx.strokeStyle='#0ff';
            this.ctx.strokeRect(barX, miningY, barWidth, barHeight/2);
            this.ctx.fillStyle='#0ff';
            this.ctx.font='12px monospace';
            this.ctx.fillText('MINING...', barX, miningY+barHeight/2+15);
        }

        // Landing indicator
        if (myPlayer.onPad) {
            this.ctx.fillStyle=myPlayer.landed? '#4f4':'#ff4';
            this.ctx.font='bold 18px monospace';
            this.ctx.textAlign='center';
            const statusText=myPlayer.landed? 'LANDED - REFUELING/REPAIRING':'ON PAD - SLOW DOWN TO LAND';
            this.ctx.fillText(statusText, this.canvas.width/2, 30+topOffset);
        }

        // Docking indicator
        if (myPlayer.dockingTarget) {
            this.ctx.textAlign='center';
            if (myPlayer.isDocked) {
                this.ctx.fillStyle=myPlayer.fuelTransferring? '#0ff':'#0f0';
                const dockText=myPlayer.fuelTransferring? 'TRANSFERRING FUEL [F]':'DOCKED - PRESS [F] TO TRANSFER FUEL';
                this.ctx.font='bold 16px monospace';
                this.ctx.fillText(dockText, this.canvas.width/2, 55+topOffset);
            } else {
                this.ctx.fillStyle='#ff0';
                this.ctx.font='14px monospace';
                this.ctx.fillText('MATCH VELOCITY TO DOCK', this.canvas.width/2, 55+topOffset);
            }
        }

        // Base resources (top right)
        const spareParts=state?.baseResources?.spareParts||0;
        const baseFuel=state?.baseResources?.fuel||0;
        this.ctx.textAlign='right';
        this.ctx.fillStyle='#aaa';
        this.ctx.font='14px monospace';
        this.ctx.fillText(`BASE FUEL: ${Math.floor(baseFuel)}`, this.canvas.width-20, 30+topOffset);
        this.ctx.fillText(`BASE OXYGEN: ${Math.floor(state.baseResources?.oxygen||0)}`, this.canvas.width-20, 50+topOffset);
        this.ctx.fillText(`BASE SPARE PARTS: ${Math.floor(spareParts)}`, this.canvas.width-20, 70+topOffset);

        // Player count. Was drawn at the same y as BASE SPARE PARTS above, so
        // the two strings rendered on top of each other.
        const aliveCount=state?.aliveCount||0;
        const totalCount=state?.players?.length||0;
        this.ctx.fillText(`PLAYERS: ${aliveCount}/${totalCount} alive`, this.canvas.width-20, 90+topOffset);

        // DEPTH -- the whole point of the game is to reach the core, and until
        // now there was no way to see how far down you were.
        this.drawDepthGauge(myPlayer, state, topOffset);

        // Hand-fill prompt: pouring ship fuel into a building tank is how a
        // remote base gets bootstrapped, and it is undiscoverable unless said.
        this.drawHandFillPrompt(myPlayer);
        // Draw Station UI if landed
        // if (myPlayer.onPad) {
        //     this.drawStationUI(myPlayer, state);
        // }

        // minimap
        this.drawMinimap(myPlayer, state);

        // Chat
        this.drawChat();
    }

    // Ghost preview while placing a building: shows every Landing Pad's build
    // zone, the deck band that gets free connection, and whether this spot is
    // legal. The rules are re-checked on the server; this only has to explain
    // them well enough that the player is not guessing.
    drawPlacementPreview(state, type, mouseWorldX, mouseWorldY, cameraX, cameraY) {
        if (!type) return;
        const nodes=state.networks?.nodes||{};
        const pads=Object.values(nodes).filter(n => n.key==='landing_pad');
        const radius=state.buildRadius||400;
        const band=state.baseBusBand||60;
        const spacing=state.buildSpacing||100;

        this.ctx.save();

        // Build zones.
        for (const p of pads) {
            const sx=p.x-cameraX;
            const sy=p.y-cameraY;
            this.ctx.beginPath();
            this.ctx.arc(sx, sy, radius, 0, Math.PI*2);
            this.ctx.fillStyle='rgba(68,136,255,0.05)';
            this.ctx.fill();
            this.ctx.strokeStyle='rgba(68,136,255,0.45)';
            this.ctx.lineWidth=1.5;
            this.ctx.setLineDash([8, 6]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            // The deck band: inside this, buildings wire up for free.
            this.ctx.fillStyle='rgba(68,221,85,0.06)';
            this.ctx.fillRect(sx-radius, sy-band, radius*2, band*2);
        }

        const isPad=type==='landing_pad';
        let valid=isPad||pads.some(p => Math.hypot(p.x-mouseWorldX, p.y-mouseWorldY)<=radius);
        let why=valid? '':'OUTSIDE BUILD ZONE';

        // Spacing against everything already placed.
        if (valid) {
            for (const n of Object.values(nodes)) {
                if (Math.hypot(n.x-mouseWorldX, n.y-mouseWorldY)<spacing) {
                    valid=false;
                    why='TOO CLOSE';
                    break;
                }
            }
        }

        const mx=mouseWorldX-cameraX;
        const my=mouseWorldY-cameraY;
        const colour=valid? '#44dd55':'#ff4444';

        // Footprint.
        const w=92, h=92;
        this.ctx.globalAlpha=0.35;
        this.ctx.fillStyle=colour;
        this.ctx.fillRect(mx-w/2, my-h, w, h);
        this.ctx.globalAlpha=1;
        this.ctx.strokeStyle=colour;
        this.ctx.lineWidth=2;
        this.ctx.strokeRect(mx-w/2, my-h, w, h);

        // Spacing ring, so overlaps are obvious before clicking.
        this.ctx.globalAlpha=0.5;
        this.ctx.beginPath();
        this.ctx.arc(mx, my, spacing, 0, Math.PI*2);
        this.ctx.setLineDash([4, 4]);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        this.ctx.globalAlpha=1;

        // Whether it would come up connected for free.
        const onDeck=pads.some(p => Math.abs(p.y-mouseWorldY)<=band&&
            Math.hypot(p.x-mouseWorldX, p.y-mouseWorldY)<=radius);
        const note=valid
            ? (onDeck? 'CONNECTED AUTOMATICALLY':'NEEDS CABLE — off the pad deck')
            : why;

        this.ctx.font='11px Consolas, monospace';
        this.ctx.textAlign='center';
        const tw=this.ctx.measureText(note).width;
        this.ctx.fillStyle='rgba(0,0,0,0.75)';
        this.ctx.fillRect(mx-tw/2-6, my+8, tw+12, 16);
        this.ctx.fillStyle=valid? (onDeck? '#44dd55':'#ffb347'):'#ff6666';
        this.ctx.fillText(note, mx, my+20);
        this.ctx.textAlign='left';

        this.ctx.restore();
    }

    // Incoming transmission panel for depth-triggered story beats. Slides in from
    // the left, holds, then fades. Deliberately styled like comms traffic rather
    // than a cutscene, so it never takes control away from the player.
    drawStoryBeat(beat, age, hold) {
        const slideIn=Math.min(1, age/380);
        const fadeOut=age>hold-900? Math.max(0, (hold-age)/900):1;
        const alpha=Math.min(slideIn, fadeOut);
        if (alpha<=0) return;

        const ctx=this.ctx;
        const w=Math.min(520, this.canvas.width-60);
        const lineH=17;
        const h=54+beat.lines.length*lineH;
        const x=24-(1-slideIn)*40;
        const y=this.canvas.height/2-h/2;

        ctx.save();
        ctx.globalAlpha=alpha;

        ctx.fillStyle='rgba(4,8,14,0.90)';
        ctx.fillRect(x, y, w, h);
        // Amber for Consortium traffic, red once the unknown starts talking.
        const accent=beat.from&&beat.from.includes('—')? '#ff5544':'#ffb347';
        ctx.fillStyle=accent;
        ctx.fillRect(x, y, 3, h);

        ctx.textAlign='left';
        ctx.font='10px Consolas, monospace';
        ctx.fillStyle=accent;
        ctx.fillText(`▸ INCOMING TRANSMISSION · ${beat.depth}m`, x+14, y+18);

        ctx.font='bold 13px Consolas, monospace';
        ctx.fillStyle='#fff';
        ctx.fillText(beat.title, x+14, y+37);

        ctx.font='9px Consolas, monospace';
        ctx.fillStyle='#7d8794';
        ctx.fillText(beat.from, x+14, y+49);

        ctx.font='12px Consolas, monospace';
        beat.lines.forEach((line, i) => {
            // Reveal line by line so it reads as it arrives.
            if (age<520+i*420) return;
            ctx.fillStyle='#cdd6e0';
            ctx.fillText(line, x+14, y+70+i*lineH);
        });

        ctx.restore();
    }

    // Depth readout plus a vertical gauge showing progress toward the Core.
    // Depth is sent by the server so the HUD, the win condition and the victory
    // screen can never disagree.
    // "PRESS [F] TO FUEL <building>" with a tank gauge, shown whenever the
    // player is close enough to pour fuel into something.
    drawHandFillPrompt(myPlayer) {
        const t=myPlayer?.handFillTarget;
        if (!t) return;

        const ctx=this.ctx;
        const cx=this.canvas.width/2;
        const y=this.canvas.height-140;
        const filling=myPlayer.fuel>0;
        const label=filling
            ? `PRESS [F] TO FUEL ${t.name.toUpperCase()}`
            : `${t.name.toUpperCase()} NEEDS FUEL — YOUR TANK IS EMPTY`;

        ctx.save();
        ctx.font='12px Consolas, monospace';
        ctx.textAlign='center';
        const w=Math.max(230, ctx.measureText(label).width+30);

        ctx.fillStyle='rgba(4,8,14,0.85)';
        ctx.fillRect(cx-w/2, y-18, w, 42);
        ctx.strokeStyle=filling? '#ffb347':'#ff5555';
        ctx.lineWidth=1;
        ctx.strokeRect(cx-w/2, y-18, w, 42);

        ctx.fillStyle=filling? '#ffb347':'#ff6666';
        ctx.fillText(label, cx, y-3);

        // Tank fill bar.
        const bw=w-40;
        const frac=t.capacity>0? Math.min(1, t.tank/t.capacity):0;
        ctx.fillStyle='#222';
        ctx.fillRect(cx-bw/2, y+6, bw, 6);
        ctx.fillStyle='#ffb347';
        ctx.fillRect(cx-bw/2, y+6, bw*frac, 6);

        ctx.font='9px Consolas, monospace';
        ctx.fillStyle='#8b95a1';
        ctx.fillText(`${Math.round(t.tank)} / ${Math.round(t.capacity)}`, cx, y+22);
        ctx.restore();
    }

    drawDepthGauge(myPlayer, state, topOffset=0) {
        if (!myPlayer) return;
        const depth=myPlayer.depth;
        if (depth===undefined) return;

        const total=state?.totalDepth||5000;
        const core=state?.coreDepth||Math.round(total*0.94);
        const shown=Math.max(0, depth);

        const x=this.canvas.width-20;
        const y=120+topOffset;

        // Biome tint deepens as you descend, so the number feels like a place.
        const frac=Math.min(1, shown/total);
        const hue=200-140*frac;

        this.ctx.save();
        this.ctx.textAlign='right';
        this.ctx.font='bold 18px monospace';
        this.ctx.fillStyle=`hsl(${hue}, 75%, 62%)`;
        this.ctx.fillText(`${shown.toLocaleString()} m`, x, y);
        this.ctx.font='11px monospace';
        this.ctx.fillStyle='#888';
        this.ctx.fillText('DEPTH', x, y+14);

        // Vertical progress bar toward the core.
        const gh=110;
        const gw=6;
        const gx=x-58;
        const gy=y-14;
        this.ctx.fillStyle='rgba(255,255,255,0.10)';
        this.ctx.fillRect(gx, gy, gw, gh);
        this.ctx.fillStyle=`hsl(${hue}, 75%, 55%)`;
        this.ctx.fillRect(gx, gy, gw, gh*frac);

        // Core marker.
        const cy=gy+gh*Math.min(1, core/total);
        this.ctx.strokeStyle='#ffcc44';
        this.ctx.lineWidth=1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(gx-3, cy);
        this.ctx.lineTo(gx+gw+3, cy);
        this.ctx.stroke();

        // Bearing to the Core once it is close enough to aim at. The chamber is
        // a specific place, so a depth number alone is not enough to find it.
        const cp=state?.corePosition;
        if (cp&&shown>total*0.6) {
            const dx=cp.x-myPlayer.x;
            const dy=cp.y-myPlayer.y;
            const dist=Math.round(Math.hypot(dx, dy));
            this.ctx.font='10px monospace';
            this.ctx.fillStyle='#ffcc44';
            const arrow=Math.abs(dx)<120? '↓':(dx>0? '→':'←');
            this.ctx.fillText(`CORE ${arrow} ${dist}m`, x, y+44);
        }

        // Distance still to go, once you are actually underground.
        if (shown>50&&shown<core) {
            this.ctx.font='10px monospace';
            this.ctx.fillStyle='#ffcc44';
            this.ctx.fillText(`CORE −${(core-shown).toLocaleString()}m`, x, y+30);
        } else if (shown>=core) {
            this.ctx.font='bold 10px monospace';
            this.ctx.fillStyle='#ffcc44';
            this.ctx.fillText('◆ THE CORE', x, y+30);
        }
        this.ctx.restore();
    }

    drawQuickbar(myPlayer) {
        if (!myPlayer||myPlayer.dead) return;

        const slotCount=9;
        const slotSize=50;
        const slotGap=4;
        const totalWidth=(slotSize+slotGap)*slotCount-slotGap;
        const startX=(this.canvas.width-totalWidth)/2;
        const startY=this.canvas.height-70;

        // Get cargo for display
        const cargo=myPlayer.cargo||[];

        for (let i=0; i<slotCount; i++) {
            const x=startX+i*(slotSize+slotGap);
            const y=startY;

            // Slot background
            this.ctx.fillStyle='rgba(20, 20, 30, 0.8)';
            this.ctx.strokeStyle=this.selectedQuickbarSlot===i? '#6af':'#444';
            this.ctx.lineWidth=this.selectedQuickbarSlot===i? 2:1;
            this.ctx.beginPath();
            this.ctx.roundRect(x, y, slotSize, slotSize, 4);
            this.ctx.fill();
            this.ctx.stroke();

            // Keybind number
            this.ctx.fillStyle='#666';
            this.ctx.font='10px monospace';
            this.ctx.textAlign='left';
            this.ctx.fillText(String(i+1), x+3, y+12);

            // Item if exists
            const item=cargo[i];
            if (item) {
                // Determine if it's a material or ore
                const materialOrder=['basic', 'industrial', 'advanced', 'quantum', 'fuel'];
                const materialIndex=materialOrder.indexOf(item.type.toLowerCase());

                if (materialIndex!==-1&&this.materialsSpriteLoaded) {
                    // Draw material sprite
                    this.ctx.drawImage(
                        this.materialsSprite,
                        materialIndex*32, 0, 32, 32,
                        x+10, y+10, 30, 30
                    );
                } else {
                    // Draw colored square for ore
                    const color=this.getOreColor(item.type);
                    this.ctx.fillStyle=color;
                    this.ctx.fillRect(x+10, y+15, 30, 25);
                }

                // Amount
                this.ctx.fillStyle='#fff';
                this.ctx.font='bold 10px monospace';
                this.ctx.textAlign='right';
                this.ctx.fillText(item.amount, x+slotSize-4, y+slotSize-4);
            }
        }
    }

    getOreColor(type) {
        const colors={
            'IRON_ORE': '#cd853f',
            'COPPER_ORE': '#daa520',
            'BITITE': '#4a4a4a',
            'SILVER_ORE': '#c0c0c0',
            'TITANIUM_ORE': '#b0c4de',
            'GOLD_ORE': '#ffd700',
            'PLATINUM_ORE': '#e5e4e2',
            'DIAMOND': '#b9f2ff',
            'HELIUM3': '#7fffd4'
        };
        return colors[type]||'#888';
    }

    drawStationUI(player, state) {
        const ctx=this.ctx;
        const width=this.canvas.width;
        const height=this.canvas.height;
        const baseRes=state.baseResources;

        // Larger panel for more info
        const panelW=680;
        const panelH=360;
        const x=(width-panelW)/2;
        const topOffset=height*0.1;
        const y=60+topOffset;

        // Background with subtle glow
        ctx.save();
        ctx.shadowBlur=15;
        ctx.shadowColor='rgba(0, 240, 255, 0.3)';
        ctx.fillStyle='rgba(10, 10, 22, 0.95)';
        ctx.strokeStyle='#00f0ff';
        ctx.lineWidth=2;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, panelW, panelH, 15);
        } else {
            ctx.rect(x, y, panelW, panelH);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Header
        ctx.fillStyle='#00f0ff';
        ctx.font='bold 22px monospace';
        ctx.textAlign='center';
        ctx.fillText('MOON STATION ALPHA', x+panelW/2, y+40);

        // Subheader line
        ctx.strokeStyle='rgba(0, 240, 255, 0.2)';
        ctx.beginPath();
        ctx.moveTo(x+40, y+55);
        ctx.lineTo(x+panelW-40, y+55);
        ctx.stroke();

        // Layout Columns
        const gap=25;
        const colW=(panelW-gap*4)/3;
        const col1=x+gap;
        const col2=col1+colW+gap;
        const col3=col2+colW+gap;

        let rowY=y+90;
        const rowH=24;

        ctx.textAlign='left';

        // === Column 1: Base Systems ===
        ctx.font='bold 14px monospace';
        ctx.fillStyle='#888';
        ctx.fillText('STATUS & LOGISTICS', col1, rowY-10);

        const drawSystem=(label, value, max, color, yPos) => {
            ctx.font='11px monospace';
            ctx.fillStyle='#aaa';
            ctx.fillText(label, col1, yPos);
            ctx.textAlign='right';
            ctx.fillStyle=color;
            ctx.fillText(`${Math.floor(value)} / ${max}`, col1+colW, yPos);
            ctx.textAlign='left';

            // Small progress bar
            ctx.fillStyle='rgba(255,255,255,0.05)';
            ctx.fillRect(col1, yPos+6, colW, 4);
            ctx.fillStyle=color;
            ctx.fillRect(col1, yPos+6, colW*Math.min(1, value/max), 4);
        };

        drawSystem('STATION FUEL', baseRes.fuel||0, baseRes.maxFuel||10000, '#ffaa00', rowY+10);
        drawSystem('SPARE PARTS', baseRes.spareParts||0, baseRes.maxSpareParts||1000, '#ccc', rowY+45);
        drawSystem('GRID POWER', baseRes.power||0, baseRes.maxPower||100, '#0af', rowY+80);

        // === Column 2: Ore Storage ===
        let oreY=y+105;
        ctx.font='bold 14px monospace';
        ctx.fillStyle='#888';
        ctx.fillText('ORE HOLDING', col2, oreY-25);

        const ores=[
            {name: 'Iron', key: 'iron', color: '#8b4513', index: 0},
            {name: 'Copper', key: 'copper', color: '#b87333', index: 1},
            {name: 'Bitite', key: 'bitite', color: '#4a4a4a', index: 2},
            {name: 'Silver', key: 'silver', color: '#c0c0c0', index: 3},
            {name: 'Titanium', key: 'titanium', color: '#708090', index: 4},
            {name: 'Gold', key: 'gold', color: '#ffd700', index: 5},
            {name: 'Platinum', key: 'platinum', color: '#e5e4e2', index: 6},
            {name: 'Diamond', key: 'diamond', color: '#b9f2ff', index: 7},
            {name: 'Helium3', key: 'helium3', color: '#7fffd4', index: 8}
        ];

        ctx.font='12px monospace';
        for (const ore of ores) {
            const val=baseRes[ore.key]||0;
            if (this.oresSpriteLoaded) {
                // Larger icons (24x24)
                ctx.drawImage(this.oresSprite, ore.index*32, 0, 32, 32, col2, oreY-16, 22, 22);
            }
            ctx.fillStyle=ore.color;
            ctx.fillText(ore.name, col2+30, oreY+2);
            ctx.textAlign='right';
            ctx.fillStyle='#fff';
            ctx.fillText(Math.floor(val), col2+colW, oreY+2);
            ctx.textAlign='left';
            oreY+=rowH+2;
        }

        // === Column 3: Materials & Refinery ===
        let matY=y+105;
        ctx.font='bold 14px monospace';
        ctx.fillStyle='#888';
        ctx.fillText('PROCESSED ASSETS', col3, matY-25);

        const materials=[
            {label: 'Basic', key: 'basic', color: '#8b8b6b', index: 0},
            {label: 'Industrial', key: 'industrial', color: '#7090a0', index: 1},
            {label: 'Advanced', key: 'advanced', color: '#daa520', index: 2},
            {label: 'Quantum', key: 'quantum', color: '#ff69b4', index: 3},
            {label: 'Liquid Fuel', key: 'fuel', color: '#33ff33', index: 4}
        ];

        for (const mat of materials) {
            if (this.materialsSpriteLoaded) {
                ctx.drawImage(this.materialsSprite, mat.index*32, 0, 32, 32, col3, matY-16, 22, 22);
            }
            ctx.fillStyle=mat.color;
            ctx.font='12px monospace';
            ctx.fillText(mat.label, col3+30, matY+2);
            ctx.textAlign='right';
            ctx.fillStyle='#fff';
            ctx.fillText(Math.floor(baseRes[mat.key]||0), col3+colW, matY+2);
            ctx.textAlign='left';
            matY+=rowH+2;
        }

        matY+=15;
        ctx.font='bold 14px monospace';
        ctx.fillStyle='#888';
        ctx.fillText('OPERATIONS', col3, matY-5);
        matY+=20;

        const time=Date.now()/1000;
        const dots=".".repeat(Math.floor(time%4));
        ctx.fillStyle='#ffcc00';
        ctx.font='italic 11px monospace';
        ctx.fillText(`REFINERY: ACTIVE${dots}`, col3, matY);
        matY+=18;

        const antennaRange=state.antennaRange||400;
        ctx.fillStyle='#00ffaa';
        ctx.fillText(`COMM-LINK: ${antennaRange}m`, col3, matY);

        // === Bottom Bar actions ===
        const bottomY=y+panelH-35;

        ctx.fillStyle='rgba(255, 255, 255, 0.03)';
        ctx.fillRect(x+20, bottomY-20, panelW-40, 45);
        ctx.strokeStyle='rgba(0, 240, 255, 0.1)';
        ctx.strokeRect(x+20, bottomY-20, panelW-40, 45);

        ctx.textAlign='center';
        if (player.cargo&&player.cargo.length>0) {
            ctx.fillStyle='#ff0055';
            ctx.font='bold 14px monospace';
            ctx.fillText('[HOLD T] TRANSFER CARGO TO STATION STORAGE', x+panelW/2, bottomY+8);
        } else {
            ctx.fillStyle='#555';
            ctx.font='12px monospace';
            ctx.fillText('CARGO HOLD DEPLETED - NO ASSETS TO TRANSFER', x+panelW/2, bottomY+8);
        }

        // Mini status indicators for ship (far left/right)
        ctx.textAlign='left';
        ctx.font='bold 10px monospace';
        const maxShipFuel=player.maxFuel||500;

        if (player.damage>0&&baseRes.spareParts>0) {
            ctx.fillStyle='#0f0';
            ctx.fillText('● AUTO-REPAIR IN PROGRESS', x+35, y+panelH-65);
        }
        if (player.fuel<maxShipFuel&&baseRes.fuel>0) {
            ctx.fillStyle='#ffaa00';
            ctx.textAlign='right';
            ctx.fillText('AUTO-REFUELING ACTIVE ●', x+panelW-35, y+panelH-65);
        }
    }

    showMessage(text, duration=3000) {
        this.message=text;
        this.messageTime=performance.now()+duration;
    }

    // Spawn floating text for ore pickup
    spawnOrePickupText(oreName, amount, x, y, color='#fff') {
        const LIFE=1.2;
        this.floatingTexts.push({
            text: `+${amount} ${oreName}`,
            x,
            y,
            color,
            life: LIFE,
            // Absolute deadline as well as the countdown. The countdown alone
            // decays by frame delta, so a single skipped, stalled or
            // non-finite frame could leave a pickup message on screen
            // indefinitely -- which is why "+3 Iron" sometimes stuck around.
            expiresAt: performance.now()+LIFE*1000,
            vy: -60 // Faster upward float
        });

        // Never let the list grow without bound if frames are being dropped.
        if (this.floatingTexts.length>40) this.floatingTexts.splice(0, this.floatingTexts.length-40);
    }

    // Update and draw floating texts
    updateFloatingTexts(dt) {
        // Guard against a garbage delta (first frame, tab restored from
        // background, clock skew). Without this, ft.life can go NaN and the
        // filter below keeps the entry forever.
        const step=Number.isFinite(dt)? Math.min(Math.max(dt, 0), 0.25):0;
        const now=performance.now();

        this.floatingTexts=this.floatingTexts.filter(ft => {
            ft.life-=step;
            ft.y+=ft.vy*step;
            // Either condition retires it; the deadline is the backstop.
            return ft.life>0&&(!ft.expiresAt||now<ft.expiresAt);
        });
    }

    drawFloatingTexts() {
        for (const ft of this.floatingTexts) {
            const alpha=Math.min(1, ft.life*2); // Fade out faster
            const screenX=ft.x-this.cameraX;
            const screenY=ft.y-this.cameraY;

            this.ctx.save();
            this.ctx.globalAlpha=alpha;
            this.ctx.fillStyle=ft.color;
            this.ctx.strokeStyle='#000';
            this.ctx.lineWidth=3;
            this.ctx.font='bold 16px monospace';
            this.ctx.textAlign='center';

            // Draw outline
            this.ctx.strokeText(ft.text, screenX, screenY);
            // Draw text
            this.ctx.fillText(ft.text, screenX, screenY);

            this.ctx.restore();
        }
    }

    // Add a chat message
    addChatMessage(playerId, nickname, message, isMe) {
        this.chatMessages.push({
            playerId: playerId.substring(0, 8),
            nickname: nickname||playerId.substring(0, 8),
            message,
            isMe,
            timestamp: Date.now()
        });
        // Keep only last 10 messages
        if (this.chatMessages.length>10) {
            this.chatMessages.shift();
        }
    }

    // Draw chat messages in bottom middle
    drawChat() {
        const now=Date.now();
        // Filter out expired messages
        this.chatMessages=this.chatMessages.filter(m => now-m.timestamp<this.chatDisplayDuration);

        if (this.chatMessages.length===0) return;

        const ctx=this.ctx;
        const centerX=this.canvas.width/2;
        let y=this.canvas.height-180; // Above thrusters/bottom UI

        ctx.save();
        ctx.font='bold 14px monospace';
        ctx.textAlign='center';

        for (const msg of this.chatMessages) {
            const age=now-msg.timestamp;
            const fadeStart=this.chatDisplayDuration-2000;
            const alpha=age>fadeStart? 1-(age-fadeStart)/2000:1;

            ctx.globalAlpha=alpha;

            const text=`${msg.nickname}: ${msg.message}`;

            // Outline
            ctx.strokeStyle='#000';
            ctx.lineWidth=3;
            ctx.strokeText(text, centerX, y);

            ctx.fillStyle='#fff';
            ctx.fillText(text, centerX, y);

            y-=20; // Move up for next message
        }

        ctx.restore();
    }

    // Draw scrambled minimap when out of antenna range
    drawScrambledMinimap(mapX, mapY, mapWidth, mapHeight) {
        const ctx=this.ctx;
        const time=performance.now()/50;

        // Draw static noise
        for (let i=0; i<200; i++) {
            const x=mapX+Math.random()*mapWidth;
            const y=mapY+Math.random()*mapHeight;
            const brightness=Math.floor(Math.random()*100);
            ctx.fillStyle=`rgb(${brightness}, ${brightness}, ${brightness})`;
            ctx.fillRect(x, y, 2, 2);
        }

        // Draw scan lines
        ctx.fillStyle='rgba(0, 50, 0, 0.3)';
        for (let y=mapY; y<mapY+mapHeight; y+=4) {
            ctx.fillRect(mapX, y, mapWidth, 2);
        }

        // Flickering "NO SIGNAL" text
        if (Math.sin(time*0.5)>0) {
            ctx.fillStyle='#f44';
            ctx.font='bold 14px monospace';
            ctx.textAlign='center';
            ctx.fillText('NO SIGNAL', mapX+mapWidth/2, mapY+mapHeight/2-10);
            ctx.font='10px monospace';
            ctx.fillStyle='#f88';
            ctx.fillText('OUT OF RANGE', mapX+mapWidth/2, mapY+mapHeight/2+10);
            ctx.fillText('UPGRADE ANTENNA', mapX+mapWidth/2, mapY+mapHeight/2+25);
        }

        // Label
        ctx.fillStyle='#f44';
        ctx.font='10px monospace';
        ctx.textAlign='center';
        ctx.fillText('SIGNAL LOST', mapX+mapWidth/2, mapY-5);
    }

    // Spawn gas eruption particles
    spawnGasEruption(x, y) {
        // Spawn many green/yellow particles shooting upward
        for (let i=0; i<30; i++) {
            const angle=-Math.PI/2+(Math.random()-0.5)*1.5; // Mostly upward
            const speed=80+Math.random()*100;
            const vx=Math.cos(angle)*speed;
            const vy=Math.sin(angle)*speed;

            // Create a "gas" type particle
            const particle=new Particle(
                x+(Math.random()-0.5)*20,
                y+(Math.random()-0.5)*20,
                vx, vy, 'fire'
            );
            // Override color to green
            particle.gasColor=true;
            this.particles.push(particle);
        }
    }

    // Spawn falling debris
    spawnFallingDebris(x, y, tileType) {
        // Spawn debris particles that fall
        for (let i=0; i<8; i++) {
            const vx=(Math.random()-0.5)*40;
            const vy=Math.random()*20;

            this.particles.push(new Particle(
                x+(Math.random()-0.5)*16,
                y+(Math.random()-0.5)*16,
                vx, vy, 'debris'
            ));
        }
    }

    drawMessage() {
        if (!this.message||performance.now()>this.messageTime) {
            this.message=null;
            return;
        }

        const alpha=Math.min(1, (this.messageTime-performance.now())/1000);
        this.ctx.save();
        this.ctx.globalAlpha=alpha;
        this.ctx.fillStyle='#ff4444';
        this.ctx.font='bold 20px monospace';
        this.ctx.textAlign='center';
        this.ctx.fillText(this.message, this.canvas.width/2, this.canvas.height-50);
        this.ctx.restore();
    }

    drawDeathScreen(myPlayer, state) {
        if (!myPlayer||!myPlayer.dead) return;

        const centerX=this.canvas.width/2;
        const centerY=this.canvas.height/2;

        // Dark overlay
        this.ctx.fillStyle='rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Death title
        this.ctx.fillStyle='#ff4444';
        this.ctx.font='bold 48px monospace';
        this.ctx.textAlign='center';
        this.ctx.fillText('SHIP DESTROYED', centerX, centerY-100);

        // Calculate time since death
        const timeSinceDeath=myPlayer.deathTime? Math.floor((Date.now()-myPlayer.deathTime)/1000):0;

        this.ctx.fillStyle='#aaa';
        this.ctx.font='18px monospace';
        this.ctx.fillText(`Time since destruction: ${timeSinceDeath}s`, centerX, centerY-50);

        // Respawn options box
        const boxWidth=400;
        const boxHeight=200;
        const boxX=centerX-boxWidth/2;
        const boxY=centerY-20;

        this.ctx.fillStyle='rgba(30, 30, 50, 0.9)';
        this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
        this.ctx.strokeStyle='#666';
        this.ctx.lineWidth=2;
        this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

        // Resource info
        const spareParts=state.baseResources?.spareParts||0;
        const respawnCost=state.respawnCost||50;
        const canRespawn=spareParts>=respawnCost;
        const aliveCount=state.aliveCount||0;

        this.ctx.fillStyle='#fff';
        this.ctx.font='16px monospace';
        this.ctx.textAlign='left';

        const textX=boxX+20;
        let textY=boxY+35;

        this.ctx.fillText('RESPAWN OPTIONS:', textX, textY);
        textY+=35;

        // Option 1: Respawn at base
        this.ctx.fillStyle=canRespawn? '#4f4':'#f44';
        this.ctx.fillText(`[R] Respawn at Base`, textX, textY);
        textY+=25;

        this.ctx.fillStyle='#aaa';
        this.ctx.font='14px monospace';
        this.ctx.fillText(`    Cost: ${respawnCost} spare parts`, textX, textY);
        textY+=20;
        this.ctx.fillText(`    Available: ${Math.round(spareParts)} spare parts`, textX, textY);
        textY+=35;

        // Option 2: Wait for rescue
        this.ctx.font='16px monospace';
        this.ctx.fillStyle=aliveCount>0? '#4f4':'#888';
        this.ctx.fillText(`[WAIT] Wait for Rescue`, textX, textY);
        textY+=25;

        this.ctx.fillStyle='#aaa';
        this.ctx.font='14px monospace';
        if (aliveCount>0) {
            this.ctx.fillText(`    ${aliveCount} player${aliveCount>1? 's':''} still alive`, textX, textY);
        } else {
            this.ctx.fillText(`    No other players alive`, textX, textY);
        }

        // Instructions at bottom
        this.ctx.fillStyle='#666';
        this.ctx.font='12px monospace';
        this.ctx.textAlign='center';
        this.ctx.fillText('Press R to respawn (if resources available)', centerX, boxY+boxHeight-15);
    }
    // Draw all cables
    drawCables(cables, players, cameraX, cameraY) {
        if (!cables||cables.length===0) return;

        this.ctx.save();
        this.ctx.lineWidth=2;

        for (const cable of cables) {
            let x2=cable.x2;
            let y2=cable.y2;
            let isPreview=cable.isPreview;

            // If it's a preview cable (active drag), snap end to player's current visual position
            if (isPreview&&players) {
                const player=players.find(p => p.id===cable.playerId);
                if (player) {
                    x2=player.x;
                    y2=player.y;
                }
            }

            // Determine color
            let color='#ffffff';
            if (cable.type==='power'||cable.type==='cable_red') color='#ff3333'; // Red (Power)
            else if (cable.type==='fuel'||cable.type==='cable_green') color='#33cc33'; // Green (Fuel)
            else if (cable.type==='data'||cable.type==='cable_blue') color='#3333cc'; // Blue (Data)

            this.ctx.strokeStyle=color;
            this.ctx.beginPath();
            this.ctx.moveTo(cable.x1-cameraX, cable.y1-cameraY);

            // Simple Line
            this.ctx.lineTo(x2-cameraX, y2-cameraY);
            this.ctx.stroke();

            // Draw endpoints (anchors) or Spool
            if (cable.isSpool) {
                // Draw Spool Icon
                const sx=x2-cameraX;
                const sy=y2-cameraY;
                this.ctx.fillStyle=color;
                this.ctx.beginPath();
                this.ctx.arc(sx, sy, 5, 0, Math.PI*2);
                this.ctx.fill();
                this.ctx.strokeStyle='#fff';
                this.ctx.lineWidth=1;
                this.ctx.stroke();

                // Label
                this.ctx.fillStyle='#fff';
                this.ctx.font='8px monospace';
                this.ctx.fillText("SPOOL", sx-10, sy-8);
            } else {
                // Draw start anchor
                this.ctx.fillStyle='#555';
                this.ctx.fillRect(cable.x1-cameraX-2, cable.y1-cameraY-2, 4, 4);

                // Draw end anchor only if NOT a preview (active drag)
                if (!isPreview) {
                    this.ctx.fillRect(x2-cameraX-2, y2-cameraY-2, 4, 4);
                }
            }
        }

        this.ctx.restore();
    }

    // ============================================
    // NETWORK STATUS OVERLAY  (GDD 6.6)
    // ============================================
    // The building sprites are static, so every bit of network state is drawn
    // as an overlay on top of them. Nothing here is a click target -- the dots
    // are deliberately small and unlabelled so they read as status lights.
    networkColour(net) {
        if (net==='power') return '#ff4444';
        if (net==='fuel') return '#44dd55';
        if (net==='data') return '#4488ff';
        return '#ffffff';
    }

    // Port dots: one per network a building can use, drawn along its base.
    //   solid       = connected and supplied
    //   amber ring  = connected but starved / browning out / shed
    //   hollow red  = required, not connected
    //   absent      = building does not use that network
    drawNetworkStatus(state, cameraX, cameraY) {
        const net=state.networks;
        if (!net||!net.nodes) return;

        const t=Date.now()/1000;
        const pulse=0.55+0.45*Math.sin(t*4);

        this.ctx.save();
        for (const node of Object.values(net.nodes)) {
            const sx=node.x-cameraX;
            const sy=node.y-cameraY;
            // Cheap cull: skip anything comfortably off screen.
            if (sx<-80||sy<-80||sx>this.canvas.width+80||sy>this.canvas.height+80) continue;

            const ports=['power', 'fuel', 'data'].filter(k => node[k]&&node[k]!=='na');
            if (ports.length===0) continue;

            const spacing=9;
            const startX=sx-((ports.length-1)*spacing)/2;
            const py=sy+16;

            ports.forEach((key, i) => {
                const status=node[key];
                const px=startX+i*spacing;
                const colour=this.networkColour(key);

                this.ctx.beginPath();
                this.ctx.arc(px, py, 3.2, 0, Math.PI*2);

                if (status==='ok') {
                    this.ctx.fillStyle=colour;
                    this.ctx.fill();
                    // Soft halo so a healthy port reads at a glance.
                    this.ctx.strokeStyle=colour;
                    this.ctx.globalAlpha=0.35;
                    this.ctx.lineWidth=3;
                    this.ctx.stroke();
                    this.ctx.globalAlpha=1;
                } else if (status==='unconnected') {
                    this.ctx.strokeStyle='#ff4444';
                    this.ctx.lineWidth=1.4;
                    this.ctx.stroke();
                } else {
                    // starved / brownout / shed / blocked / isolated
                    this.ctx.globalAlpha=pulse;
                    this.ctx.fillStyle='#ffaa00';
                    this.ctx.fill();
                    this.ctx.globalAlpha=1;
                    this.ctx.strokeStyle='#ffaa00';
                    this.ctx.lineWidth=1.2;
                    this.ctx.stroke();
                }
            });

            // A shed building gets a clear word, not just a colour.
            if (node.power==='shed'||node.power==='unconnected'||node.fuel==='blocked') {
                const label=node.power==='shed'? 'NO POWER (SHED)'
                    :node.power==='unconnected'? 'NOT CONNECTED'
                        :'OUTPUT FULL';
                this.ctx.font='9px Consolas, monospace';
                this.ctx.textAlign='center';
                this.ctx.globalAlpha=0.85;
                this.ctx.fillStyle='#000';
                const w=this.ctx.measureText(label).width;
                this.ctx.fillRect(sx-w/2-3, py+6, w+6, 12);
                this.ctx.globalAlpha=1;
                this.ctx.fillStyle=node.power==='unconnected'? '#ff6666':'#ffaa00';
                this.ctx.fillText(label, sx, py+15);
                this.ctx.textAlign='left';
            }
        }
        this.ctx.restore();
    }

    // While a cable is held: dim the world toward that cable's colour and light
    // up only the ports it can legally attach to. Ports of the other two
    // networks are suppressed entirely, which is what teaches colour = purpose.
    drawCableTargeting(state, heldNet, player, cameraX, cameraY) {
        if (!heldNet) return;
        const net=state.networks;

        const tint={power: 'rgba(255,68,68,0.10)', fuel: 'rgba(68,221,85,0.10)', data: 'rgba(68,136,255,0.10)'}[heldNet];
        this.ctx.save();
        this.ctx.fillStyle='rgba(0,0,0,0.28)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle=tint;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const colour=this.networkColour(heldNet);
        const t=Date.now()/1000;
        const pulse=0.5+0.5*Math.sin(t*5);

        if (net&&net.nodes) {
            for (const node of Object.values(net.nodes)) {
                // A building is only a valid endpoint if it uses this network.
                if (!node[heldNet]||node[heldNet]==='na') continue;

                const sx=node.x-cameraX;
                const sy=node.y-cameraY;
                if (sx<-80||sy<-80||sx>this.canvas.width+80||sy>this.canvas.height+80) continue;

                // In range of the player = solid; out of range = faint.
                const inRange=player&&Math.hypot(node.x-player.x, node.y-player.y)<=CABLE_ATTACH_RANGE;

                this.ctx.globalAlpha=inRange? 0.4+0.6*pulse:0.25;
                this.ctx.strokeStyle=colour;
                this.ctx.lineWidth=inRange? 2.5:1.5;
                this.ctx.beginPath();
                this.ctx.arc(sx, sy, inRange? 26+pulse*4:22, 0, Math.PI*2);
                this.ctx.stroke();

                this.ctx.globalAlpha=1;
                this.ctx.fillStyle=colour;
                this.ctx.beginPath();
                this.ctx.arc(sx, sy+16, 4, 0, Math.PI*2);
                this.ctx.fill();

                if (inRange) {
                    this.ctx.font='9px Consolas, monospace';
                    this.ctx.textAlign='center';
                    this.ctx.fillStyle=colour;
                    this.ctx.fillText(node.name.toUpperCase(), sx, sy-30);
                    this.ctx.textAlign='left';
                }
            }
        }
        this.ctx.restore();
    }

    // Hold N: desaturate the world and draw the three graphs with their numbers.
    drawNetworkOverlay(state, cameraX, cameraY) {
        const net=state.networks;
        if (!net) return;

        this.ctx.save();
        this.ctx.fillStyle='rgba(0,0,0,0.55)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Antenna coverage circles, one tint per data net.
        (net.data||[]).forEach((dnet, i) => {
            const hue=(200+i*60)%360;
            for (const c of dnet.coverage) {
                this.ctx.beginPath();
                this.ctx.arc(c.x-cameraX, c.y-cameraY, c.r, 0, Math.PI*2);
                this.ctx.fillStyle=`hsla(${hue}, 80%, 55%, 0.07)`;
                this.ctx.fill();
                this.ctx.strokeStyle=`hsla(${hue}, 80%, 65%, 0.55)`;
                this.ctx.lineWidth=1.5;
                this.ctx.setLineDash([6, 6]);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
            }
        });

        // Per-building supply/draw readout.
        this.ctx.font='10px Consolas, monospace';
        this.ctx.textAlign='center';
        for (const node of Object.values(net.nodes||{})) {
            const sx=node.x-cameraX;
            const sy=node.y-cameraY;
            if (sx<-120||sy<-120||sx>this.canvas.width+120||sy>this.canvas.height+120) continue;

            const bits=[];
            if (node.gen>0) bits.push(`+${node.gen.toFixed(0)}kW`);
            if (node.draw>0) bits.push(`-${node.draw.toFixed(0)}kW`);
            const line=`${node.name}${bits.length? '  '+bits.join(' '):''}`;

            const w=this.ctx.measureText(line).width;
            this.ctx.fillStyle='rgba(0,0,0,0.75)';
            this.ctx.fillRect(sx-w/2-4, sy-46, w+8, 14);
            this.ctx.fillStyle=node.power==='ok'? '#8f8':(node.power==='unconnected'? '#f88':'#fa4');
            this.ctx.fillText(line, sx, sy-36);
        }
        this.ctx.textAlign='left';

        // Legend.
        const legend=[['Power Cable (Red)', '#ff4444'], ['Fuel Pipe (Green)', '#44dd55'], ['Data Cable (Blue)', '#4488ff']];
        this.ctx.font='11px Consolas, monospace';
        legend.forEach(([text, colour], i) => {
            const y=this.canvas.height-70+i*18;
            this.ctx.fillStyle=colour;
            this.ctx.fillRect(20, y-8, 18, 3);
            this.ctx.fillStyle='#ddd';
            this.ctx.fillText(text, 46, y-2);
        });

        this.ctx.restore();
    }

    // Draw placement preview
    drawCablePreview(data, cameraX, cameraY) {
        if (!data||!data.active) return;

        const {x1, y1, x2, y2, type, valid}=data;

        this.ctx.save();
        this.ctx.lineWidth=2;
        this.ctx.setLineDash([5, 5]);

        let color='#ffffff';
        if (type==='power'||type==='cable_red') color='#ff3333';
        else if (type==='fuel'||type==='cable_green') color='#33cc33';
        else if (type==='data'||type==='cable_blue') color='#3333cc';

        this.ctx.strokeStyle=valid? color:'#ff0000'; // Red if invalid

        this.ctx.beginPath();
        this.ctx.moveTo(x1-cameraX, y1-cameraY);
        this.ctx.lineTo(x2-cameraX, y2-cameraY);
        this.ctx.stroke();

        this.ctx.restore();
    }
}
