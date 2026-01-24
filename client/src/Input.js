export class Input {
    constructor(socket, canvas) {
        this.socket=socket;
        this.canvas=canvas;
        this.state={
            up: false,
            left: false,
            right: false
        };

        // Mouse position in canvas coordinates
        this.mouseX = 0;
        this.mouseY = 0;

        // Spotlight angle (calculated externally based on player position)
        this.spotlightAngle = 0;

        // Input update interval for smooth spotlight updates
        this.lastInputTime = 0;
        this.inputInterval = 50; // Send input every 50ms for smooth spotlight

        window.addEventListener('keydown', (e) => this.handleKey(e, true));
        window.addEventListener('keyup', (e) => this.handleKey(e, false));

        // Track mouse movement
        if (canvas) {
            canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        }
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    }

    handleMouseMove(e) {
        // Get mouse position relative to canvas
        if (this.canvas) {
            const rect = this.canvas.getBoundingClientRect();
            this.mouseX = e.clientX - rect.left;
            this.mouseY = e.clientY - rect.top;
        } else {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        }
    }

    handleKey(e, isDown) {
        let changed=false;

        switch (e.code) {
            case 'ArrowUp':
            case 'KeyW':
                if (this.state.up!==isDown) {
                    this.state.up=isDown;
                    changed=true;
                }
                break;
            case 'ArrowLeft':
            case 'KeyA':
                if (this.state.left!==isDown) {
                    this.state.left=isDown;
                    changed=true;
                }
                break;
            case 'ArrowRight':
            case 'KeyD':
                if (this.state.right!==isDown) {
                    this.state.right=isDown;
                    changed=true;
                }
                break;
        }

        if (changed) {
            this.sendInput();
        }
    }

    // Called by main.js each frame to update spotlight angle
    updateSpotlight(playerX, playerY, cameraX, cameraY) {
        // Convert player world position to screen position
        const screenX = playerX - cameraX + (this.canvas ? this.canvas.width / 2 : 400);
        const screenY = playerY - cameraY + (this.canvas ? this.canvas.height / 2 : 300);

        // Calculate angle from player to mouse
        const dx = this.mouseX - screenX;
        const dy = this.mouseY - screenY;
        this.spotlightAngle = Math.atan2(dy, dx);

        // Send periodic updates for smooth spotlight movement
        const now = Date.now();
        if (now - this.lastInputTime > this.inputInterval) {
            this.lastInputTime = now;
            this.sendInput();
        }
    }

    sendInput() {
        this.socket.emit('input', {
            thrust: this.state.up,
            left: this.state.left,
            right: this.state.right,
            spotlightAngle: this.spotlightAngle
        });
    }
}
