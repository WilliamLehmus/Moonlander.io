
import Ammo from 'ammo.js';

const SHIP_TYPES={
    scout: {
        name: 'Scout',
        width: 20, height: 28, mass: 1,
        maxFuel: 500, fuelConsumption: 15,
        cargoCapacity: 3, // Now slots
        thrustForce: 80,
        maxPower: 100,
        basePowerRegen: 2.0
    },
    cargo: {
        name: 'Cargo Hauler',
        width: 30, height: 30, mass: 2.5,
        maxFuel: 1000, fuelConsumption: 25,
        cargoCapacity: 6, // 2x3 grid
        thrustForce: 150,
        maxPower: 150,
        basePowerRegen: 2.0
    },
    eva: {
        name: 'Astronaut',
        width: 6, height: 12, mass: 0.1,
        maxFuel: 0, fuelConsumption: 0,
        cargoCapacity: 1, // 1 slot
        thrustForce: 15,
        maxPower: 20,
        maxOxygen: 100,
        oxygenConsumption: 1.5,
        basePowerRegen: 1.0
    }
};

export class Player {
    constructor(id, physicsWorld, spawnX=400, spawnY=100, config, nickname='Explorer') {
        this.id=id;
        this.nickname=nickname;
        this.physicsWorld=physicsWorld;
        this.config=config||{};

        this.shipType='scout';

        // Upgrades (0-3 levels)
        this.upgrades={
            power: 0,
            thrust: 0,
            fuel: 0,
            laser: 0,
            spotlight: 0
        };

        const stats=SHIP_TYPES[this.shipType];

        // Create RigidBody
        this.body=this.physicsWorld.createBox(spawnX, spawnY, stats.width, stats.height, stats.mass);
        this.body.setActivationState(4);

        const diff=this.config.difficulty||{};

        // Fuel system
        this.fuel=stats.maxFuel;
        this.maxFuel=stats.maxFuel;
        this.fuelConsumption=stats.fuelConsumption*(diff.fuelConsumptionMultiplier||1);

        // Power system
        this.power=stats.maxPower;
        this.maxPower=stats.maxPower;
        this.basePowerRegen=stats.basePowerRegen;
        this.powerRegen=this.basePowerRegen*(diff.powerGenerationMultiplier||1);

        this.lightsOn=true;
        this.spotlightOn=true;
        this.antennaOn=false;

        this.lightPowerDrain=0.5*(diff.powerConsumptionMultiplier||1);
        this.spotlightPowerDrain=1.0*(diff.powerConsumptionMultiplier||1);
        this.antennaPowerDrain=0.5*(diff.powerConsumptionMultiplier||1);
        this.miningPowerDrain=7.5*(diff.powerConsumptionMultiplier||1);

        // Oxygen system (EVA)
        this.oxygen=100;
        this.maxOxygen=100;
        this.oxygenConsumption=0;

        this.damage=0;
        this.inputs={thrust: false, left: false, right: false, mining: false, transferFuel: false, transferCargo: false, interact: false, toggleAntenna: false, toggleSpotlight: false, toggleLights: false};
        this.lastInteract=false;
        this.color=`hsl(${Math.random()*360}, 70%, 50%)`;
        this.dead=false;
        this.landed=false;
        this.onPad=false;
        // Within reach of any built structure, not just a landing pad. Gates
        // opening the station menu; pad-only services still check onPad.
        this.nearBuilding=false;
        this.nearBuildingId=null;
        this.deathTime=null;
        this.spawnX=spawnX;
        this.spawnY=spawnY;

        this.thrustForce=stats.thrustForce;
        this.spotlightAngle=0;

        // Mining system
        this.mining=false;
        this.miningTarget=null;
        this.miningProgress=0;
        this.miningRange=this.config.mining?.range||80;

        // Cargo system
        this.cargo=[];
        this.cargoCapacity=stats.cargoCapacity;
        this.cargoWeight=0;

        this.activePing=null;
        this.dockingTarget=null;
        this.isDocked=false;
        this.fuelTransferring=false;
        this.fuelTransferred=0;

        // Tether system
        this.tetheredTo=null;
        this.tetherLength=0;
        this.maxTetherLength=this.config.difficulty?.tetherMaxLength||150;
        this.tetherTension=0;
        this.tetherBroken=false;

        // Survival pod
        this.inPod=false;
        this.podLifeSupport=60;
        this.podX=0;
        this.podY=0;

        // Debug options
        this.infiniteFuel=false;
        this.podVX=0;
        this.podVY=0;
        this.beaconPulse=0;

        this.isMiningResource=false;
        this.transferring=false;

        this.tmpTrans=new this.physicsWorld.ammo.btTransform();
        this.wasThrusting=false;

        // Initial stat calculation
        this.applyUpgrades();
    }

    destroy() {
        if (this.body) {
            this.physicsWorld.world.removeRigidBody(this.body);
            // clean up ammo objects if needed
        }
    }

    setInput(input) {
        this.inputs=input;
        // Update spotlight angle if provided
        if (typeof input.spotlightAngle==='number') {
            this.spotlightAngle=input.spotlightAngle;
        }
        // Update mining state
        this.mining=input.mining||false;

        // Toggle handling (on server to play sounds or update state)
        if (input.toggleAntenna&&!this.lastAntennaInput) {
            this.antennaOn=!this.antennaOn;
            if (this.antennaOn&&this.power<=0) this.antennaOn=false;
        }
        this.lastAntennaInput=!!input.toggleAntenna;

        if (input.toggleSpotlight&&!this.lastSpotlightInput) {
            this.spotlightOn=!this.spotlightOn;
            if (this.spotlightOn&&this.power<=0) this.spotlightOn=false;
        }
        this.lastSpotlightInput=!!input.toggleSpotlight;

        if (input.toggleLights&&!this.lastLightsInput) {
            this.lightsOn=!this.lightsOn;
            if (this.lightsOn&&this.power<=0) this.lightsOn=false;
        }
        this.lastLightsInput=!!input.toggleLights;

        // Track exit/enter vehicle inputs for edge detection
        this.lastExitVehicle=!!input.exitVehicle;
        this.lastEnterVehicle=!!input.enterVehicle;
    }

    // Get total cargo weight
    getCargoWeight() {
        // 0.002 mass per unit = full cargo (500) adds 1.0 mass (2.0 total weight)
        // This makes full cargo sluggish but still very flyable
        return this.cargo.reduce((sum, item) => sum+item.amount*0.002, 0);
    }

    // Get total cargo amount
    getCargoAmount() {
        return this.cargo.length; // Now counting entries/slots
    }

    // Add cargo if space available (Stacking up to 50 per slot)
    addCargo(type, amount) {
        if (amount<=0) return 0;
        const STACK_SIZE=50;

        let remainingToAdd=amount;
        let totalAdded=0;

        // 1. First, fill up existing stacks of the same type
        const existingStacks=this.cargo.filter(c => c.type===type&&c.amount<STACK_SIZE);
        for (const stack of existingStacks) {
            const spaceInStack=STACK_SIZE-stack.amount;
            const toAdd=Math.min(remainingToAdd, spaceInStack);
            stack.amount+=toAdd;
            remainingToAdd-=toAdd;
            totalAdded+=toAdd;
            if (remainingToAdd<=0) break;
        }

        // 2. If still have ore, try to open new slots
        while (remainingToAdd>0&&this.cargo.length<this.cargoCapacity) {
            const toAdd=Math.min(remainingToAdd, STACK_SIZE);
            this.cargo.push({type, amount: toAdd});
            remainingToAdd-=toAdd;
            totalAdded+=toAdd;
        }

        // Update physics mass if we added anything
        if (totalAdded>0) {
            this.updateMass();
        }

        return totalAdded;
    }

    // Update physics body mass based on cargo
    updateMass() {
        const stats=SHIP_TYPES[this.shipType]||SHIP_TYPES.scout;
        const baseMass=stats.mass;
        const cargoMass=this.getCargoWeight();
        const totalMass=baseMass+cargoMass;

        // Ammo.js mass update requires recreating inertia
        const ammo=this.physicsWorld.ammo;
        const shape=this.body.getCollisionShape();
        const localInertia=new ammo.btVector3(0, 0, 0);
        shape.calculateLocalInertia(totalMass, localInertia);
        this.body.setMassProps(totalMass, localInertia);
        this.body.updateInertiaTensor();
    }

    // Jettison cargo (drop percentage of cargo)
    jettisonCargo(percentage=0.25) {
        if (this.cargo.length===0) return 0;

        let totalDropped=0;
        for (const cargoItem of this.cargo) {
            const dropAmount=Math.ceil(cargoItem.amount*percentage);
            cargoItem.amount-=dropAmount;
            totalDropped+=dropAmount;
        }

        // Remove empty cargo entries
        this.cargo=this.cargo.filter(c => c.amount>0);

        // Update mass
        this.updateMass();

        return totalDropped;
    }

    takeDamage(amount) {
        this.damage=Math.min(11, this.damage+amount);
        if (this.damage>=11&&!this.dead) {
            this.dead=true;
            this.deathTime=Date.now();

            // Get position and velocity for pod ejection
            const pos=this.getPosition();
            const vel=this.getVelocity();

            // Eject survival pod
            this.inPod=true;
            this.podLifeSupport=60; // 60 seconds
            this.podX=pos.x;
            this.podY=pos.y;
            // Pod ejects upward with some random spread
            this.podVX=vel.vx*0.3+(Math.random()-0.5)*20;
            this.podVY=vel.vy*0.3-30-Math.random()*20; // Eject upward

            // Stop the body from moving
            const ammo=this.physicsWorld.ammo;
            this.body.setLinearVelocity(new ammo.btVector3(0, 0, 0));
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0));
        }
    }

    respawn(spawnX, spawnY) {
        if (!this.dead) return false;

        const ammo=this.physicsWorld.ammo;

        // Reset position
        const transform=new ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new ammo.btVector3(spawnX, spawnY, 0));
        this.body.setWorldTransform(transform);
        this.body.getMotionState().setWorldTransform(transform);

        // Reset velocity
        this.body.setLinearVelocity(new ammo.btVector3(0, 0, 0));
        this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0));

        // Reset state
        this.dead=false;
        this.deathTime=null;
        this.damage=0;
        this.fuel=this.maxFuel;
        this.power=this.maxPower;
        this.oxygen=this.maxOxygen||100;
        this.lightsOn=true;
        this.spotlightOn=true;
        this.antennaOn=false;
        this.landed=false;
        this.spawnX=spawnX;
        this.spawnY=spawnY;

        // If player was EVA, respawn as scout (user requested basic moonlander)
        if (this.shipType==='eva') {
            this.setShipType('scout');
        }

        return true;
    }

    update(dt) {
        if (this.dead||!this.body) return;

        const stats=SHIP_TYPES[this.shipType]||SHIP_TYPES.scout;
        this.thrustForce=stats.thrustForce; // Ensure this is always up-to-date

        const ammo=this.physicsWorld.ammo;

        // Power regeneration (solar panels, faster when on surface/pad)
        // Power generation decreases with the moonlander's damage taken.
        const damageFactor=Math.max(0, 1-(this.damage/12));
        const effectiveRegen=this.powerRegen*damageFactor;
        const regenRate=this.onPad? effectiveRegen*3:effectiveRegen;
        this.power=Math.min(this.maxPower, this.power+regenRate*dt);

        // Power consumption for systems
        let totalDrain=0;
        if (this.lightsOn) totalDrain+=this.lightPowerDrain;
        if (this.spotlightOn) totalDrain+=this.spotlightPowerDrain;
        if (this.antennaOn) totalDrain+=this.antennaPowerDrain;

        if (this.power>0) {
            this.power-=totalDrain*dt;
            if (this.power<=0) {
                this.power=0;
                // Auto-off systems when power is depleted (except for EVA oxygen which is separate)
                this.lightsOn=false;
                this.spotlightOn=false;
                this.antennaOn=false;
            }
        } else {
            // Already out of power
            this.lightsOn=false;
            this.spotlightOn=false;
            this.antennaOn=false;
        }

        // EVA Movement (Walking/Jetpack) vs Ship Movement
        if (this.shipType==='eva') {
            // EVA mode: left/right MOVE the character (no rotation)
            this.body.setDamping(0.05, 0.0); // Match ship linear damping, zero angular
            this.body.setAngularFactor(new ammo.btVector3(0, 0, 0)); // No rotation for stick figure
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0)); // Stop any rotation

            const WALK_FORCE=50; // Increased for better responsiveness
            const JUMP_FORCE=150;

            // Left/right MOVES the character horizontally
            if (this.inputs.left) {
                this.body.applyCentralForce(new ammo.btVector3(-WALK_FORCE, 0, 0));
            }
            if (this.inputs.right) {
                this.body.applyCentralForce(new ammo.btVector3(WALK_FORCE, 0, 0));
            }

            // Up/thrust makes character jump with a force (Jump instead of jetpack)
            const vel=this.getVelocity();
            const isGrounded=Math.abs(vel.vy)<0.5;

            // Only jump if grounded and pressing thrust (not holding)
            if (this.inputs.thrust&&!this.wasThrusting&&isGrounded) {
                const JUMP_IMPULSE=15; // Impulse for immediate jump
                this.body.applyCentralImpulse(new ammo.btVector3(0, -JUMP_IMPULSE, 0));
            }
            this.wasThrusting=this.inputs.thrust;

            // Oxygen consumption
            this.oxygen=Math.max(0, this.oxygen-this.oxygenConsumption*dt);
            if (this.oxygen<=0&&!this.dead) {
                this.takeDamage(0.5*dt); // Suffocation damage
            }
        } else {
            // Ship mode: Rotation (positive Z = CCW in physics, but we want visual CW for right)
            if (this.inputs.left) {
                this.body.setAngularVelocity(new ammo.btVector3(0, 0, 3));
            } else if (this.inputs.right) {
                this.body.setAngularVelocity(new ammo.btVector3(0, 0, -3));
            } else {
                this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0));
            }
            // Ship Movement
            this.body.setDamping(0.05, 0.05); // Basic space damping
            this.body.setAngularFactor(new ammo.btVector3(0, 0, 1)); // Allow Z rotation

            if (this.inputs.thrust&&this.fuel>0) {
                // If fuel is 0, cannot move (already checked above, but let's be explicit)
                const angle=-this.getRotation(); // Negate to match visual rotation
                // Sprite points UP at angle=0, so adjust by -PI/2 for thrust direction
                const thrustAngle=angle-Math.PI/2;
                const forceX=Math.cos(thrustAngle)*this.thrustForce;
                const forceY=Math.sin(thrustAngle)*this.thrustForce;

                this.body.applyCentralForce(new ammo.btVector3(forceX, forceY, 0));
                if (!this.infiniteFuel) {
                    this.fuel-=this.fuelConsumption*dt;
                    if (this.fuel<0) this.fuel=0;
                }
            } else if (this.inputs.thrust&&this.fuel<=0) {
                // Out of fuel message or effect could be added here
            }
        }
    }

    // Check if mining can proceed (requires power)
    canMine() {
        return this.power>=this.miningPowerDrain*0.1; // Need at least some power
    }

    // Consume power for mining
    consumeMiningPower(dt) {
        if (this.power>0) {
            this.power-=this.miningPowerDrain*dt;
            if (this.power<0) this.power=0;
            return true;
        }
        return false;
    }

    // Toggle systems
    toggleLights() {
        if (this.power>0||!this.lightsOn) {
            this.lightsOn=!this.lightsOn;
        }
    }

    toggleSpotlight() {
        if (this.power>0||!this.spotlightOn) {
            this.spotlightOn=!this.spotlightOn;
        }
    }

    toggleAntenna() {
        if (this.power>0||!this.antennaOn) {
            this.antennaOn=!this.antennaOn;
        }
    }

    getRotation() {
        this.body.getMotionState().getWorldTransform(this.tmpTrans);
        const rot=this.tmpTrans.getRotation(); // btQuaternion

        // Quat to Euler Z
        const z=rot.z();
        const w=rot.w();
        return 2*Math.atan2(z, w);
    }

    getPosition() {
        this.body.getMotionState().getWorldTransform(this.tmpTrans);
        const origin=this.tmpTrans.getOrigin();
        return {x: origin.x(), y: origin.y()};
    }

    getVelocity() {
        const vel=this.body.getLinearVelocity();
        return {vx: vel.x(), vy: vel.y()};
    }

    // Debug helper: set position
    setPosition(x, y) {
        const ammo=this.physicsWorld.ammo;
        const transform=new ammo.btTransform();
        this.body.getMotionState().getWorldTransform(transform);
        transform.setOrigin(new ammo.btVector3(x, y, 0));
        this.body.setWorldTransform(transform);
        this.body.getMotionState().setWorldTransform(transform);
        this.body.activate();
    }

    // Debug helper: set velocity
    setVelocity(vx, vy) {
        const ammo=this.physicsWorld.ammo;
        this.body.setLinearVelocity(new ammo.btVector3(vx, vy, 0));
        this.body.activate();
    }

    serialize() {
        const pos=this.getPosition();
        const vel=this.getVelocity();

        return {
            id: this.id,
            nickname: this.nickname,
            shipType: this.shipType,
            x: pos.x,
            y: pos.y,
            vx: vel.vx,
            vy: vel.vy,
            angle: -this.getRotation(), // Negate to match canvas rotation direction
            fuel: this.fuel,
            maxFuel: this.maxFuel,
            damage: this.damage,
            thrusting: this.inputs.thrust,
            // Physics collider size. The client draws the sprite larger than the
            // collider, so it needs these to sit the ship's feet on the ground
            // instead of sinking them into it.
            colliderW: (SHIP_TYPES[this.shipType]||SHIP_TYPES.scout).width,
            colliderH: (SHIP_TYPES[this.shipType]||SHIP_TYPES.scout).height,
            thrustForce: this.thrustForce, // Added for EVA
            color: this.color,
            dead: this.dead,
            landed: this.landed,
            onPad: this.onPad,
            nearBuilding: this.nearBuilding,
            deathTime: this.deathTime,
            spotlightAngle: this.spotlightAngle,
            // Power system
            power: this.power,
            maxPower: this.maxPower,
            lightsOn: this.lightsOn,
            spotlightOn: this.spotlightOn,
            antennaOn: this.antennaOn,
            upgrades: this.upgrades,
            // Oxygen system
            oxygen: this.oxygen,
            maxOxygen: this.maxOxygen,
            // Mining and cargo
            mining: this.mining,
            miningTarget: this.miningTarget,
            miningProgress: this.miningProgress,
            cargo: this.cargo,
            cargoCapacity: this.cargoCapacity,
            cargoAmount: this.getCargoAmount(),
            // Ping
            activePing: this.activePing,
            // Docking
            dockingTarget: this.dockingTarget,
            isDocked: this.isDocked,
            fuelTransferring: this.fuelTransferring,
            // Tether
            tetheredTo: this.tetheredTo,
            tetherLength: this.tetherLength,
            tetherTension: this.tetherTension,
            // Survival pod
            inPod: this.inPod,
            podLifeSupport: this.podLifeSupport,
            podX: this.podX,
            podY: this.podY,
            beaconPulse: this.beaconPulse,
            isMiningResource: this.isMiningResource,
            transferring: this.transferring
        };
    }

    // Set a ping at current position
    setPing(type) {
        const pos=this.getPosition();
        this.activePing={
            type,
            x: pos.x,
            y: pos.y,
            timestamp: Date.now()
        };
    }

    // Clear ping after duration
    updatePing(pingDuration=5000) {
        if (this.activePing&&Date.now()-this.activePing.timestamp>pingDuration) {
            this.activePing=null;
        }
    }

    // Update survival pod physics
    updatePod(dt, gravity=10) {
        if (!this.inPod) return false;

        // Apply gravity to pod
        this.podVY+=gravity*dt;

        // Apply weak thrust if player inputs
        if (this.inputs.thrust&&this.podLifeSupport>0) {
            this.podVY-=15*dt; // Very weak upward thrust
        }

        // Move pod
        this.podX+=this.podVX*dt;
        this.podY+=this.podVY*dt;

        // Drain life support
        this.podLifeSupport-=dt;
        if (this.podLifeSupport<=0) {
            this.inPod=false;
            return true; // Pod expired
        }

        // Update beacon pulse
        this.beaconPulse=(this.beaconPulse+dt*3)%(Math.PI*2);

        return false;
    }

    // Check if another player rescues this pod
    checkRescue(rescuerPos, rescueRange=40) {
        if (!this.inPod) return false;

        const dx=rescuerPos.x-this.podX;
        const dy=rescuerPos.y-this.podY;
        const dist=Math.sqrt(dx*dx+dy*dy);

        return dist<=rescueRange;
    }

    // Perform rescue - respawn with partial resources
    performRescue(spawnX, spawnY) {
        if (!this.inPod) return false;

        this.inPod=false;
        this.podLifeSupport=0;

        // Respawn with reduced resources (25%)
        const ammo=this.physicsWorld.ammo;

        // Reset position
        const transform=new ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new ammo.btVector3(spawnX, spawnY, 0));
        this.body.setWorldTransform(transform);
        this.body.getMotionState().setWorldTransform(transform);

        // Reset velocity
        this.body.setLinearVelocity(new ammo.btVector3(0, 0, 0));
        this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0));

        // Reset state with reduced resources
        this.dead=false;
        this.deathTime=null;
        this.damage=0;
        this.fuel=Math.floor(this.maxFuel*0.25); // 25% of max fuel
        this.power=Math.floor(this.maxPower*0.5); // 50% power
        this.lightsOn=true;
        this.landed=false;

        // Keep 25% of cargo
        for (const cargo of this.cargo) {
            cargo.amount=Math.floor(cargo.amount*0.25);
        }
        this.cargo=this.cargo.filter(c => c.amount>0);

        return true;
    }

    // Change ship type (must be parked at base or boarding/exiting)
    setShipType(type, restoreState=null) {
        const oldStats=SHIP_TYPES[this.shipType]||SHIP_TYPES.scout;

        // Return existing ship stats before switching (for spawning the empty ship)
        const previousShipState={
            type: this.shipType,
            fuel: this.fuel,
            power: this.power,
            damage: this.damage,
            cargo: [...this.cargo], // Clone cargo
            width: oldStats.width,
            height: oldStats.height
        };

        if (!SHIP_TYPES[type]) return false;
        if (this.shipType===type) return previousShipState;

        const newStats=SHIP_TYPES[type];
        this.shipType=type;

        // If switching to EVA: Reset resources to full jetpack
        // If switching to Ship (Boarding): Will be handled by caller (transferring stats from vehicle)
        if (type==='eva') {
            this.fuel=newStats.maxFuel;
            this.power=newStats.maxPower;
            this.cargo=[]; // Drop cargo (handled by spawing ship)
        } else {
            // New ship default stats (unless overwritten by boarding logic)
            // But usually setShipType is called for 'upgrading' at base or boarding.
            // If boarding, we should set fuel/cargo from the boarded ship.
            // We'll leave that to the Entity logic in Game.js
            this.fuel=newStats.maxFuel;
            this.power=newStats.maxPower;
            this.oxygen=newStats.maxOxygen||100;
        }

        // Restore state if provided (boarding a vehicle)
        if (restoreState) {
            this.fuel=restoreState.fuel;
            this.power=restoreState.power;
            this.damage=restoreState.damage;
            this.oxygen=restoreState.oxygen;
            this.cargo=restoreState.cargo||[];
        }

        // Update stats
        this.maxFuel=newStats.maxFuel;
        this.maxPower=newStats.maxPower;
        this.maxOxygen=newStats.maxOxygen||100;
        this.oxygenConsumption=newStats.oxygenConsumption||0;
        this.basePowerRegen=newStats.basePowerRegen||2.0;
        this.powerRegen=this.basePowerRegen*(this.config.difficulty?.powerGenerationMultiplier||1);
        this.fuelConsumption=newStats.fuelConsumption*(this.config.difficulty?.fuelConsumptionMultiplier||1);
        this.thrustForce=newStats.thrustForce;

        // Recreate body with new dimensions
        const pos=this.getPosition();
        const vel=this.getVelocity();
        // const rot = this.getRotation(); // Angle in Z - not used for new body orientation (always upright)

        // Remove old body. Through the physics world, not straight to
        // removeRigidBody -- that left the discarded body in PhysicsWorld.bodies
        // with its WASM memory still allocated, so every ship switch and every
        // EVA exit leaked one.
        if (this.body) {
            this.physicsWorld.removeBody(this.body);
        }

        // Create new body
        // Note: We'll reset rotation to 0 to be safe as per design "must be parked"
        this.body=this.physicsWorld.createBox(pos.x, pos.y, newStats.width, newStats.height, newStats.mass);
        this.body.setActivationState(4); // DISABLE_DEACTIVATION

        // Restore velocity (usually 0 if parked)
        const ammo=this.physicsWorld.ammo;
        this.body.setLinearVelocity(new ammo.btVector3(vel.vx, vel.vy, 0));

        // Recalculate mass with cargo
        this.updateMass();

        // Re-apply upgrades to new ship stats
        this.applyUpgrades();

        return previousShipState;
    }

    // Apply upgrade multipliers to current stats (4 levels)
    applyUpgrades() {
        const stats=SHIP_TYPES[this.shipType]||SHIP_TYPES.scout;

        // 1. Power Generation (Solar Panels)
        // Level 1-4: +25% per level
        const powerMult=1+(this.upgrades.power*0.25);
        this.powerRegen=stats.basePowerRegen*powerMult*(this.config.difficulty?.powerGenerationMultiplier||1);

        // 2. Thrust Force
        // Level 1-4: +20% per level
        const thrustMult=1+(this.upgrades.thrust*0.20);
        this.thrustForce=stats.thrustForce*thrustMult;

        // 3. Max Fuel
        // Level 1-4: +33% per level
        const fuelMult=1+(this.upgrades.fuel*0.33);
        this.maxFuel=stats.maxFuel*fuelMult;

        // 4. Mining Efficiency (Laser)
        // Level 1-4: -20% power draw per level
        const miningMult=Math.max(0.1, 1-(this.upgrades.laser*0.20));
        this.miningPowerDrain=7.5*miningMult*(this.config.difficulty?.powerConsumptionMultiplier||1);
    }
}
