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

        const collisionConfiguration=new this.ammo.btDefaultCollisionConfiguration();
        const dispatcher=new this.ammo.btCollisionDispatcher(collisionConfiguration);
        const broadphase=new this.ammo.btDbvtBroadphase();
        const solver=new this.ammo.btSequentialImpulseConstraintSolver();

        this.world=new this.ammo.btDiscreteDynamicsWorld(
            dispatcher,
            broadphase,
            solver,
            collisionConfiguration
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

        const transform=new this.ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new this.ammo.btVector3(x, y, 0));

        const shape=new this.ammo.btBoxShape(new this.ammo.btVector3(width/2, height/2, 1));
        const localInertia=new this.ammo.btVector3(0, 0, 0);

        if (mass>0) {
            shape.calculateLocalInertia(mass, localInertia);
        }

        const motionState=new this.ammo.btDefaultMotionState(transform);
        const rbInfo=new this.ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
        const body=new this.ammo.btRigidBody(rbInfo);

        // Lock Z axis movement and X/Y rotation (2D plane)
        body.setLinearFactor(new this.ammo.btVector3(1, 1, 0));
        body.setAngularFactor(new this.ammo.btVector3(0, 0, 1));

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
