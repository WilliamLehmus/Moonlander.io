export class Terrain {
    constructor() {
        this.points=[];
        this.width=3000;
        this.height=800;
        this.generate();
    }

    generate() {
        // Create a rugged terrain
        const step=50;
        this.points.push({x: 0, y: this.height/2});

        for (let x=0; x<=this.width; x+=step) {
            // Some flat spots for landing
            const isLandingPad=Math.random()>0.8;
            let y;
            if (isLandingPad&&this.points.length>0) {
                y=this.points[this.points.length-1].y; // Flat
            } else {
                y=(this.height/2)+(Math.random()-0.5)*300;
                if (y>this.height) y=this.height-10;
                if (y<100) y=100;
            }
            this.points.push({x, y});
        }

        // Ensure ends are closed purely for drawing or logic if needed, 
        // but for now just a line strip is enough.
    }

    serialize() {
        return this.points;
    }

    // Collision detection helper
    checkCollision(player) {
        // Simple point check for now or line intersection
        // TODO: Implement later
        return false;
    }
}
