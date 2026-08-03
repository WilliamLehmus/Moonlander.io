// Story.js
//
// Depth-triggered transmissions that explain why anyone would fly a lander four
// kilometres into a moon. Beats fire once per game, for everyone at once, keyed
// to the deepest point the team has reached -- so in co-op the story follows the
// expedition rather than whoever happens to be looking.
//
// Tone is deliberately B-movie corporate sci-fi: the Consortium wants Helium-3,
// something under the regolith wants company, and middle management is the last
// to notice.

export const STORY_BEATS=[
    {
        id: 'briefing',
        depth: 0,
        from: 'TRANQUILITY DEEP MINING CONSORTIUM',
        title: 'WELCOME TO SITE 7',
        lines: [
            'Congratulations on your assignment to Lunar Extraction Site 7.',
            'Your quota is Helium-3. Your contract is nine months. Your lander is insured; you are not.',
            'Ignore any seismic readings from below 4,000m. They are equipment error.'
        ]
    },
    {
        id: 'shallow',
        depth: 510,
        from: 'SITE 7 // AUTOMATED SURVEY',
        title: 'SOMETHING IN THE ROCK',
        lines: [
            'Survey drones report the shallow caves are not natural.',
            'The tunnels branch like something was looking for a way UP.',
            'Consortium guidance: continue mining. Do not speculate.'
        ]
    },
    {
        id: 'deep',
        depth: 1385,
        from: 'DR. VOSS // GEOLOGY (UNAUTHORISED CHANNEL)',
        title: 'IT IS NOT EQUIPMENT ERROR',
        lines: [
            'The seismic pattern repeats every 11 hours. It is not tectonic.',
            'I ran it through a filter. It is counting. Downward.',
            'It reached zero once already. Then it started again. Keep digging -- I need to know what happens at zero.'
        ]
    },
    {
        id: 'crystal',
        depth: 2255,
        from: 'DR. VOSS // GEOLOGY',
        title: 'THE CRYSTALS ARE A RECORDING',
        lines: [
            'The Bitite lattice down here is grown, not formed. It stores structure the way a disc stores sound.',
            'I played some back. It is the same eleven-hour count, but older. Much older.',
            'Whatever is at the core has been waiting a very long time for someone with a drill.'
        ]
    },
    {
        id: 'abyss',
        depth: 3130,
        from: 'CONSORTIUM BOARD // PRIORITY OVERRIDE',
        title: 'CONTRACT AMENDED',
        lines: [
            'Helium-3 quota suspended. New objective: reach the core and establish contact.',
            'Dr. Voss is no longer with the Consortium. Her channel is closed.',
            'Hazard pay has been approved. Your families have been notified of the adjustment.'
        ]
    },
    {
        id: 'core_approach',
        depth: 4000,
        from: '— — — UNKNOWN ORIGIN — — —',
        title: 'THE COUNT REACHES ZERO',
        lines: [
            'YOU CAME DOWN THE WAY WE MADE FOR YOU.',
            'WE BUILT THE TUNNELS. WE SEEDED THE ORE. WE MADE THE MOON HOLLOW SO YOU WOULD HAVE SOMEWHERE TO ARRIVE.',
            'COME THE REST OF THE WAY. WE HAVE BEEN SO ALONE.'
        ]
    }
];

// The line delivered on the victory screen when the core is reached.
export const CORE_REVEAL={
    id: 'core',
    from: '— — — THE CORE — — —',
    title: 'CONTACT',
    lines: [
        'The chamber is warm. The walls are not rock.',
        'Something enormous turns over, and is glad.',
        'Site 7 reports all quotas met.'
    ]
};

export class Story {
    constructor(game) {
        this.game=game;
        this.fired=new Set();
        this.deepestReached=0;
    }

    // Called each tick. Fires any beat the team has now passed.
    update() {
        let deepest=this.deepestReached;
        for (const player of this.game.players.values()) {
            if (player.dead) continue;
            const d=this.game.voxelMap.getDepthMeters(player.y);
            if (d>deepest) deepest=d;
        }
        if (deepest<=this.deepestReached&&this.fired.size>0) return;
        this.deepestReached=deepest;

        for (const beat of STORY_BEATS) {
            if (this.fired.has(beat.id)) continue;
            if (deepest<beat.depth) continue;
            this.fired.add(beat.id);
            this.game.broadcast('storyBeat', {
                id: beat.id,
                from: beat.from,
                title: beat.title,
                lines: beat.lines,
                depth: Math.max(0, Math.round(deepest))
            });
        }
    }

    serialize() {
        return {fired: Array.from(this.fired), deepest: Math.round(this.deepestReached)};
    }
}
