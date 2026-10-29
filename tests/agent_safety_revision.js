const assert=require('assert'),fs=require('fs');
const instructions=require('../agent_safety_revision');
assert(instructions.includes('ONE substantive safety revision'));
assert(instructions.includes('If it is refused again, stop'));
assert(instructions.includes('Do not use euphemisms'));
assert(instructions.includes('If narration also needs changing'));
assert(instructions.includes('never repeat the whole batch'));
const mode=fs.readFileSync(require.resolve('../agent_mode'),'utf8');
assert(mode.indexOf("require('./agent_safety_revision')")<mode.indexOf('pasteAgentPrompt(page, installAgentEditor, SEND_TEXT'));
assert(!mode.includes('Report a policy refusal without changing the script.'));
assert(!fs.readFileSync(require.resolve('../agent_missing_scenes'),'utf8').includes('Report any refusal without changing the script.'));
console.log('PASS: initial and missing-scene prompts receive bounded safety revision instructions; repeated refusal, rights restrictions and substantive narration changes require review.');

for (const term of ['PROMINENT-PEOPLE REFUSAL','not conceal the same identity','stop for review','completed and generating scenes untouched']) assert(instructions.includes(term), term);
for (const name of fs.readdirSync('Master prompts').filter(n=>n.endsWith('.txt'))) assert(fs.readFileSync('Master prompts/'+name,'utf8').includes('VEO POLICY-AWARE AUTHORING'),name);
