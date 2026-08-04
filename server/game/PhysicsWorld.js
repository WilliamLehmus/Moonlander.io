import AmmoLib from 'ammo.js';

export class PhysicsWorld {
    constructor() {
        this.ammo=null;
        this.world=null;
        this.isReady=false;
        this.bodies=[];
        // Thickness of the thinnest thing a moving body can hit -- one terrain
        // tile. Sets how eagerly continuous collision engages in createBox().
        // VoxelMap.setPhysicsWorld() overwrites this with its real tile size so
        // the two cannot drift apart.
        this.terrainThickness=8;
    }

    async init() {
        this.ammo=AmmoLib;

        // Held as fields, not locals. Every Bullet object lives in ammo.js's
        // fixed 64MB WASM heap, which the JS garbage collector cannot touch --
        // anything not explicitly destroyed is leaked for the life of the
        // process. destroy() below can only free what it still has a handle to.
        this.collisionConfiguration=new this.ammo.btDefaultCollisionConfiguration();
        this.dispatcher=new this.ammo.btCollisionDispatcher(this.collisionConfiguration);
        this.broadphase=new this.ammo.btDbvtBroadphase();
        this.solver=new this.ammo.btSequentialImpulseConstraintSolver();

        this.world=new this.ammo.btDiscreteDynamicsWorld(
            this.dispatcher,
            this.broadphase,
            this.solver,
            this.collisionConfiguration
        );

        this.world.setGravity(new this.ammo.btVector3(0, 10, 0)); // Gravity DOWN (positive Y in many canvas coords, but usually gravity is negative Y)
        // Let's stick to Canvas coords: Y is DOWN. So Gravity is POSITIVE Y.

        this.isReady=true;
        console.log("Physics World Initialized");
    }

    step(dt) {
        if (!this.isReady) return;
        // Max substeps 10, fixed time step 1/60
        this.world.stepSimulation(dt, 10);
    }

    createBox(x, y, width, height, mass) {
        if (!this.isReady) return null;
        const A=this.ammo;

        const transform=new A.btTransform();
        transform.setIdentity();
        const origin=new A.btVector3(x, y, 0);
        transform.setOrigin(origin);

        const halfExtents=new A.btVector3(width/2, height/2, 1);
        const shape=new A.btBoxShape(halfExtents);
        const localInertia=new A.btVector3(0, 0, 0);

        if (mass>0) {
            shape.calculateLocalInertia(mass, localInertia);
        }

        const motionState=new A.btDefaultMotionState(transform);
        const rbInfo=new A.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
        const body=new A.btRigidBody(rbInfo);

        // Lock Z axis movement and X/Y rotation (2D plane)
        const linearFactor=new A.btVector3(1, 1, 0);
        const angularFactor=new A.btVector3(0, 0, 1);
        body.setLinearFactor(linearFactor);
        body.setAngularFactor(angularFactor);

        // Continuous collision for anything that moves. Terrain collision is a
        // one-tile shell -- only surface tiles get bodies, the rock behind them
        // is hollow -- so a body that skips past the shell in a single step
        // falls through the entire moon. Gravity alone cannot do it (damping
        // caps a fall at ~189 u/s), but holding thrust straight down reaches
        // ~1000 u/s, well past the ~400-800 u/s where the shell gives way.
        //
        // The usual Bullet recipe sets the threshold to the body's own smallest
        // dimension, which assumes obstacles at least that thick. Here the wall
        // is one 8-unit tile, so a 30x30 cargo lander would never trigger CCD at
        // all and sailed straight through. Take whichever is smaller, halved:
        // sweeping has to begin before a single step can cross the wall, not as
        // it happens. Measured -- the full value still let cargo through at 800.
        //
        // A falling body reaches ~189 u/s, roughly 3 units per step, so for
        // every ship this stays dormant in ordinary flight.
        if (mass>0) {
            const minDimension=Math.min(width, height);
            body.setCcdMotionThreshold(Math.min(minDimension, this.terrainThickness)/2);
            // The box's inscribed sphere. Smaller sweeps (0.35, 0.45) measurably
            // let bodies through; this never extends beyond the box itself, so
            // it cannot cause contact to register early.
            body.setCcdSweptSphereRadius(minDimension/2);
        }

        // The body outlives its shape and motion state only if we keep hold of
        // them -- Bullet does not own them, so removeBody() needs them to free.
        body._shape=shape;
        body._motionState=motionState;

        // Everything else was scaffolding. Bullet copies these by value during
        // construction, so once the body exists they are pure garbage -- and at
        // ~5700 terrain bodies per map that garbage is close to a megabyte.
        A.destroy(angularFactor);
        A.destroy(linearFactor);
        A.destroy(rbInfo);
        A.destroy(localInertia);
        A.destroy(halfExtents);
        A.destroy(origin);
        A.destroy(transform);

        this.world.addRigidBody(body);
        this.bodies.push(body);

        return body;
    }

    removeBody(body) {
        if (!this.isReady||!body) return;
        this.world.removeRigidBody(body);
        const index=this.bodies.indexOf(body);
        if (index>-1) {
            this.bodies.splice(index, 1);
        }
        this.destroyBody(body);
    }

    // Frees a body's WASM memory. Must already be out of the world.
    destroyBody(body) {
        const A=this.ammo;
        if (body._motionState) {
            A.destroy(body._motionState);
            body._motionState=null;
        }
        if (body._shape) {
            A.destroy(body._shape);
            body._shape=null;
        }
        A.destroy(body);
    }

    // Tear the whole world down. Without this a finished game leaks its entire
    // physics world -- roughly 5700 terrain bodies plus the world itself -- and
    // the process aborts with "Cannot enlarge memory arrays" after about five
    // games, taking every other room on the server with it.
    destroy() {
        if (!this.isReady) return;
        const A=this.ammo;

        for (const body of this.bodies) {
            this.world.removeRigidBody(body);
            this.destroyBody(body);
        }
        this.bodies=[];

        A.destroy(this.world);
        A.destroy(this.solver);
        A.destroy(this.broadphase);
        A.destroy(this.dispatcher);
        A.destroy(this.collisionConfiguration);

        this.world=null;
        this.solver=null;
        this.broadphase=null;
        this.dispatcher=null;
        this.collisionConfiguration=null;
        this.isReady=false;
    }
}

// Test if run directly
import {fileURLToPath} from 'url';
if (process.argv[1]===fileURLToPath(import.meta.url)) {
    (async () => {
        try {
            const p=new PhysicsWorld();
            await p.init();
            p.createBox(0, 0, 10, 10, 1);
            console.log("Body created");
            p.step(1/60);
            console.log("Stepped");
        } catch (e) {
            console.error("Test failed:", e);
        }
    })();
}
