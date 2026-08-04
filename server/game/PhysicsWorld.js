import AmmoLib from 'ammo.js';

export class PhysicsWorld {
    constructor() {
        this.ammo=null;
        this.world=null;
        this.isReady=false;
        this.bodies=[];
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
