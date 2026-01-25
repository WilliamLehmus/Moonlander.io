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
        this.notificationVolume=0.5; // Default 50%
        this.isMining=false;
        this.miningLaserSound=null;
        this.isHeartbeatActive=false;
        this.heartbeatSound=null;
    }

    async loadSounds() {
        const soundFiles={
            crash1: '/Sounds/Crash1.mp3',
            crash2: '/Sounds/Crash2.mp3',
            crash3: '/Sounds/Crash3.mp3',
            crash4: '/Sounds/Crash4.mp3',
            ignite: '/Sounds/Thruster_ignite.mp3',
            thrust: '/Sounds/Constant_thrust.mp3',
            toggle_light: '/Sounds/toggle_light.mp3',
            notification: '/Sounds/message_notification_short.mp3',
            mining_laser: '/Sounds/mining_laser_small.mp3',
            death_music: '/Music/on_death_music.mp3',
            heartbeat: '/Sounds/heartbeat.mp3',
            ore_mined: '/Sounds/ore_mined.mp3',
            menu_pop: '/Sounds/menu_pop.mp3'
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

        // Setup loops
        if (this.sounds.thrust) this.sounds.thrust.loop=true;
        if (this.sounds.mining_laser) this.sounds.mining_laser.loop=true;
        if (this.sounds.heartbeat) this.sounds.heartbeat.loop=true;
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

    setNotificationVolume(vol) {
        this.notificationVolume=Math.max(0, Math.min(1, vol));
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

        if (this.sounds.notification) {
            this.sounds.notification.volume=this.masterVolume*this.notificationVolume;
        }
    }

    playMenuMusic() {
        if (!this.soundsLoaded) return;
        if (this.gameMusic) {
            this.gameMusic.pause();
            this.gameMusic.currentTime=0;
        }
        if (this.menuMusic) {
            this.menuMusic.volume=this.getEffectiveMusicVolume();
            this.menuMusic.play().catch(e => { });
        }
    }

    playGameMusic() {
        if (!this.soundsLoaded) return;
        if (this.menuMusic) {
            this.menuMusic.pause();
            this.menuMusic.currentTime=0;
        }
        if (this.gameMusic) {
            this.gameMusic.volume=this.getEffectiveMusicVolume();
            this.gameMusic.play().catch(e => { });
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
        const crashIdx=Math.floor(Math.random()*4)+1;
        this.playSound(`crash${crashIdx}`);
    }

    playSound(key, volumeScale=1.0) {
        if (!this.soundsLoaded||!this.sounds[key]) return;
        const sound=this.sounds[key];
        const clone=sound.cloneNode();
        clone.volume=this.getEffectiveSfxVolume()*volumeScale;
        clone.play().catch(e => { });
    }

    playNotification() {
        if (!this.soundsLoaded||!this.sounds.notification) return;
        this.sounds.notification.volume=this.masterVolume*this.notificationVolume;
        this.sounds.notification.play().catch(e => { });
    }

    setMining(mining) {
        if (!this.soundsLoaded||!this.sounds.mining_laser) return;
        if (mining&&!this.isMining) {
            this.isMining=true;
            this.sounds.mining_laser.volume=this.getEffectiveSfxVolume();
            this.sounds.mining_laser.play().catch(e => { });
        } else if (!mining&&this.isMining) {
            this.isMining=false;
            this.sounds.mining_laser.pause();
            this.sounds.mining_laser.currentTime=0;
        }
    }

    setHeartbeat(active) {
        if (!this.soundsLoaded||!this.sounds.heartbeat) return;
        if (active&&!this.isHeartbeatActive) {
            this.isHeartbeatActive=true;
            this.sounds.heartbeat.volume=this.getEffectiveSfxVolume();
            this.sounds.heartbeat.play().catch(e => { });
        } else if (!active&&this.isHeartbeatActive) {
            this.isHeartbeatActive=false;
            this.sounds.heartbeat.pause();
            this.sounds.heartbeat.currentTime=0;
        }
    }

    playDeathMusic() {
        if (!this.soundsLoaded||!this.sounds.death_music) return;
        this.stopAllMusic();
        this.sounds.death_music.volume=this.getEffectiveMusicVolume();
        this.sounds.death_music.play().catch(e => { });
    }

    setThrust(thrusting) {
        if (!this.soundsLoaded) return;
        if (thrusting&&!this.isThrusting) {
            this.isThrusting=true;
            if (this.sounds.ignite) {
                const ignite=this.sounds.ignite.cloneNode();
                ignite.volume=this.getEffectiveSfxVolume();
                ignite.play().catch(e => { });
            }
            if (this.sounds.thrust) {
                this.sounds.thrust.currentTime=0;
                this.sounds.thrust.volume=this.getEffectiveSfxVolume();
                this.sounds.thrust.play().catch(e => { });
            }
        } else if (!thrusting&&this.isThrusting) {
            this.isThrusting=false;
            if (this.sounds.thrust) {
                this.sounds.thrust.pause();
                this.sounds.thrust.currentTime=0;
            }
        }
    }
}
