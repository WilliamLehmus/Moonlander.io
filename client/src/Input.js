export class Input {
    constructor(socket, canvas) {
        this.socket=socket;
        this.canvas=canvas;
        this.state={
            up: false,
            left: false,
            right: false,
            mining: false,
            mining: false,
            transferFuel: false,
            transferCargo: false,
            interact: false
        };

        // Mouse position in canvas coordinates
        this.mouseX=0;
        this.mouseY=0;

        // Spotlight angle (calculated externally based on player position)
        this.spotlightAngle=0;

        // Input update interval for smooth spotlight updates
        this.lastInputTime=0;
        this.inputInterval=50; // Send input every 50ms for smooth spotlight

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
            const rect=this.canvas.getBoundingClientRect();
            this.mouseX=e.clientX-rect.left;
            this.mouseY=e.clientY-rect.top;
        } else {
            this.mouseX=e.clientX;
            this.mouseY=e.clientY;
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
            case 'Space':
                if (this.state.mining!==isDown) {
                    this.state.mining=isDown;
                    changed=true;
                }
                e.preventDefault(); // Prevent scrolling
                break;
            case 'KeyF':
                if (this.state.transferFuel!==isDown) {
                    this.state.transferFuel=isDown;
                    changed=true;
                }
                break;
            case 'KeyT':
                if (this.state.transferCargo!==isDown) {
                    this.state.transferCargo=isDown;
                    changed=true;
                }
                break;
            case 'KeyX':
                if (this.state.interact!==isDown) {
                    this.state.interact=isDown;
                    changed=true;
                }
                break;
            case 'KeyE':
                // Interact was E, but user wants X. Let's keep E as a secondary or remove.
                // User said "Make X the exit moonlander button".
                // I'll keep E for now for boarding or just remove?
                // Actually boarding and exiting are the same "interact".
                // Let's just make X the primary.
                if (this.state.interact!==isDown) {
                    this.state.interact=isDown;
                    changed=true;
                }
                break;
            case 'KeyG':
                if (isDown) this.toggleTether(); // Remapped tether to G
                break;
            case 'KeyJ':
                if (isDown) this.jettisonCargo(); // Drop 25% of cargo
                break;
            // Ping keys
            case 'Digit1':
                if (isDown) this.sendPing('yellow'); // "Check this out"
                break;
            case 'Digit2':
                if (isDown) this.sendPing('red'); // "Danger/Help!"
                break;
            case 'Digit3':
                if (isDown) this.sendPing('green'); // "Resources here"
                break;
            case 'Digit4':
                if (isDown) this.sendPing('blue'); // "Regroup here"
                break;
        }

        if (changed) {
            this.sendInput();
        }
    }

    sendPing(type) {
        this.socket.emit('ping', {type});
    }

    toggleTether() {
        this.socket.emit('toggleTether');
    }

    jettisonCargo() {
        this.socket.emit('jettisonCargo');
    }

    // Called by main.js each frame to update spotlight angle
    updateSpotlight(playerX, playerY, cameraX, cameraY) {
        // Convert player world position to screen position
        const screenX=playerX-cameraX;
        const screenY=playerY-cameraY;

        // Calculate angle from player to mouse
        const dx=this.mouseX-screenX;
        const dy=this.mouseY-screenY;
        this.spotlightAngle=Math.atan2(dy, dx);

        // Send periodic updates for smooth spotlight movement
        const now=Date.now();
        if (now-this.lastInputTime>this.inputInterval) {
            this.lastInputTime=now;
            this.sendInput();
        }
    }

    sendInput() {
        this.socket.emit('input', {
            thrust: this.state.up,
            left: this.state.left,
            right: this.state.right,
            mining: this.state.mining,
            transferFuel: this.state.transferFuel,
            spotlightAngle: this.spotlightAngle,
            transferCargo: this.state.transferCargo,
            interact: this.state.interact
        });
    }
}
