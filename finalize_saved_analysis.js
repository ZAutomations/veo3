// Explicit recovery from a user-selected saved analysis. Never analyses the link again.
const fs=require('fs'),path=require('path');
const W=require('./write_story');
function finalize(file,options={}) {
    const cm=JSON.parse(fs.readFileSync(file,'utf8'));
    const p=W.loadPreset(options.preset || cm.preset_suggestion);
    const seconds=Number(options.seconds || cm.format?.clip_seconds) || 8;
    const verified=require('./reference_duration').verifiedSeconds(cm);
    if(verified && require('./reference_duration').timingMismatch(cm,verified,seconds)) throw Error('Saved analysis timestamps disagree with verified video duration. Recover the correct analysis first.');
    const title=String(cm.title_suggestion || '').trim();
    if(!title)throw Error('Selected file has no analysis title_suggestion. Select the content-map JSON.');
    const dir=options.out || path.join(__dirname,'stories',W.slugify(title));
    fs.mkdirSync(dir,{recursive:true});
    if(fs.existsSync(path.join(dir,W.slugify(title)+'_story.json'))){
        const backup=path.join(dir,'backups','before_finalize_'+Date.now());fs.mkdirSync(backup,{recursive:true});
        for(const name of fs.readdirSync(dir))if(fs.statSync(path.join(dir,name)).isFile())fs.copyFileSync(path.join(dir,name),path.join(backup,name));
    }
    if(!p.grounded_dialogue || !W.hasSourceDialogue(cm)) {
        const args=[path.join(__dirname,'write_story.js'),'--content-map',path.resolve(file),'--preset',p.id,'--title',title,'--out',dir,'--seconds',String(seconds),'--transport',options.transport||'web'];
        if(verified)args.push('--duration',String(Math.ceil(verified/seconds)*seconds));
        if(options.aspect)args.push('--aspect',options.aspect);
        require('child_process').execFileSync(process.execPath,args,{stdio:'inherit',windowsHide:true});
        return path.join(dir,W.slugify(title)+'_story.json');
    }
    const cast=require('./realistic_couple').apply(p,['Sarah','George'].map(name=>({name,type:'human',gender:name==='Sarah'?'female':'male'})));
    const map=require('./dialogue_speakers').sourceSpeakerMap(W.contentMapClips(cm),cast,p);
    const clips=W.contentMapClips(cm);
    const scenes=clips.map((c,i)=>({scene_title:c.title || `Conversation ${i+1}`,characters:['Sarah','George'],
        dialogue:(c.source_dialogue||[]).map(d=>({speaker:map.get(d.speaker)||d.speaker,line:String(d.line||'').trim()})),
        narrative_context:String(c.visual||'Natural conversation in the established room.') }));
    const meta={description:'A couple discusses relationship expectations, personal boundaries and mutual respect.',moral:'A partnership requires mutual respect and freely chosen boundaries.',target_audience:p.audience,
        place_name:'Diningroom',place_description:'A bright detailed dining room with warm cream and ivory walls, a walnut table, separate comfortable chairs and clear natural daylight. Both adults have natural conversational space.',
        place_prompt:'Empty bright cream and ivory dining room with a walnut table, separate chairs and natural daylight.',
        blocking:require('./relationship_composition').COMPOSITION,
        thumbnail:{headline:title.split(/\s+/).slice(0,5).join(' '),visual_concept:'The same two reference characters in the established dining room, with a clear contrast between an imposing demand and a calm confident boundary.'}};
    const story=W.buildStory(p,cast,meta,scenes);
    story.title=title;story.aspect_ratio=options.aspect||'Flow';story.scene_seconds=seconds;story.video_duration=`${scenes.length*seconds} seconds`;
    story.scenes.forEach((s,i)=>{const t=n=>`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;s._timing=`${t(i*seconds)}-${t((i+1)*seconds)}`;});
    story.source_video=cm.source_url||cm.source_metadata?.url||'';
    story.source_dialogue_fidelity='All dialogue and speaker labels copied from the user-selected saved analysis in its original order.';
    story.source_analysis_notes=cm.notes||'';
    story.source_verification=require('./reference_duration').sourceUnavailable(cm)?'Saved analysis used by explicit recovery; source dialogue not independently verified.':'Saved analysis; no new video analysis performed.';
    const errors=W.validate(story,cast,p);if(errors.length)throw Error(errors.join('\n'));
    const output=W.writePackage(dir,p,story,cast);
    fs.copyFileSync(file,path.join(dir,'recovered_source_analysis.json'));
    fs.writeFileSync(path.join(dir,'cast_and_outline.json'),JSON.stringify({characters:cast,outline:scenes.map((s,i)=>({scene:i+1,title:s.scene_title,beat:s.dialogue.map(d=>`${d.speaker}: ${d.line}`).join(' ')}))},null,2));
    require('child_process').execFileSync(process.execPath,[path.join(__dirname,'story_to_agent_prompt.js'),output,'--aspect',story.aspect_ratio],{stdio:'inherit',windowsHide:true});
    console.log(`FINALIZED: ${output}\n${scenes.length} clips / ${scenes.length*seconds}s. No video reread or Gemini request was needed.\nSource verification: ${story.source_verification}`);
    return output;
}
if(require.main===module){
    const args=process.argv.slice(2),flag=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined};
    try{if(!args[0])throw Error('Usage: node finalize_saved_analysis.js <content-map.json> [--preset id] [--aspect 9:16]');finalize(args[0],{preset:flag('--preset'),aspect:flag('--aspect'),transport:flag('--transport')});}
    catch(e){console.error('FINALIZATION FAILED: '+e.message);process.exitCode=1;}
}
module.exports={finalize};
