export class SoundManager {
    constructor() {
        this.masterVolume=1.0;
        this.sfxVolume=1.0;
        this.musicVolume=1.0;
        this.soundsLoaded=false;
        this.sounds={};
        this.music=null;

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

        const musicSrc='/Music/Track1.mp3';
        this.music=new Audio(musicSrc);
        this.music.loop=true;

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
        const musicLoadPromise=new Promise((resolve) => {
            if (this.music) {
                this.music.addEventListener('canplaythrough', () => resolve(this.music), {once: true});
                this.music.addEventListener('error', (e) => {
                    console.warn(`Failed to load music: ${musicSrc}`, e);
                    resolve(null);
                });
                this.music.load();
            } else {
                resolve(null);
            }
        });
        loadPromises.push(musicLoadPromise);

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

        if (this.music) {
            this.music.volume=this.getEffectiveMusicVolume();
        }
    }

    startMusic() {
        if (this.music&&this.soundsLoaded) {
            this.music.volume=this.getEffectiveMusicVolume();
            this.music.play().catch(e => console.warn('Music play failed', e));
        }
    }

    stopMusic() {
        if (this.music) {
            this.music.pause();
            this.music.currentTime=0; // Reset to beginning
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
