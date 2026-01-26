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

        this.isTransferring=false;
        this.transferSound=null;
        this.refinerySound=null;
        this.isRefining=false;
        this.lowFuelWarningSound=null;
        this.isLowFuelWarningActive=false;
        this.hasPlayedOutOfFuel=false; // Track if out_of_fuel sound has been played

        // Music blending
        this.musicTracks=[];
        this.currentTrackIndex=-1;
        this.isChangingTrack=false;
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
            menu_pop: '/Sounds/menu_pop.mp3',
            transfer_cargo: '/Sounds/transfer_cargo.mp3',
            refueling1: '/Sounds/refueling1.mp3',
            refueling2: '/Sounds/refueling2.mp3',
            power_down: '/Sounds/power_down.mp3',
            refinery: '/Sounds/refinery.mp3',
            low_fuel_warning: '/Sounds/low_fuel_warning.mp3',
            jettison: '/Sounds/jettison.mp3',
            out_of_fuel: '/Sounds/out_of_fuel.mp3'
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
        if (this.sounds.transfer_cargo) {
            this.sounds.transfer_cargo.loop=true;
            this.sounds.transfer_cargo.playbackRate=1.5;
        }
        if (this.sounds.refinery) this.sounds.refinery.loop=true;
        if (this.sounds.low_fuel_warning) this.sounds.low_fuel_warning.loop=true;

        // Load all music tracks
        const musicPaths=['/Music/Track1.mp3', '/Music/Track2.mp3', '/Music/Track3.mp3', '/Music/Track4.mp3'];
        this.musicTracks=musicPaths.map(src => {
            const audio=new Audio(src);
            audio.loop=false; // We handle looping by switching tracks
            audio.addEventListener('ended', () => this.playNextTrack());
            return audio;
        });

        const musicLoadPromises=this.musicTracks.map(audio => {
            return new Promise(resolve => {
                audio.addEventListener('canplaythrough', () => resolve(audio), {once: true});
                audio.addEventListener('error', () => resolve(null));
                audio.load();
            });
        });

        await Promise.all(musicLoadPromises);
        this.soundsLoaded=true;
        console.log('Sounds and Music loaded');
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

        const musicVol=this.getEffectiveMusicVolume();
        this.musicTracks.forEach(track => {
            if (track) track.volume=musicVol;
        });

        if (this.sounds.death_music) {
            this.sounds.death_music.volume=musicVol;
        }

        if (this.sounds.notification) {
            this.sounds.notification.volume=this.masterVolume*this.notificationVolume;
        }
    }

    playMenuMusic() {
        if (!this.soundsLoaded) return;
        this.playTrack(0); // Track1 is menu music
    }

    playGameMusic() {
        if (!this.soundsLoaded) return;
        // If already playing a track > 0, don't restart
        if (this.currentTrackIndex>0) return;
        this.playTrack(1); // Start with Track2
    }

    playTrack(index) {
        if (this.currentTrackIndex===index&&!this.isChangingTrack) return;

        const oldTrack=this.currentTrackIndex>=0? this.musicTracks[this.currentTrackIndex]:null;
        const newTrack=this.musicTracks[index];

        if (!newTrack) return;

        this.isChangingTrack=true;
        this.currentTrackIndex=index;

        // Blending/Crossfade
        if (oldTrack) {
            this.fadeOut(oldTrack, 2000);
        }

        newTrack.currentTime=0;
        newTrack.volume=0;
        newTrack.play().catch(e => { });
        this.fadeIn(newTrack, this.getEffectiveMusicVolume(), 2000).then(() => {
            this.isChangingTrack=false;
        });
    }

    playNextTrack() {
        // Loop tracks 1, 2, 3 (skip Track1 which is menu music, unless it's intended to be in rotation)
        // Actually the GDD says "Add two new music tracks (Track3 & Track4). Implement blending".
        // It implies Track1-4 should be used.
        let nextIndex=(this.currentTrackIndex+1)%this.musicTracks.length;
        // Maybe skip Track 1 (index 0) if we are in game?
        if (nextIndex===0) nextIndex=1;
        this.playTrack(nextIndex);
    }

    fadeIn(audio, targetVolume, duration) {
        return new Promise(resolve => {
            const startVolume=audio.volume;
            const startTime=performance.now();

            const animate=(now) => {
                const elapsed=now-startTime;
                const progress=Math.min(elapsed/duration, 1);
                audio.volume=startVolume+(targetVolume-startVolume)*progress;

                if (progress<1) {
                    requestAnimationFrame(animate);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }

    fadeOut(audio, duration) {
        return new Promise(resolve => {
            const startVolume=audio.volume;
            const startTime=performance.now();

            const animate=(now) => {
                const elapsed=now-startTime;
                const progress=Math.min(elapsed/duration, 1);
                audio.volume=startVolume*(1-progress);

                if (progress<1) {
                    requestAnimationFrame(animate);
                } else {
                    audio.pause();
                    resolve();
                }
            };
            requestAnimationFrame(animate);
        });
    }

    stopAllMusic() {
        this.musicTracks.forEach(track => {
            if (track) {
                track.pause();
                track.currentTime=0;
            }
        });
        this.currentTrackIndex=-1;
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

    setTransferring(active) {
        if (!this.soundsLoaded||!this.sounds.transfer_cargo) return;
        if (active&&!this.isTransferring) {
            this.isTransferring=true;
            this.sounds.transfer_cargo.volume=this.getEffectiveSfxVolume();
            this.sounds.transfer_cargo.play().catch(e => { });
        } else if (!active&&this.isTransferring) {
            this.isTransferring=false;
            this.sounds.transfer_cargo.pause();
            this.sounds.transfer_cargo.currentTime=0;
        }
    }

    setRefueling(active) {
        if (!this.soundsLoaded) return;
        if (active) {
            // Play one of the two refueling sounds randomly if not already playing
            if (this.sounds.refueling1.paused&&this.sounds.refueling2.paused) {
                const sound=Math.random()>0.5? this.sounds.refueling1:this.sounds.refueling2;
                sound.volume=this.getEffectiveSfxVolume();
                sound.play().catch(e => { });
            }
        } else {
            this.sounds.refueling1.pause();
            this.sounds.refueling1.currentTime=0;
            this.sounds.refueling2.pause();
            this.sounds.refueling2.currentTime=0;
        }
    }

    setRefining(active) {
        if (!this.soundsLoaded||!this.sounds.refinery) return;
        if (active&&!this.isRefining) {
            this.isRefining=true;
            this.sounds.refinery.volume=this.getEffectiveSfxVolume();
            this.sounds.refinery.play().catch(e => { });
        } else if (!active&&this.isRefining) {
            this.isRefining=false;
            this.sounds.refinery.pause();
            this.sounds.refinery.currentTime=0;
        }
    }

    setLowFuelWarning(active) {
        if (!this.soundsLoaded||!this.sounds.low_fuel_warning) return;
        if (active&&!this.isLowFuelWarningActive) {
            this.isLowFuelWarningActive=true;
            this.sounds.low_fuel_warning.volume=this.getEffectiveSfxVolume();
            this.sounds.low_fuel_warning.play().catch(e => { });
        } else if (!active&&this.isLowFuelWarningActive) {
            this.isLowFuelWarningActive=false;
            this.sounds.low_fuel_warning.pause();
            this.sounds.low_fuel_warning.currentTime=0;
        }
    }

    playPowerDown() {
        this.playSound('power_down');
    }

    setThrust(thrusting, hasFuel=true) {
        if (!this.soundsLoaded) return;

        // Don't play thrust sound if no fuel
        if (!hasFuel) {
            if (this.isThrusting) {
                this.isThrusting=false;
                if (this.sounds.thrust) {
                    this.sounds.thrust.pause();
                    this.sounds.thrust.currentTime=0;
                }
            }
            return;
        }

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

    // Play out of fuel sound (only once per fuel depletion)
    playOutOfFuel() {
        if (!this.soundsLoaded||!this.sounds.out_of_fuel||this.hasPlayedOutOfFuel) return;
        this.hasPlayedOutOfFuel=true;
        this.playSound('out_of_fuel');
    }

    // Reset out of fuel flag when refueled
    resetOutOfFuel() {
        this.hasPlayedOutOfFuel=false;
    }
}
