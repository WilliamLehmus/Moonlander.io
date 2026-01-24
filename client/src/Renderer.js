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
        return null;
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

        // Particles
        this.particles=[];

        // Track previous damage for collision effects
        this.previousDamage=new Map();

        // Temporary message display
        this.message=null;
        this.messageTime=0;
        this.lastTime=performance.now();

        // Lighting configuration
        this.surfaceY=0; // Will be set from map data (where full light starts)
        this.fullDarkDepth=300; // Tiles deep where it's completely dark
        this.spotlightRange=250; // How far the spotlight reaches
        this.spotlightAngle=Math.PI/6; // 30 degree cone
        this.positionLightRadius=40; // Small lights on the lander
        this.spotlightDepthPenetration=2; // Reduced from 3 to 2 to match new visual style (Outer + 1 inner)
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
    }

    updateTile(x, y, value) {
        if (this.voxelMap&&y>=0&&y<this.mapHeight&&x>=0&&x<this.mapWidth) {
            this.voxelMap[y][x]=value;
        }
    }

    spawnThrustParticles(player) {
        const {x, y, angle, thrusting}=player;
        if (!thrusting) return;

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
        return darkness*0.95; // Max 95% darkness to keep some ambient
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
                this.drawPositionLights(lCtx, screenX, screenY, player.angle, finalIntensity);

                // Spotlight (follows mouse for local player, uses stored angle for others)
                this.drawSpotlight(lCtx, screenX, screenY, player.spotlightAngle||0, finalIntensity, player.id===myId);
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
        if (!this.voxelMap) return;

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
                            if (tile>=TileTypes.IRON_ORE&&solidTilesHit<=penetration) {
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

        // Clear background with moon sky color
        this.ctx.fillStyle='#0a0a14';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();

        // Apply camera transform
        this.ctx.translate(-this.cameraX, -this.cameraY);

        // Draw voxel terrain
        this.drawVoxelTerrain();

        // Draw moon base structure
        this.drawMoonBase();

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
        this.drawLighting(state.players, myId, this.cameraX, this.cameraY);
        this.ctx.drawImage(this.lightCanvas, 0, 0);

        // Draw ore glow effects on top of darkness (ores glow faintly in the dark)
        this.drawOreGlow(state.players, myId);

        // Draw HUD (not affected by camera or lighting)
        this.drawHUD(myPlayer, state);

        // Draw minimap
        this.drawMinimap(myPlayer, state);

        // Draw controls help (bottom left)
        this.drawControlsHelp();

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
            // Metal ores
            IRON_ORE: 10,
            TITANIUM_ORE: 11,
            COPPER_ORE: 12,
            GOLD_ORE: 13,
            PLATINUM_ORE: 14,
            HELIUM3_DEPOSIT: 15
        };

        const tileColors={
            [TileTypes.GROUND]: {main: '#8b7a6b', border: '#5d4e42'},
            [TileTypes.REGOLITH]: {main: '#d1c4b9', border: '#a89a8e'},
            [TileTypes.ROCK]: {main: '#7d6b5d', border: '#4d3d32'},
            [TileTypes.HARD_ROCK]: {main: '#4d4d5d', border: '#333344'},
            [TileTypes.PAD]: {main: '#6a8bba', border: '#4a6b8a'},
            [TileTypes.BASE]: {main: '#c0c0c0', border: '#666666'},
            // Ore colors - distinct and visible
            [TileTypes.IRON_ORE]: {main: '#8b4513', border: '#5c2e0e', glow: '#cd853f'},      // Rusty brown
            [TileTypes.COPPER_ORE]: {main: '#b87333', border: '#8b4513', glow: '#daa520'},    // Copper orange
            [TileTypes.TITANIUM_ORE]: {main: '#708090', border: '#4a5568', glow: '#b0c4de'},  // Silvery blue
            [TileTypes.GOLD_ORE]: {main: '#ffd700', border: '#b8860b', glow: '#ffec8b'},      // Gold
            [TileTypes.PLATINUM_ORE]: {main: '#e5e4e2', border: '#a9a9a9', glow: '#ffffff'},  // Platinum white
            [TileTypes.HELIUM3_DEPOSIT]: {main: '#00ced1', border: '#008b8b', glow: '#7fffd4'} // Cyan/teal
        };

        for (let y=startY; y<endY; y++) {
            for (let x=startX; x<endX; x++) {
                const tile=this.voxelMap[y][x];
                if (tile===TileTypes.EMPTY) continue;

                // Skip BASE tiles - they'll be covered by sprite
                if (tile===TileTypes.BASE) continue;

                const colors=tileColors[tile]||tileColors[TileTypes.GROUND];
                const wx=x*this.tileSize;
                const wy=y*this.tileSize;

                this.ctx.fillStyle=colors.main;
                this.ctx.fillRect(wx, wy, this.tileSize, this.tileSize);

                // Skip PAD tiles too - landing platform sprite will cover them
                if (tile===TileTypes.PAD) continue;

                // Add glow effect for ore tiles
                if (tile>=TileTypes.IRON_ORE&&colors.glow) {
                    this.ctx.fillStyle=colors.glow;
                    this.ctx.globalAlpha=0.3+Math.sin(performance.now()/500+x+y)*0.15;
                    this.ctx.fillRect(wx+2, wy+2, this.tileSize-4, this.tileSize-4);
                    this.ctx.globalAlpha=1;
                }

                this.ctx.strokeStyle=colors.border;
                this.ctx.lineWidth=0.5;
                this.ctx.strokeRect(wx, wy, this.tileSize, this.tileSize);
            }
        }
    }

    drawMoonBase() {
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
                padY-padHeight+70, // Position so bottom aligns with ground (+60 offset to fix hovering)
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
        const {x, y, angle, color, thrusting, dead, damage=0}=player;

        if (dead) return;

        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(angle);

        if (this.spriteLoaded) {
            // Draw sprite from sprite sheet
            // 4x3 grid, damage level 0-11
            const damageLevel=Math.min(11, Math.max(0, Math.floor(damage)));
            const frameX=damageLevel%4;
            const frameY=Math.floor(damageLevel/4);

            const srcX=frameX*this.spriteFrameWidth;
            const srcY=frameY*this.spriteFrameHeight;

            // Draw sprite centered
            const drawWidth=40;
            const drawHeight=40*(this.spriteFrameHeight/this.spriteFrameWidth);

            this.ctx.drawImage(
                this.landerSprite,
                srcX, srcY,
                this.spriteFrameWidth, this.spriteFrameHeight,
                -drawWidth/2, -drawHeight/2,
                drawWidth, drawHeight
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

    drawControlsHelp() {
        const helpX=20;
        const helpY=this.canvas.height-200;

        this.ctx.fillStyle='rgba(0, 0, 0, 0.6)';
        this.ctx.fillRect(helpX-5, helpY-20, 200, 195);

        this.ctx.fillStyle='#aaa';
        this.ctx.font='bold 12px monospace';
        this.ctx.textAlign='left';
        this.ctx.fillText('CONTROLS', helpX, helpY-5);

        this.ctx.fillStyle='#888';
        this.ctx.font='11px monospace';

        const controls=[
            ['W / UP', 'Thrust'],
            ['A / D', 'Rotate left/right'],
            ['SPACE', 'Mine ore (hold)'],
            ['E', 'Attach/detach tether'],
            ['F', 'Transfer fuel (docked)'],
            ['J', 'Jettison 25% cargo'],
            ['1', 'Ping: Check this out'],
            ['2', 'Ping: Danger/Help!'],
            ['3', 'Ping: Resources here'],
            ['4', 'Ping: Regroup here'],
            ['R', 'Respawn (when dead)'],
            ['Mouse', 'Aim spotlight']
        ];

        controls.forEach((ctrl, i) => {
            const [key, desc]=ctrl;

            // Draw shortcut key
            this.ctx.fillStyle='#6af';
            this.ctx.font='bold 12px monospace';
            this.ctx.shadowColor='#00aaff';
            this.ctx.shadowBlur=4;
            this.ctx.fillText(key.padEnd(8), helpX, helpY+12+i*15);

            // Draw description
            this.ctx.shadowBlur=0;
            this.ctx.fillStyle='#bbb';
            this.ctx.font='12px monospace';
            this.ctx.fillText(desc, helpX+75, helpY+12+i*15);
        });
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

        // Draw background
        this.ctx.fillStyle='rgba(0, 0, 30, 0.8)';
        this.ctx.fillRect(mapX, mapY, mapWidth, mapHeight);
        this.ctx.strokeStyle='#446';
        this.ctx.lineWidth=2;
        this.ctx.strokeRect(mapX, mapY, mapWidth, mapHeight);

        // Draw terrain (very simplified - just sample points)
        this.ctx.fillStyle='#444';
        const sampleStep=8; // Sample every N tiles
        for (let gy=0; gy<this.mapHeight; gy+=sampleStep) {
            for (let gx=0; gx<this.mapWidth; gx+=sampleStep) {
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
                        this.ctx.fillStyle='#444'; // Rock
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
            if (player.id===myPlayer.id) {
                this.ctx.fillStyle='#0f0'; // Self is green
            } else {
                this.ctx.fillStyle='#0af'; // Teammates are cyan
            }
            this.ctx.beginPath();
            this.ctx.arc(px, py, 3, 0, Math.PI*2);
            this.ctx.fill();

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

        const barX=20;
        const barY=20;
        const barWidth=200;
        const barHeight=20;

        // Fuel bar
        const fuelPercent=Math.max(0, myPlayer.fuel/1000);
        this.ctx.fillStyle='#333';
        this.ctx.fillRect(barX, barY, barWidth, barHeight);
        this.ctx.fillStyle=fuelPercent>0.3? '#4a4':'#a44';
        this.ctx.fillRect(barX, barY, barWidth*fuelPercent, barHeight);
        this.ctx.strokeStyle='#fff';
        this.ctx.lineWidth=2;
        this.ctx.strokeRect(barX, barY, barWidth, barHeight);
        this.ctx.fillStyle='#fff';
        this.ctx.fillText(`FUEL: ${Math.floor(myPlayer.fuel)}`, barX, barY+barHeight+20);

        // Damage bar
        const damage=myPlayer.damage||0;
        const damagePercent=Math.min(1, damage/11);
        this.ctx.fillStyle='#333';
        this.ctx.fillRect(barX, barY+50, barWidth, barHeight);
        this.ctx.fillStyle=damagePercent<0.5? '#4a4':damagePercent<0.8? '#aa4':'#a44';
        this.ctx.fillRect(barX, barY+50, barWidth*damagePercent, barHeight);
        this.ctx.strokeStyle='#fff';
        this.ctx.strokeRect(barX, barY+50, barWidth, barHeight);
        this.ctx.fillStyle='#fff';
        this.ctx.fillText(`DAMAGE: ${Math.floor(damage)}/11`, barX, barY+barHeight+70);

        // Velocity
        const speed=Math.sqrt(myPlayer.vx*myPlayer.vx+myPlayer.vy*myPlayer.vy);
        this.ctx.fillText(`SPEED: ${speed.toFixed(1)}`, barX, barY+barHeight+95);

        // Depth indicator
        const surfaceY=this.surfaceY||0;
        const depth=Math.max(0, myPlayer.y-surfaceY);
        const depthMeters=Math.floor(depth/8); // 8 pixels per meter
        this.ctx.fillText(`DEPTH: ${depthMeters}m`, barX+120, barY+barHeight+95);

        // Cargo bar
        const cargoAmount=myPlayer.cargoAmount||0;
        const cargoCapacity=myPlayer.cargoCapacity||500;
        const cargoPercent=cargoAmount/cargoCapacity;
        this.ctx.fillStyle='#333';
        this.ctx.fillRect(barX, barY+120, barWidth, barHeight);
        this.ctx.fillStyle=cargoPercent<0.8? '#44a':'#a4a';
        this.ctx.fillRect(barX, barY+120, barWidth*cargoPercent, barHeight);
        this.ctx.strokeStyle='#fff';
        this.ctx.strokeRect(barX, barY+120, barWidth, barHeight);
        this.ctx.fillStyle='#fff';
        this.ctx.fillText(`CARGO: ${Math.floor(cargoAmount)}/${cargoCapacity}`, barX, barY+barHeight+140);

        // Mass/Weight info
        const totalMass=1.0+(cargoAmount*0.002);
        this.ctx.fillStyle='#aaa';
        this.ctx.font='12px monospace';
        this.ctx.fillText(`TOTAL MASS: ${totalMass.toFixed(2)}t`, barX, barY+barHeight+155);

        // Mining progress indicator
        if (myPlayer.mining&&myPlayer.miningProgress>0) {
            const miningY=barY+170;
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
            this.ctx.fillText(statusText, this.canvas.width/2, 30);
        }

        // Docking indicator
        if (myPlayer.dockingTarget) {
            this.ctx.textAlign='center';
            if (myPlayer.isDocked) {
                this.ctx.fillStyle=myPlayer.fuelTransferring? '#0ff':'#0f0';
                const dockText=myPlayer.fuelTransferring? 'TRANSFERRING FUEL [F]':'DOCKED - PRESS [F] TO TRANSFER FUEL';
                this.ctx.font='bold 16px monospace';
                this.ctx.fillText(dockText, this.canvas.width/2, 55);
            } else {
                this.ctx.fillStyle='#ff0';
                this.ctx.font='14px monospace';
                this.ctx.fillText('MATCH VELOCITY TO DOCK', this.canvas.width/2, 55);
            }
        }

        // Base resources (top right)
        const spareParts=state?.baseResources?.spareParts||0;
        const baseFuel=state?.baseResources?.fuel||0;
        this.ctx.textAlign='right';
        this.ctx.fillStyle='#aaa';
        this.ctx.font='14px monospace';
        this.ctx.fillText(`BASE FUEL: ${Math.floor(baseFuel)}`, this.canvas.width-20, 30);
        this.ctx.fillText(`BASE SPARE PARTS: ${Math.floor(spareParts)}`, this.canvas.width-20, 50);

        // Player count
        const aliveCount=state?.aliveCount||0;
        const totalCount=state?.players?.length||0;
        this.ctx.fillText(`PLAYERS: ${aliveCount}/${totalCount} alive`, this.canvas.width-20, 70);
    }

    showMessage(text, duration=3000) {
        this.message=text;
        this.messageTime=performance.now()+duration;
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
        this.ctx.fillText(`    Available: ${spareParts} spare parts`, textX, textY);
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
}
