/* UI adapter for the original VideoAuotmation settings and ASS renderer. */
let editingData=null,editingSession=null,editingLoad=0,editingTimer,editingFrameBusy=false,editingQueued=false;
const editingStyles=[
 {id:'pop',label:'Bold Pop',preset:'frameloom_bold_pop',animation:'highlight',sample:'WORD <em>POP</em>'},
 {id:'karaoke',label:'Karaoke Fill',preset:'frameloom_karaoke',animation:'karaoke',sample:'<em>Sing</em> along'},
 {id:'one',label:'One Word Punch',preset:'frameloom_one_word',animation:'one_word',sample:'<em>BOOM</em>'},
 {id:'box',label:'Highlighter Box',preset:'frameloom_highlighter',animation:'highlight',sample:'THE <mark>BOX</mark>'},
 {id:'rise',label:'Smooth Rise',preset:'frameloom_smooth_rise',animation:'none',sample:'<em>Smooth line</em>'}
];
const editingColors=[['Yellow','#FFE600'],['Green','#2BFF5A'],['Red','#FF304F'],['Cyan','#22D3EE'],['Pink','#F444D7'],['Orange','#FF9500'],['White','#FFFFFF']];

function editingControl(spec){
 const key=spec.key,id='edit-'+key,value=editingData.settings[key],label=esc(spec.label||key),attrs=`data-edit-key="${key}" id="${id}"`;
 if(typeof spec.default==='boolean')return `<label class="toggle-row"><input ${attrs} type="checkbox" ${value?'checked':''}><span>${label}</span></label>`;
 if(typeof spec.default==='number')return `<div class="field"><label for="${id}">${label}</label><div class="editing-number"><input type="range" data-edit-range="${key}" min="${spec.min??0}" max="${spec.max??200}" step="${spec.step||(.01)}" value="${esc(value)}"><input ${attrs} type="number" min="${spec.min??0}" max="${spec.max??10000}" step="${spec.step||'any'}" value="${esc(value)}"></div></div>`;
 let choices=spec.choices;
 if(key.startsWith('transition_sfx_')&&typeof value==='string')choices=editingData.sfx;
 if(key==='clipper_override_font_family')choices=['',...editingData.fonts];
 if(key==='clipper_caption_preset')choices=editingData.presets.map(p=>({id:p.id,name:p.label}));
 if(choices){return `<div class="field"><label for="${id}">${label}</label><select ${attrs}>${choices.map(c=>{const v=typeof c==='string'?c:c.id,n=typeof c==='string'?c||'Preset default':c.name;return `<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(n)}</option>`;}).join('')}</select></div>`;}
 if(key.endsWith('_color'))return `<div class="field"><label for="${id}">${label}</label><div class="input-row"><input ${attrs} value="${esc(value)}" placeholder="Preset default"><input type="color" data-edit-color="${key}" value="${/^#[a-f\d]{6}$/i.test(value)?value:'#FFFFFF'}" aria-label="Choose ${label}"><button type="button" class="button small" data-edit-reset="${key}">Reset</button></div></div>`;
 return `<div class="field"><label for="${id}">${label}</label><input ${attrs} value="${esc(value)}" placeholder="${key==='custom_sfx_file'?'Optional audio file path':''}"></div>`;
}

async function renderVideoEditing(){
 const version=++editingLoad;editingSession=null;
 $('main').innerHTML=heading('Finish the story.','Silence removal, camera transitions and Pro Captions, ported from Video Automation.','VIDEO EDITING')+'<p>Loading editing controls…</p>';
 try{editingData=await api('video-editing');if(current!=='editing'||version!==editingLoad)return;
 const byKey=new Map(editingData.schema.map(s=>[s.key,s]));
 const controls=keys=>keys.filter(k=>byKey.has(k)).map(k=>editingControl(byKey.get(k))).join('');
 const proKeys=editingData.schema.filter(s=>s.group==='Pro Captions (ASS)'&&s.key!=='clipper_captions_enabled').map(s=>s.key);
 const globalKeys=editingData.schema.filter(s=>s.group==='Global Settings').map(s=>s.key);
 const transGroups=new Map();
 for(const s of editingData.schema.filter(s=>s.page==='transitions')){if(!transGroups.has(s.group))transGroups.set(s.group,[]);transGroups.get(s.group).push(s.key);}
 $('main').innerHTML=heading('Finish the story.','Save your editing choices once. They apply after the normal verified join.','VIDEO EDITING')+`<form id="view-form" class="editing-layout">`+
 panel('Source & automatic finishing','The combined original is preserved; edited output is saved as a separate MP4.','01',`<div class="form-grid">${field('Combined video','editingVideo','',{full:true,placeholder:'Choose a combined video, or load one from a saved story.'})}<div class="field full"><div class="buttons"><button type="button" id="choose-editing-video" class="button">Browse video</button><button type="button" id="load-editing-story" class="button">Load selected story’s combined video</button></div></div>${field('Saved story','editingStory',preferences.selectedStory||'',{items:[{id:'',name:'Choose a saved story…'},...library.map(s=>({id:s.path,name:s.title}))],full:true})}</div><div class="options-grid">${toggle('editingAutoApply','Apply enabled editing features after every Join',editingData.settings.editing_auto_apply,'Applies to Agent, Ingredients, Single Clip Omni, and story batches. Settings are captured when the workflow starts.')}</div><p class="footer-note">Order: normal join → remove silence → transitions at verified clip boundaries → timed ASS captions.</p>`)+
 `<section class="panel editing-captions"><div class="panel-title editing-caption-heading"><span class="editing-caption-icon">▤</span><div><h2>Captions &amp; Subtitles</h2><small>Animated word-by-word captions burned into the final video</small></div><label class="editing-switch"><span id="editing-caption-on">Off</span><input type="checkbox" id="edit-clipper_captions_enabled" data-edit-key="clipper_captions_enabled" ${editingData.settings.clipper_captions_enabled?'checked':''}><i></i></label></div>
 <div class="editing-caption-grid"><div class="editing-caption-controls"><p class="editing-label">ANIMATED STYLE</p><div class="editing-style-tiles">${editingStyles.map(s=>`<button type="button" class="editing-style-tile" data-edit-style="${s.id}"><span class="editing-tile-sample editing-sample-${s.id}">${s.sample}</span><b>${s.label}</b></button>`).join('')}</div>
 <p class="editing-label">CAPTION COLOUR</p><div class="editing-color-chips">${editingColors.map(([name,color])=>`<button type="button" data-edit-swatch="${color}" class="editing-color-chip"><i class="editing-swatch-${name.toLowerCase()}"></i>${name}</button>`).join('')}</div>
 <div class="form-grid"><div><p class="editing-label">POSITION</p><div class="editing-segments">${[['bottom','Bottom'],['center','Middle'],['top','Top']].map(([v,n])=>`<button type="button" data-edit-position="${v}">${n}</button>`).join('')}</div></div><div><p class="editing-label">SIZE</p><div class="editing-segments">${[[57.6,'Small'],[72,'Medium'],[87.84,'Large']].map(([v,n])=>`<button type="button" data-edit-size="${v}">${n}</button>`).join('')}</div></div></div>
 <div class="form-grid">${controls(['caption_words_per_line'])}</div><p class="footer-note">Choose 1–5 words per caption phrase. Pauses and punctuation may end a phrase earlier. One Word Punch always shows one word.</p>
 </div><div class="editing-caption-preview"><p class="editing-label">LIVE PREVIEW</p><div class="editing-preview-stage"><img id="editing-preview-image" class="hidden" alt="Exact FFmpeg ASS caption preview"><video id="editing-preview-video" class="hidden" controls playsinline></video><span id="editing-preview-placeholder">Enable captions and load a preview to adjust the look.</span></div>
 <div class="editing-preview-toolbar"><button type="button" id="load-editing-preview" class="button">Load preview</button><button type="button" id="play-editing-preview" class="button" disabled>▶ Play 5-second caption preview</button><label><input type="checkbox" id="editingActualWords"> Use actual spoken words (local transcription)</label><span id="editing-preview-status" class="caption">Preview uses the same ASS renderer as export.</span></div>
 <div class="editing-preview-scrub"><input type="range" id="editingPreviewTime" min="0" max="8" step=".05" value="0"><span id="editing-preview-time">0.00s</span></div>
 ${field('Sample preview text','editingPreviewText',editingData.settings.editing_preview_text,{full:true})}</div></div>
 <details class="editing-advanced"><summary>Advanced caption settings</summary><div class="form-grid three">${controls([...proKeys,...globalKeys].filter(k=>k!=='caption_words_per_line'))}${field('Transcription model','editingWhisperModel',editingData.settings.editing_whisper_model,{items:['tiny','base','small','medium','large-v3']})}</div><p class="footer-note">The five cards use Frameloom’s fonts, word grouping and resolution-aware animations. Advanced legacy presets remain available in the dropdown. Sample text is for preview only; exported captions use the video’s spoken words.</p></details></section>`+
 panel('Standalone Silence Removal','Original detector, minimum silence and padding controls. Audio and video are cut together.','03',`<div class="options-grid">${controls(['silence_removal_enabled'])}</div><div class="form-grid three">${controls(['silence_threshold','silence_min_duration','silence_padding'])}</div><details><summary>Silence cut finishing options</summary><div class="form-grid">${controls(['silence_crossfade_enabled','silence_crossfade_duration','silence_skip_done'])}</div><p class="footer-note">Crossfade + click overlaps retained segments by the chosen duration, as in the source tool. Threshold-based removal follows the original tool; music can keep a gap above the threshold.</p></details>`)+
 panel('Camera Transitions','Automatic sideways pan/swipe between joined clips.','04',`<div class="options-grid">${controls(['editing_camera_enabled'])}</div><p class="footer-note">Works independently of Dissolve. No zoom or blur; original speech timing is preserved.</p>`)+
 panel('Dissolve Transition','A short blend between joined clips. Separate from camera movement.','05',`<div class="options-grid">${toggle('editingTransitionsEnabled','Enable dissolve between clips',editingData.settings.editing_transitions_enabled)}</div><p class="footer-note">ON: automatically blends verified clip joins. OFF: disables blending; camera transitions can still run. Video length and spoken audio timing are preserved.</p>`)+
 panel('Final Video Speed','Applied last, after silence removal, transitions and burned-in captions.','06',`<div class="form-grid">${controls(['editing_speed'])}</div><p id="editing-speed-label" class="caption"></p><p class="footer-note">0.15×–0.95× slows down; 1.00× is normal; 1.05×–2.00× speeds up. Audio and captions stay together; audio tempo changes without deliberately changing pitch. Caption frame previews show the original timeline; playable preview includes final speed.</p>`)+
 `<div class="action-bar"><div class="buttons"><button type="button" id="save-video-editing" class="button primary">Save editing settings</button><button type="button" id="render-video-editing" class="button dark">Apply editing to this video</button><button type="button" id="stop-video-editing" class="button danger">Stop editing</button></div><span class="caption" id="editing-save-status">Your original combined video is preserved.</span></div></form>`;
 restore();bindVideoEditing();setupCardVisibility();
 }catch(e){if(current==='editing')$('main').innerHTML=heading('Video Editing',e.message,'VIDEO EDITING');}
}

function collectEditing(){
 const cfg={...editingData.settings};
 document.querySelectorAll('[data-edit-key]').forEach(el=>{cfg[el.dataset.editKey]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;});
 cfg.editing_auto_apply=$('editingAutoApply').checked;cfg.editing_transitions_enabled=$('editingTransitionsEnabled').checked;
 cfg.editing_preview_text=$('editingPreviewText').value;cfg.editing_whisper_model=$('editingWhisperModel').value;
 return cfg;
}
function setEditingValue(key,value){const el=$('edit-'+key);if(!el)return;if(el.type==='checkbox')el.checked=!!value;else el.value=value;const range=document.querySelector(`[data-edit-range="${key}"]`);if(range)range.value=value;}
function refreshEditingButtons(){
 const cfg=collectEditing();$('editing-caption-on').textContent=cfg.clipper_captions_enabled?'On':'Off';
 const speedLabel=$('editing-speed-label');if(speedLabel){const speed=Number(cfg.editing_speed),percent=Math.round((speed-1)*100);speedLabel.textContent=`${speed.toFixed(2)}× · ${percent===0?'Normal speed':(percent>0?'+':'')+percent+'% · '+(percent<0?'Slower':'Faster')}`;}
 const fixedStyle=cfg.clipper_caption_preset.startsWith('frameloom_');
 for(const key of ['clipper_caption_animation','caption_layout','clipper_override_bg_enabled','clipper_override_bg_color','clipper_override_bg_opacity','clipper_override_primary_color','clipper_override_stroke_color','clipper_override_stroke','clipper_override_bold']){
  const el=$('edit-'+key);if(el){el.disabled=fixedStyle;el.title=fixedStyle?'This Frameloom style uses its original grouping, outline and animation. Select a legacy preset to customize these.':'';}
 }

 for(const b of document.querySelectorAll('[data-edit-style]')){const s=editingStyles.find(x=>x.id===b.dataset.editStyle);const selected=s.preset===cfg.clipper_caption_preset&&s.animation===cfg.clipper_caption_animation;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);}
 for(const b of document.querySelectorAll('[data-edit-swatch]'))b.classList.toggle('selected',b.dataset.editSwatch.toLowerCase()===(cfg.clipper_override_highlight_color||editingData.presets.find(p=>p.id===cfg.clipper_caption_preset)?.highlight_color||'').toLowerCase());
 for(const b of document.querySelectorAll('[data-edit-position]'))b.classList.toggle('selected',b.dataset.editPosition===cfg.caption_position);
 for(const b of document.querySelectorAll('[data-edit-size]'))b.classList.toggle('selected',Number(b.dataset.editSize)===Number(cfg.caption_font_size));
}
function queueEditingPreview(){refreshEditingButtons();clearTimeout(editingTimer);editingTimer=setTimeout(()=>requestEditingFrame(),350);}
async function requestEditingFrame(){
 if(current!=='editing'||!editingSession)return;
 if(editingFrameBusy){editingQueued=true;return;}
 editingFrameBusy=true;const session=editingSession;
 try{const frame=await api('video-editing/frame',{session:session.session,time:Number($('editingPreviewTime').value),settings:collectEditing()});
 if(current!=='editing'||session!==editingSession)return;
 $('editing-preview-image').src=frame.image;$('editing-preview-image').classList.remove('hidden');$('editing-preview-video').pause();$('editing-preview-video').classList.add('hidden');$('editing-preview-placeholder').classList.add('hidden');
 $('editing-preview-status').textContent=session.sample?'Sample text · exact ASS render':'Actual spoken words · exact ASS render';
 }catch(e){if(current==='editing')$('editing-preview-status').textContent=e.message;}
 finally{editingFrameBusy=false;if(editingQueued){editingQueued=false;requestEditingFrame();}}
}
async function loadEditingPreview(){
 if($('load-editing-preview').disabled)return;
 $('load-editing-preview').disabled=true;$('editing-preview-status').textContent=$('editingActualWords').checked?'Transcribing speech locally…':'Loading sample preview…';
 try{const result=await api('video-editing/prepare',{video:$('editingVideo').value,actualWords:$('editingActualWords').checked,settings:collectEditing()});
 if(current!=='editing')return;editingSession=result;$('editingPreviewTime').max=Math.max(.1,result.info.duration-.1);$('editingPreviewTime').value=Math.min(.2,result.info.duration/2);$('editing-preview-time').textContent=Number($('editingPreviewTime').value).toFixed(2)+'s';
 $('play-editing-preview').disabled=false;await requestEditingFrame();
 }catch(e){if(current==='editing')$('editing-preview-status').textContent=e.message;}
 finally{if($('load-editing-preview'))$('load-editing-preview').disabled=false;}
}
function bindVideoEditing(){
 $('editingTransitionsEnabled').onchange=()=>{$('editing-save-status').textContent=`Dissolve ${$('editingTransitionsEnabled').checked?'ON':'OFF'} · Save editing settings to apply to automatic jobs.`;remember();};
 document.querySelectorAll('[data-edit-key]').forEach(el=>el.oninput=()=>{const range=document.querySelector(`[data-edit-range="${el.dataset.editKey}"]`);if(range)range.value=el.value;if(el.dataset.editKey==='clipper_caption_preset'){const p=editingData.presets.find(p=>p.id===el.value);if(p){setEditingValue('clipper_caption_animation',p.animation||'none');setEditingValue('clipper_override_bg_enabled',!!p.background_enabled);}}if(el.dataset.editKey==='clipper_captions_enabled'&&el.checked&&!editingSession)loadEditingPreview();queueEditingPreview();});
 document.querySelectorAll('[data-edit-range]').forEach(el=>el.oninput=()=>{setEditingValue(el.dataset.editRange,Number(el.value));queueEditingPreview();});
 document.querySelectorAll('[data-edit-color]').forEach(el=>el.oninput=()=>{setEditingValue(el.dataset.editColor,el.value);queueEditingPreview();});
 document.querySelectorAll('[data-edit-reset]').forEach(b=>b.onclick=()=>{setEditingValue(b.dataset.editReset,'');queueEditingPreview();});
 document.querySelectorAll('[data-edit-style]').forEach(b=>b.onclick=()=>{const style=editingStyles.find(s=>s.id===b.dataset.editStyle),p=editingData.presets.find(p=>p.id===style.preset);setEditingValue('clipper_caption_preset',style.preset);setEditingValue('clipper_caption_animation',style.animation);setEditingValue('clipper_override_bg_enabled',!!p.background_enabled);setEditingValue('clipper_override_font_family','');setEditingValue('caption_font_size',72);setEditingValue('caption_text_case',['frameloom_karaoke','frameloom_smooth_rise'].includes(style.preset)?'Normal':'ALL CAPS');queueEditingPreview();});
 document.querySelectorAll('[data-edit-swatch]').forEach(b=>b.onclick=()=>{setEditingValue('clipper_override_highlight_color',b.dataset.editSwatch);if($('edit-clipper_override_bg_enabled').checked)setEditingValue('clipper_override_bg_color',b.dataset.editSwatch);queueEditingPreview();});
 document.querySelectorAll('[data-edit-position]').forEach(b=>b.onclick=()=>{setEditingValue('caption_position',b.dataset.editPosition);queueEditingPreview();});
 document.querySelectorAll('[data-edit-size]').forEach(b=>b.onclick=()=>{setEditingValue('caption_font_size',Number(b.dataset.editSize));queueEditingPreview();});
 $('editingPreviewText').oninput=queueEditingPreview;
 $('editingPreviewTime').oninput=()=>{$('editing-preview-time').textContent=Number($('editingPreviewTime').value).toFixed(2)+'s';queueEditingPreview();};
 $('load-editing-preview').onclick=loadEditingPreview;
 $('choose-editing-video').onclick=async()=>{try{const path=await nativeBridge('choose_file','video');if(path){$('editingVideo').value=path;editingSession=null;remember();}}catch(e){toast(e.message,true);}};
 $('load-editing-story').onclick=async()=>{try{const data=await api('video-editing/source',{story:$('editingStory').value});$('editingVideo').value=data.video;editingSession=null;remember();toast('Combined video loaded.');}catch(e){toast(e.message,true);}};
 $('play-editing-preview').onclick=async()=>{if(!editingSession)return;const b=$('play-editing-preview');b.disabled=true;try{const result=await api('video-editing/play',{session:editingSession.session,time:Number($('editingPreviewTime').value),settings:collectEditing()});if(current!=='editing')return;const v=$('editing-preview-video');v.src=result.url;v.classList.remove('hidden');$('editing-preview-image').classList.add('hidden');$('editing-preview-placeholder').classList.add('hidden');await v.play();}catch(e){toast(e.message,true);}finally{if($('play-editing-preview'))$('play-editing-preview').disabled=false;}};
 $('save-video-editing').onclick=async()=>{try{const result=await api('video-editing/settings',collectEditing());editingData.settings=result.settings;$('editing-save-status').textContent='Saved. New generation/join jobs will use these settings.';remember();toast('Video Editing settings saved.');}catch(e){toast(e.message,true);}};
 $('render-video-editing').onclick=()=>runAction('edit_video',{view:'editing',video:$('editingVideo').value,editingSettings:collectEditing()});
 $('stop-video-editing').onclick=async()=>{const job=knownJobs.find(j=>j.lane==='editing'&&j.status==='running');if(job)await api(`jobs/${job.id}/stop`,{});else toast('No editing job is running.');};
 $('view-form').onsubmit=e=>e.preventDefault();refreshEditingButtons();
}
