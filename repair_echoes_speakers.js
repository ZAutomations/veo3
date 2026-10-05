// One-time repair requested by the user: preserve words, reverse misassigned roles.
const fs = require('fs');
const path = require('path');
const W = require('./write_story');
const E = require('./extend_prompts');
const D = require('./dialogue_speakers');
const folder = path.join(__dirname, 'stories', 'echoes_of_trust');
const file = path.join(folder, 'echoes_of_trust_story.json');
const story = JSON.parse(fs.readFileSync(file, 'utf8'));
if (story.speaker_roles_corrected) throw Error('Speaker repair has already been applied; refusing to swap again.');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
for (const name of ['echoes_of_trust_story.json', 'extend_prompts.json', 'agent_prompt.txt', 'style_bible.md']) {
    const target = path.join(folder, name);
    if (fs.existsSync(target)) fs.copyFileSync(target, target + '.before-speaker-fix-' + stamp);
}
const preset = W.loadPreset('relationship-dialogue-ghibli');
const before = story.scenes.flatMap(s => s.dialogue.map(d => d.line));
for (const [index, scene] of story.scenes.entries()) {
    scene.dialogue = scene.dialogue.map(d => ({ ...d, speaker: d.speaker === 'George' ? 'Sarah' : d.speaker === 'Sarah' ? 'George' : d.speaker }));
    const turns = scene.dialogue.map(d => d.speaker).join(', then ');
    scene.narrative_context = `${story.place.description} ${story.blocking} Both remain in their established seats with small natural gestures and attentive expressions. Conversation beat ${index + 1}: speaking order is ${turns}. Each person speaks their own assigned words while the other listens. Keep a balanced eye-level two-shot without changing positions.`;
    scene.veo3_prompt = `[SHOT] ${scene.narrative_context}\n[LOOK] ${story.style}\n[AUDIO] ${D.speakerLock(preset)}`
        + scene.dialogue.map(d => `${d.speaker} (on screen, speaking): "${d.line}"`).join('  ');
}
require('assert').deepStrictEqual(story.scenes.flatMap(s => s.dialogue.map(d => d.line)), before);
story.speaker_roles_corrected = 'User correction: Sarah owns the question turns; George owns the answer turns. Dialogue wording unchanged.';
const derived = E.deriveExtendPrompts(story);
if (!derived.ok || Object.keys(derived.prompts).length !== story.scenes.length - 1) throw Error('Continuation prompt derivation failed.');
fs.writeFileSync(file, JSON.stringify(story, null, 2) + '\n');
fs.writeFileSync(path.join(folder, 'extend_prompts.json'), JSON.stringify({
    note: 'Corrected speaker roles. Sarah = female; George = male. Exact dialogue ownership must be preserved.',
    derivedFrom: path.basename(file), droppedBlock: derived.block, prompts: derived.prompts,
}, null, 2) + '\n');
const bible = path.join(folder, 'style_bible.md');
if (fs.existsSync(bible)) {
    let text = fs.readFileSync(bible, 'utf8');
    text = text.replace(/\*\*(Sarah|George):\*\*/g, (_, who) => `**${who === 'Sarah' ? 'George' : 'Sarah'}:**`);
    text += '\n\n## Speaker correction\n\nSarah is the female question speaker. George is the male answer speaker. Follow the corrected story JSON and dialogue labels. Earlier generated clips retain their original audio.\n';
    fs.writeFileSync(bible, text);
}
console.log(`Corrected ${story.scenes.length} scenes and ${Object.keys(derived.prompts).length} Extend prompts; all spoken words preserved. Backups saved.`);
