import Ammo from 'ammo.js';

export class Player {
    constructor(id, physicsWorld, spawnX=400, spawnY=100, config) {
        this.id=id;
        this.physicsWorld=physicsWorld;
        this.config=config||{};

        // Create RigidBody
        // Box shape 20x20 (smaller to fit through 8px tile gaps)
        this.body=this.physicsWorld.createBox(spawnX, spawnY, 20, 20, 1);
        this.body.setActivationState(4); // DISABLE_DEACTIVATION

        const diff=this.config.difficulty||{};

        // Fuel system - reduced capacity, requires careful management
        this.fuel=500;           // Starting fuel (reduced from 1000)
        this.maxFuel=500;        // Max fuel capacity (reduced from 1000)
        this.fuelConsumption=30*(diff.fuelConsumptionMultiplier||1); // Fuel per second when thrusting

        // Power system - runs electric equipment
        this.power=100;          // Current power
        this.maxPower=100;       // Max power capacity
        this.powerRegen=2*(diff.powerGenerationMultiplier||1);       // Power regeneration per second (solar)
        this.lightsOn=true;      // Whether lights are active
        this.lightPowerDrain=3*(diff.powerConsumptionMultiplier||1);  // Power per second for lights
        this.miningPowerDrain=15*(diff.powerConsumptionMultiplier||1); // Power per second while mining

        this.damage=0; // 0-11 damage levels
        this.inputs={thrust: false, left: false, right: false, mining: false, transferFuel: false, transferCargo: false};
        this.color=`hsl(${Math.random()*360}, 70%, 50%)`;
        this.dead=false;
        this.landed=false;
        this.onPad=false; // Whether player is on landing pad
        this.deathTime=null; // When the player died
        this.spawnX=spawnX;
        this.spawnY=spawnY;

        // Spotlight direction (angle in radians, 0 = right, PI/2 = down)
        this.spotlightAngle=0;

        // Mining system
        this.mining=false;
        this.miningTarget=null; // {x, y} grid coordinates of ore being mined
        this.miningProgress=0; // 0-1 progress on current ore
        this.miningRange=this.config.mining?.range||80; // World units to mine from

        // Cargo system
        this.cargo=[]; // Array of {type, amount}
        this.cargoCapacity=500; // Max cargo units
        this.cargoWeight=0; // Current weight affecting physics

        // Ping system
        this.activePing=null; // {type: 'yellow'|'red'|'green'|'blue', x, y, timestamp}

        // Docking/fuel transfer system
        this.dockingTarget=null; // ID of player we can dock with
        this.isDocked=false; // Currently docked
        this.fuelTransferring=false; // Currently transferring fuel
        this.fuelTransferred=0; // Amount transferred in current session (for minimum check)

        // Tether system
        this.tetheredTo=null; // ID of player we're tethered to
        this.tetherLength=0; // Current tether length
        this.maxTetherLength=this.config.difficulty?.cableMaxLength||150; // Max length before snapping
        this.tetherTension=0; // 0-1, how taut the rope is
        this.tetherBroken=false; // If tether snapped

        // Survival pod system
        this.inPod=false; // In survival pod mode after death
        this.podLifeSupport=60; // Seconds of life support
        this.podX=0; // Pod position (separate from body)
        this.podY=0;
        this.podVX=0; // Pod velocity
        this.podVY=0;
        this.beaconPulse=0; // For distress beacon animation

        // Tmp vectors/quat for reading state to avoid GC
        // Note: In real production, reuse single global instances if possible, 
        // but here one per player is fine.
        this.tmpTrans=new this.physicsWorld.ammo.btTransform();
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
    }

    // Get total cargo weight
    getCargoWeight() {
        // 0.002 mass per unit = full cargo (500) adds 1.0 mass (2.0 total weight)
        // This makes full cargo sluggish but still very flyable
        return this.cargo.reduce((sum, item) => sum+item.amount*0.002, 0);
    }

    // Get total cargo amount
    getCargoAmount() {
        return this.cargo.reduce((sum, item) => sum+item.amount, 0);
    }

    // Add cargo if space available
    addCargo(type, amount) {
        const currentAmount=this.getCargoAmount();
        const spaceAvailable=this.cargoCapacity-currentAmount;
        const amountToAdd=Math.min(amount, spaceAvailable);

        if (amountToAdd<=0) return 0;

        // Find existing cargo of this type or create new
        const existing=this.cargo.find(c => c.type===type);
        if (existing) {
            existing.amount+=amountToAdd;
        } else {
            this.cargo.push({type, amount: amountToAdd});
        }

        // Update physics mass
        this.updateMass();

        return amountToAdd;
    }

    // Update physics body mass based on cargo
    updateMass() {
        const baseMass=1;
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
        this.fuel=this.maxFuel;   // Full fuel
        this.power=this.maxPower; // Full power
        this.lightsOn=true;       // Lights on
        this.landed=false;
        this.spawnX=spawnX;
        this.spawnY=spawnY;

        return true;
    }

    update(dt) {
        if (this.dead||!this.body) return;

        const THRUST_FORCE=80;

        const ammo=this.physicsWorld.ammo;

        // Power regeneration (solar panels, faster when on surface/pad)
        const regenRate=this.onPad? this.powerRegen*3:this.powerRegen;
        this.power=Math.min(this.maxPower, this.power+regenRate*dt);

        // Power consumption for lights
        if (this.lightsOn&&this.power>0) {
            this.power-=this.lightPowerDrain*dt;
            if (this.power<=0) {
                this.power=0;
                this.lightsOn=false; // Lights auto-off when no power
            }
        }

        // Rotation (positive Z = CCW in physics, but we want visual CW for right)
        if (this.inputs.left) {
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, 3));
        } else if (this.inputs.right) {
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, -3));
        } else {
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0));
        }

        // Thrust - uses fuel
        if (this.inputs.thrust&&this.fuel>0) {
            const angle=-this.getRotation(); // Negate to match visual rotation
            // Sprite points UP at angle=0, so adjust by -PI/2 for thrust direction
            const thrustAngle=angle-Math.PI/2;
            const forceX=Math.cos(thrustAngle)*THRUST_FORCE;
            const forceY=Math.sin(thrustAngle)*THRUST_FORCE;

            this.body.applyCentralForce(new ammo.btVector3(forceX, forceY, 0));
            this.fuel-=this.fuelConsumption*dt;
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

    // Toggle lights
    toggleLights() {
        if (this.power>0||!this.lightsOn) {
            this.lightsOn=!this.lightsOn;
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

    serialize() {
        const pos=this.getPosition();
        const vel=this.getVelocity();

        return {
            id: this.id,
            x: pos.x,
            y: pos.y,
            vx: vel.vx,
            vy: vel.vy,
            angle: -this.getRotation(), // Negate to match canvas rotation direction
            fuel: this.fuel,
            maxFuel: this.maxFuel,
            damage: this.damage,
            thrusting: this.inputs.thrust,
            color: this.color,
            dead: this.dead,
            landed: this.landed,
            onPad: this.onPad,
            deathTime: this.deathTime,
            spotlightAngle: this.spotlightAngle,
            // Power system
            power: this.power,
            maxPower: this.maxPower,
            lightsOn: this.lightsOn,
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
            beaconPulse: this.beaconPulse
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
}
