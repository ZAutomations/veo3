const M=require('./motivational_metaphor');
const applies=story=>story?.motivational_ready_import===true;
function validate(source){
 if(source.seconds!==8||![2,4].includes(source.clips.length))throw Error('3D Motivational ready scripts need exactly 2 or 4 clips of 8 seconds (16s or 32s generated).');
 for(const key of ['left_label','right_label','footer_start','footer_end']){
  const value=source[key]||'';
  if(!value.trim()||value.trim().split(/\s+/).length>(key.includes('label')?3:5))throw Error('3D Motivational requires short Left label:, Right label:, Footer start: and Footer end: fields (labels up to 3 words; footers up to 5).');
 }
 if(source.footer_start===source.footer_end)throw Error('Footer end must change at the final payoff.');
 if(/mindset\s*101/i.test([source.left_label,source.right_label,source.footer_start,source.footer_end].join(' ')))throw Error('MINDSET 101 branding is not allowed.');
 for(const [i,c] of source.clips.entries()){
  if(!c.narration||c.dialogue.length||c.shots.length)throw Error('Clip '+c.number+': Motivational needs Narration: and one continuous Action:, not dialogue or timed Shot fields.');
  for(const key of ['start_state','action','end_state'])if(!c[key]?.trim())throw Error('Clip '+c.number+': supply Start state:, Action: and End state: for both Red and Green.');
  if(i&&c.start_state.trim()!==source.clips[i-1].end_state.trim())throw Error('Clip '+c.number+': Start state must exactly repeat the preceding End state to preserve task progress.');
 }
}
function scene(story,index,{aspect=story.aspect_ratio||'16:9',seconds=8}={}){
 const c=story.scenes[index];if(!c)throw Error('Missing motivational scene '+(index+1));
 const final=index===story.scenes.length-1;
 const lock=M.LOCK.replace('16:9',aspect&&aspect!=='Flow'?aspect:'the Flow-selected aspect ratio');
 return [
  'Generate ONE standalone '+seconds+'-second clip for scene '+(index+1)+' only. One continuous static shot, no internal cuts.',
  'FILM TOPIC: '+story.title,
  'STYLE: '+story.style+' PALETTE: '+story.palette,
  lock,
  'REFERENCES: @Red, @Green, @Plane. References preserve design, not a collage or turnaround sheet in the video.',
  ...M.CAST.map(c=>'IDENTITY '+c.name+': '+c.description),
  'LABELS: '+JSON.stringify(story.motivational_labels.left)+' above Red only; '+JSON.stringify(story.motivational_labels.right)+' above Green only. Keep labels unchanged.',
  final?'FOOTER: start with '+JSON.stringify(story.motivational_labels.footer_start)+'; change once to '+JSON.stringify(story.motivational_labels.footer_end)+' at the visible payoff by 6 seconds, then hold.':'FOOTER: '+JSON.stringify(story.motivational_labels.footer_start)+' throughout; no payoff footer yet.',
  'START STATE: '+c.start_state,
  'ACTION: '+c.imported_action,
  'END STATE: '+c.end_state,
  final?'Finish narration by 6 seconds. Hold the completed result with no speech or new action from 6-8 seconds, for optional trimming.':'Carry this exact ending state into the next clip; do not reset either task.',
  'AUDIO: One consistent off-screen narrator ('+story.narrator_voice+'). Read exactly: '+JSON.stringify(c.script_line)+'. On-screen adults stay silent, no lip-sync. Quiet task sounds only: '+(c.sound_context||'None')+'. No music.',
  'TEXT EXCEPTION: only the two archetype labels and footer. No MINDSET 101, subtitles, branding or extra captions. Keep task setbacks harmless, props away from bodies. No judgement that struggling people are inherently lazy.'
 ].join('\n\n')+'\n';
}
function agent(story,options={}){
 if(!applies(story))return null;
 const from=options.from||1,to=options.to||story.scenes.length;
 return 'Create exactly '+(to-from+1)+' separate eight-second clips for scenes '+from+'-'+to+'. Preserve their order and continuous task progress. Do not add, split, merge or rewrite clips.\n\n'+story.scenes.slice(from-1,to).map((s,i)=>scene(story,from+i-1,options)).join('\n\n');
}
function prepare(W,p,source,aspect){
 validate(source);
 p={...p,setting_name:'Plane',setting_prompt:p.style+' One empty matte white/pale-grey infinite plane, soft even overhead lighting and empty ground; no people, props, text or labels.'};
 const cast=W.normaliseCast(p,M.CAST);
 const scenes=source.clips.map(c=>({scene_title:c.title,script_line:c.narration,narrative_context:'START STATE: '+c.start_state+' ACTION: '+c.action+' END STATE: '+c.end_state,characters:['Red','Green']}));
 const story=W.buildStory(p,cast,{description:source.title,moral:'',place_name:'Plane',place_description:p.setting,place_prompt:p.style+' One empty matte white/pale-grey infinite plane, soft even overhead lighting and empty ground; no people, props, text or labels.'},scenes);
 story.motivational_ready_import=true;story.script_import=true;story.palette=p.palette;
 story.requested_duration_seconds=source.clips.length===2?15:30;
 story.trim_target_seconds=story.requested_duration_seconds;
 story.motivational_labels={left:source.left_label,right:source.right_label,footer_start:source.footer_start,footer_end:source.footer_end};
 story.scenes.forEach((s,i)=>{const c=source.clips[i];Object.assign(s,{script_line:c.narration,start_state:c.start_state,imported_action:c.action,end_state:c.end_state,sound_context:c.sound||'None'});s.veo3_prompt=scene(story,i,{aspect});});
 const warnings=source.clips.flatMap((c,i)=>{const words=c.narration.trim().split(/\s+/).length,limit=i===source.clips.length-1?14:22;return words>limit?['Clip '+c.number+': '+words+' narration words; shorten to '+limit+' or fewer'+(i===source.clips.length-1?' to leave the final silent hold.':'.')]:[];});
 return {W,p,cast,story,warnings};
}
module.exports={applies,validate,scene,agent,prepare};
