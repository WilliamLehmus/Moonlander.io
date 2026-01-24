export class SoundManager {
    constructor() {
        this.masterVolume=1.0;
        this.sfxVolume=1.0;
        this.musicVolume=1.0;
        this.soundsLoaded=false;
        this.sounds={};
        this.menuMusic=null;
        this.gameMusic=null;

        // Thrust state tracking
        this.isThrusting=false;
        this.thrustSound=null;
        this.thrustIgniteSound=null;
    }

    async loadSounds() {
        const soundFiles={
            crash1: '/Sounds/Crash1.mp3',
            crash2: '/Sounds/Crash2.mp3',
            crash3: '/Sounds/Crash3.mp3',
            crash4: '/Sounds/Crash4.mp3',
            ignite: '/Sounds/Thruster_ignite.mp3',
            thrust: '/Sounds/Constant_thrust.mp3'
        };

        const menuMusicSrc='/Music/Track1.mp3';
        this.menuMusic=new Audio(menuMusicSrc);
        this.menuMusic.loop=true;

        const gameMusicSrc='/Music/Track2.mp3';
        this.gameMusic=new Audio(gameMusicSrc);
        this.gameMusic.loop=true;

        const loadPromises=Object.entries(soundFiles).map(([key, src]) => {
            return new Promise((resolve, reject) => {
                const audio=new Audio(src);
                audio.addEventListener('canplaythrough', () => resolve(audio), {once: true});
                audio.addEventListener('error', (e) => {
                    console.warn(`Failed to load sound: ${src}`, e);
                    resolve(null); // Resolve with null so we don't break everything
                });

                // Preload
                audio.load();
                this.sounds[key]=audio;
            });
        });

        // Add music loading to promises to ensure it's ready
        // Add music loading to promises to ensure it's ready
        const menuMusicLoadPromise=new Promise((resolve) => {
            if (this.menuMusic) {
                this.menuMusic.addEventListener('canplaythrough', () => resolve(this.menuMusic), {once: true});
                this.menuMusic.addEventListener('error', (e) => {
                    console.warn(`Failed to load menu music: ${menuMusicSrc}`, e);
                    resolve(null);
                });
                this.menuMusic.load();
            } else {
                resolve(null);
            }
        });
        loadPromises.push(menuMusicLoadPromise);

        const gameMusicLoadPromise=new Promise((resolve) => {
            if (this.gameMusic) {
                this.gameMusic.addEventListener('canplaythrough', () => resolve(this.gameMusic), {once: true});
                this.gameMusic.addEventListener('error', (e) => {
                    console.warn(`Failed to load game music: ${gameMusicSrc}`, e);
                    resolve(null);
                });
                this.gameMusic.load();
            } else {
                resolve(null);
            }
        });
        loadPromises.push(gameMusicLoadPromise);

        await Promise.all(loadPromises);
        this.soundsLoaded=true;
        console.log('Sounds and Music loaded');

        // Setup thrust loop
        if (this.sounds.thrust) {
            this.sounds.thrust.loop=true;
        }
    }

    getEffectiveSfxVolume() {
        return this.masterVolume*this.sfxVolume;
    }

    getEffectiveMusicVolume() {
        return this.masterVolume*this.musicVolume;
    }

    setMasterVolume(vol) {
        this.masterVolume=Math.max(0, Math.min(1, vol));
        this.updateVolumes();
    }

    setSfxVolume(vol) {
        this.sfxVolume=Math.max(0, Math.min(1, vol));
        this.updateVolumes();
    }

    setMusicVolume(vol) {
        this.musicVolume=Math.max(0, Math.min(1, vol));
        this.updateVolumes();
    }

    updateVolumes() {
        const sfxVol=this.getEffectiveSfxVolume();
        Object.values(this.sounds).forEach(sound => {
            if (sound) sound.volume=sfxVol;
        });

        if (this.menuMusic) {
            this.menuMusic.volume=this.getEffectiveMusicVolume();
        }
        if (this.gameMusic) {
            this.gameMusic.volume=this.getEffectiveMusicVolume();
        }
    }

    playMenuMusic() {
        if (!this.soundsLoaded) return;

        // Stop game music if playing
        if (this.gameMusic) {
            this.gameMusic.pause();
            this.gameMusic.currentTime=0;
        }

        if (this.menuMusic) {
            this.menuMusic.volume=this.getEffectiveMusicVolume();
            this.menuMusic.play().catch(e => console.warn('Menu music play failed', e));
        }
    }

    playGameMusic() {
        if (!this.soundsLoaded) return;

        // Stop menu music if playing
        if (this.menuMusic) {
            this.menuMusic.pause();
            this.menuMusic.currentTime=0;
        }

        if (this.gameMusic) {
            this.gameMusic.volume=this.getEffectiveMusicVolume();
            this.gameMusic.play().catch(e => console.warn('Game music play failed', e));
        }
    }

    stopAllMusic() {
        if (this.menuMusic) {
            this.menuMusic.pause();
            this.menuMusic.currentTime=0;
        }
        if (this.gameMusic) {
            this.gameMusic.pause();
            this.gameMusic.currentTime=0;
        }
    }

    playCollision() {
        if (!this.soundsLoaded) return;

        const crashIdx=Math.floor(Math.random()*4)+1;
        const soundKey=`crash${crashIdx}`;
        const sound=this.sounds[soundKey];

        if (sound) {
            // Clone node to allow overlapping sounds
            const clone=sound.cloneNode();
            clone.volume=this.getEffectiveSfxVolume();
            clone.play().catch(e => console.warn('Audio play failed', e));
        }
    }

    setThrust(thrusting) {
        if (!this.soundsLoaded) return;

        if (thrusting&&!this.isThrusting) {
            // Start thrust
            this.isThrusting=true;

            // Play ignite
            if (this.sounds.ignite) {
                const ignite=this.sounds.ignite.cloneNode();
                ignite.volume=this.getEffectiveSfxVolume();
                ignite.play().catch(e => { });
            }

            // Start constant loop
            if (this.sounds.thrust) {
                this.sounds.thrust.currentTime=0;
                this.sounds.thrust.volume=this.getEffectiveSfxVolume();
                this.sounds.thrust.play().catch(e => { });
            }
        } else if (!thrusting&&this.isThrusting) {
            // Stop thrust
            this.isThrusting=false;

            if (this.sounds.thrust) {
                this.sounds.thrust.pause();
                this.sounds.thrust.currentTime=0;
            }
        }
    }
}
