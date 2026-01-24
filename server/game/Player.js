import Ammo from 'ammo.js';

export class Player {
    constructor(id, physicsWorld, spawnX=400, spawnY=100) {
        this.id=id;
        this.physicsWorld=physicsWorld;

        // Create RigidBody
        // Box shape 20x20 (smaller to fit through 8px tile gaps)
        this.body=this.physicsWorld.createBox(spawnX, spawnY, 20, 20, 1);
        this.body.setActivationState(4); // DISABLE_DEACTIVATION

        this.fuel=1000;
        this.damage=0; // 0-11 damage levels
        this.inputs={thrust: false, left: false, right: false};
        this.color=`hsl(${Math.random()*360}, 70%, 50%)`;
        this.dead=false;
        this.landed=false;
        this.onPad=false; // Whether player is on landing pad
        this.deathTime=null; // When the player died
        this.spawnX=spawnX;
        this.spawnY=spawnY;

        // Spotlight direction (angle in radians, 0 = right, PI/2 = down)
        this.spotlightAngle=0;

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
        if (typeof input.spotlightAngle === 'number') {
            this.spotlightAngle = input.spotlightAngle;
        }
    }

    takeDamage(amount) {
        this.damage = Math.min(11, this.damage + amount);
        if (this.damage >= 11 && !this.dead) {
            this.dead = true;
            this.deathTime = Date.now();
            // Stop the body from moving
            const ammo = this.physicsWorld.ammo;
            this.body.setLinearVelocity(new ammo.btVector3(0, 0, 0));
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0));
        }
    }

    respawn(spawnX, spawnY) {
        if (!this.dead) return false;

        const ammo = this.physicsWorld.ammo;

        // Reset position
        const transform = new ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new ammo.btVector3(spawnX, spawnY, 0));
        this.body.setWorldTransform(transform);
        this.body.getMotionState().setWorldTransform(transform);

        // Reset velocity
        this.body.setLinearVelocity(new ammo.btVector3(0, 0, 0));
        this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0));

        // Reset state
        this.dead = false;
        this.deathTime = null;
        this.damage = 0;
        this.fuel = 1000;
        this.landed = false;
        this.spawnX = spawnX;
        this.spawnY = spawnY;

        return true;
    }

    update(dt) {
        if (this.dead||!this.body) return;

        const THRUST_FORCE=40;

        const ammo=this.physicsWorld.ammo;

        // Rotation (positive Z = CCW in physics, but we want visual CW for right)
        if (this.inputs.left) {
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, 3));
        } else if (this.inputs.right) {
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, -3));
        } else {
            this.body.setAngularVelocity(new ammo.btVector3(0, 0, 0));
        }

        // Thrust
        if (this.inputs.thrust&&this.fuel>0) {
            const angle=-this.getRotation(); // Negate to match visual rotation
            // Sprite points UP at angle=0, so adjust by -PI/2 for thrust direction
            const thrustAngle = angle - Math.PI / 2;
            const forceX=Math.cos(thrustAngle)*THRUST_FORCE;
            const forceY=Math.sin(thrustAngle)*THRUST_FORCE;

            this.body.applyCentralForce(new ammo.btVector3(forceX, forceY, 0));
            this.fuel-=20*dt;
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
            damage: this.damage,
            thrusting: this.inputs.thrust,
            color: this.color,
            dead: this.dead,
            landed: this.landed,
            onPad: this.onPad,
            deathTime: this.deathTime,
            spotlightAngle: this.spotlightAngle
        };
    }
}
