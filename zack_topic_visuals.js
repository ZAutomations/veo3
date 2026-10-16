const CONTRACT = `TOPIC-LED VISUALS: The film title and narration define the subject; the 3D style defines only rendering. In every clip show the specific people, objects, places and consequences named in that clip, while preserving the main hypothetical premise and continuity established by the opening. Write a concrete visible action and result for each shot. A social or human scenario needs human reactions and recognisable environments, not generic factories, circuitry, gears, dashboards, laboratories or mechanical cutaways. Use technical diagrams or cross-sections only when the narration actually explains a physical mechanism or anatomy. Do not convert a room or an emotion into a machine. Do not repeat the same shot description with a different angle and call it a new idea. Define location references from actual story settings, never stock labels such as Mechanism Cutaway for a non-mechanical topic. A reference supplies design consistency; its contents must not replace the scene's required setting. Preserve the stated hypothetical population and world conditions across all scenes; do not reintroduce vanished people in later scenes unless explicitly showing a clearly separated before-state. Check every shot against both its narration and the overall premise before delivery.`;
function validate(source) {
    for (const clip of source.clips || []) {
        for (const shot of clip.shots || []) {
            if (/cross-section or physical consequence of/i.test(shot.visual)) {
                throw Error(`Clip ${clip.number}: generic "cross-section or physical consequence" template is not a concrete shot. Rewrite each shot for "${source.title}" before importing; specify what is visible and what changes.`);
            }
        }
    }
}
module.exports={CONTRACT,validate};
