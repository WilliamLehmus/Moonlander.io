export class Input {
    constructor(socket, canvas) {
        this.socket=socket;
        this.canvas=canvas;
        this.state={
            up: false,
            left: false,
            right: false,
            mining: false,
            transferFuel: false,
            transferCargo: false,
            exitVehicle: false, // X key held for 2 seconds to exit
            enterVehicle: false, // E key to enter nearby vehicle
            toggleLights: false,
            toggleSpotlight: false,
            toggleAntenna: false
        };

        // Mouse position in canvas coordinates
        this.mouseX=0;
        this.mouseY=0;

        // Spotlight angle (calculated externally based on player position)
        this.spotlightAngle=0;

        // Input update interval for smooth spotlight updates
        this.lastInputTime=0;
        this.inputInterval=50; // Send input every 50ms for smooth spotlight

        // Exit vehicle hold timer (2 seconds to exit)
        this.exitHoldStart=null;
        this.exitHoldDuration=2000; // 2 seconds
        this.isHoldingX=false;

        // Cable placement mode
        this.cableMode=false;

        window.addEventListener('keydown', (e) => this.handleKey(e, true));
        window.addEventListener('keyup', (e) => this.handleKey(e, false));

        // Track mouse movement
        if (canvas) {
            canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
            canvas.addEventListener('mousedown', (e) => this.handleMouseClick(e));
        }
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    }

    setCableMode(enabled) {
        this.cableMode=enabled;
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
                // X must be HELD for 2 seconds to exit vehicle
                if (isDown&&!this.isHoldingX) {
                    this.isHoldingX=true;
                    this.exitHoldStart=Date.now();
                } else if (!isDown&&this.isHoldingX) {
                    this.isHoldingX=false;
                    this.exitHoldStart=null;
                    // Cancel exit if released before 2 seconds
                    if (this.state.exitVehicle) {
                        this.state.exitVehicle=false;
                        changed=true;
                    }
                }
                break;
            case 'KeyE':
                // E is now ONLY for entering vehicles (not exiting)
                if (this.state.enterVehicle!==isDown) {
                    this.state.enterVehicle=isDown;
                    changed=true;
                }
                break;
            case 'KeyG':
                if (isDown) this.toggleTether();
                break;
            case 'KeyL':
                if (this.state.toggleSpotlight!==isDown) {
                    this.state.toggleSpotlight=isDown;
                    changed=true;
                }
                break;
            case 'KeyK':
                if (this.state.toggleLights!==isDown) {
                    this.state.toggleLights=isDown;
                    changed=true;
                }
                break;
            case 'KeyH':
                if (this.state.toggleAntenna!==isDown) {
                    this.state.toggleAntenna=isDown;
                    changed=true;
                }
                break;
            case 'KeyJ':
                if (isDown) this.jettisonCargo(); // Drop 25% of cargo
                break;
            // Quickbar keys (1-9)
            case 'Digit1':
            case 'Digit2':
            case 'Digit3':
            case 'Digit4':
            case 'Digit5':
            case 'Digit6':
            case 'Digit7':
            case 'Digit8':
            case 'Digit9':
                if (isDown) {
                    const slot=parseInt(e.code.replace('Digit', ''))-1;
                    this.selectQuickbarSlot(slot);
                }
                break;

            // Ping keys (moved to Ctrl+1-4 or F1-F4)
            case 'F1':
                if (isDown) this.sendPing('yellow'); // "Check this out"
                break;
            case 'F2':
                if (isDown) this.sendPing('red'); // "Danger/Help!"
                break;
            case 'F3':
                if (isDown) this.sendPing('green'); // "Resources here"
                break;
            case 'F4':
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

    selectQuickbarSlot(index) {
        if (this.quickbarSelection===index) {
            this.quickbarSelection=null;
        } else {
            this.quickbarSelection=index;
        }
        this.socket.emit('selectQuickbar', {slot: this.quickbarSelection});
        // Also dispatch a custom event for UI updates
        window.dispatchEvent(new CustomEvent('quickbarSelect', {detail: {slot: this.quickbarSelection}}));
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

    // Check if X has been held long enough
    updateExitHold() {
        if (this.isHoldingX&&this.exitHoldStart) {
            const elapsed=Date.now()-this.exitHoldStart;
            if (elapsed>=this.exitHoldDuration&&!this.state.exitVehicle) {
                this.state.exitVehicle=true;
                this.sendInput();
            }
        }
    }

    // Get exit hold progress (0-1) for UI display
    getExitHoldProgress() {
        if (!this.isHoldingX||!this.exitHoldStart) return 0;
        const elapsed=Date.now()-this.exitHoldStart;
        return Math.min(1, elapsed/this.exitHoldDuration);
    }

    sendInput() {
        // Update exit hold state before sending
        this.updateExitHold();

        this.socket.emit('input', {
            thrust: this.state.up,
            left: this.state.left,
            right: this.state.right,
            mining: this.state.mining,
            transferFuel: this.state.transferFuel,
            spotlightAngle: this.spotlightAngle,
            transferCargo: this.state.transferCargo,
            exitVehicle: this.state.exitVehicle,
            enterVehicle: this.state.enterVehicle,
            toggleLights: this.state.toggleLights,
            toggleSpotlight: this.state.toggleSpotlight,
            toggleAntenna: this.state.toggleAntenna
        });
    }

    // Handle mouse click for placement
    handleMouseClick(e) {
        if (!this.cableMode) return;

        // Convert screen click to world coordinates?
        // Input class only knows screen mouseX/Y.
        // It needs Camera position to know World X/Y. 
        // We'll dispatch an event that main.js (which knows camera) handles.
        window.dispatchEvent(new CustomEvent('cableClick', {
            detail: {x: this.mouseX, y: this.mouseY}
        }));
    }
}
