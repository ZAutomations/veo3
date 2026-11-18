'use strict';
const overlays=require('./geography_overlay_contract'),X=require('./external_visual_contract');
const n=v=>Number(Number(v).toFixed(3));
function cameraPlan(scene,seconds){
 const candidates=(scene.shots||[]).map((shot,index)=>({shot,index,span:Number(shot.end_seconds)-Number(shot.start_seconds)})).filter(x=>x.span>=2.8&&x.shot.start_seconds>=0&&x.shot.end_seconds<=seconds+.001);
 if(!candidates.length)return null;
 const subjects=/\b(?:armou?red (?:models?|miniatures?|vehicles?)|(?:coalition )?tanks?|aircraft(?: models?)?|fighter jets?|ships?|tankers?|vessels?|hikers?|travell?ers?|animals?|bridges?|factory roofs|buildings?|river(?: channel)?|mountain pass|city blocks|port)\b/i;
 candidates.sort((a,b)=>Number(subjects.test(b.shot.visual))-Number(subjects.test(a.shot.visual))||b.span-a.span);
 const {shot,index,span}=candidates[0],match=String(shot.visual).match(subjects);
 const target=match?match[0]:'the main visible geographic feature in this shot';
 const begin=n(Number(shot.start_seconds)+Math.min(.15,span*.06)),inside=n(begin+.3),hold=n(inside+Math.min(2.8,span-.8)),outside=n(hold+.3);
 return {shot:index,target,begin,inside,hold,outside,text:`CAMERA PHASES — ${begin}-${inside}s: RAPID ZOOM/DOLLY IN directly onto ${target}; make the physical target about 3 TIMES larger, from regional overview to a readable local close-up. ${inside}-${hold}s: STOP camera travel and HOLD that same readable close framing for the ENTIRE scheduled interval while the physical action continues. Keep the same target centred and large; no pan to another subject, early pull-back, orbit or scale drift during HOLD. Labels/highlights settle after zoom-in and stay readable throughout this hold. This is an active close-up, not a frozen frame. ${hold}-${outside}s: RAPID ZOOM/DOLLY OUT to the preceding wider geographic context. Then continue the supplied track to the next target. This complete IN / HOLD / OUT cycle is mandatory inside this shot, not a slow pan, label enlargement, moving arrow, subject scale animation or editing transition.`};
}
function cleanShot(shot){
 let text=String(shot.visual||'');
 // Remove only known repeated rendering/camera boilerplate. Preserve physical
 // action, geography, dates and exact label requirements from the supplied shot.
 for(const rule of [/Use a restrained glowing pointer and hold the feature in frame; complete a motivated[^.]*\./gi,/Preserve natural olive\/green land[^.]*\./gi,/Physical miniatures move before explanatory arrows\./gi,/No unsupported target, invented casualty or hard cut\./gi,/Show mentioned exact dates\/places at their spoken English beat\./gi])text=text.replace(rule,'');
 text=text.replace(/At approximately (\d+(?:\.\d+)?)s/gi,(_,v)=>{const at=Number(v),lo=Number(shot.start_seconds),hi=Number(shot.end_seconds);return `At ${n(at>=lo&&at<hi?at:Math.min(hi-.05,lo+.2))}s`;});
 return text.replace(/\s+/g,' ').trim();
}
function scene(story,index,{seconds=story.scene_seconds,aspect=story.aspect_ratio}={}){
 const s=story.scenes[index],camera=cameraPlan(s,seconds);
 const names=[...(s.characters||[]),story.place?.name].filter(Boolean);
 const cues=overlays.cues(s,seconds);
 const events=X.sourceEvents(story,s);
 return [`Generate ONE ${seconds}-second standalone geography animation, ${aspect}, scene ${index+1}. External narration is already recorded; generate no speech or voice asset.`,
 'TOOL CALL COPY REQUIREMENT: Preserve every numbered SHOT and its CAMERA PHASES verbatim in this scene video-generation tool prompt. Do not shorten the zoom cycle into a pan/track instruction. Copy this scene asset ID as metadata and preserve the requested model, resolution and duration controls.',
 'LOOK: geographically accurate natural 2.5D atlas terrain, ordinary blue water, green/earth relief. Render the actual supplied moving subjects and local structures as clear dimensional miniatures. Vivid coordinated cyan/coral/gold/violet overlay accents; natural terrain does not mute the overlays.',
 `REFERENCES: ${names.map(v=>'@'+v).join(', ')||'Use only the supplied designs'}. Reference design applies only to matching subjects/settings; no image-sheet reproduction.`,
 camera?`MANDATORY FEATURE REVEAL: Shot ${camera.shot+1}, focus ${camera.target}. ${camera.text}`:'CAMERA: No supplied shot has space for a readable 2-second close-up plus zoom travel. Preserve the shot actions with a stable readable view; do not insert a blink-fast zoom cycle or invent an extra shot.',
 ...(s.shots||[]).map((shot,i)=>`SHOT ${i+1} (${shot.start_seconds}-${shot.end_seconds}s): ${cleanShot(shot)}${camera?.shot===i?' '+camera.text:''}`),
 'SHOT CONNECTIONS: Travel continuously between the specified geographic targets using an in-camera pan/track or foreground occlusion. No hard internal cut, geographic teleportation or morph. Other shot boundaries do not cancel the scheduled close-up hold and return.',
 'SUBJECT/ACTION: A line or label cannot replace a named tank, aircraft, vessel, traveller, animal, bridge, river or building. Render and animate only the objects and actions supplied in these shots; no invented fighting, launches, people, casualties or targets. Show a readable local diorama for the explanation, then restore regional orientation.',
 'GRAPHICS + SFX: Use colourful ROUND pictogram medallions anchored beside their visible subjects, with animated cyan-violet-gold neon OUTER CIRCLE and orbiting arc. Spring-scale entry with audible POPUP; hold the still pictogram while rim light moves; contract rim and shrink out with audible SWOOSH. Track the actual explained object/feature with a neon circle/oval or silhouette outline. Exact short place labels sit beside circular locators; dates/numbers type on with audible typewriter ticks. At most two annotation groups visible; do not replace physical action with badges.',
 cues.length?'MATCHING SUBJECT BADGES: '+cues.map(c=>c.icon).join('; '):'',
 !events.length&&s.effect&&s.effect!=='None'?'SUPPLIED VISUAL EFFECT: '+X.visualNotes(s.effect):'',
 !events.length&&X.sfxOnly(s.sound||s.sound_context)?'SUPPLIED NON-VOCAL SFX: '+X.sfxOnly(s.sound||s.sound_context):'',
 ...events.map(e=>`SUPPLIED EFFECT/SFX OVERLAP: clip ${e.start_seconds}-${e.end_seconds}s maps to source beat ${e.source_beat}, source time ${e.source_start_seconds}-${e.source_end_seconds}s. Use only relevant events in this overlap: ${X.visualNotes(e.effect)}. Non-vocal SFX: ${X.sfxOnly(e.sound)}.`),
 'FACTUAL TREATMENT: Illustrative educational map reconstruction, never archival/live evidence. Preserve supplied dates, source attribution and uncertainty. No invented quotations, current-event outcomes, personal accusations or public-figure likenesses. Identify a named public figure with the supplied name/role beside the relevant institution or map, not an invented portrait.',
 'AUDIO: Non-vocal scene-matched effects, popup/swoosh and typewriter ticks only. NO narration, dialogue, speech, whispering, singing or music; no spoken reading of labels. Keep the full runtime active, preserve supplied facts, exact text and real geography. No extra clip or frozen ending.'
 ].filter(Boolean).join('\n\n');
}
module.exports={scene,cameraPlan,cleanShot};
