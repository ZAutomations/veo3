'use strict';
const token = document.querySelector('meta[name="app-session"]').content;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {home:'M3 10l9-7 9 7v10H3z M9 20v-7h6v7',writer:'M4 4h12v16H4z M8 8h4 M8 12h4 M18 5l3 3-7 7-3 1 1-3z',agent:'M6 6h12v12H6z M9 10h.1 M15 10h.1 M9 14h6 M12 2v4 M2 9h4 M18 9h4',ingredients:'M8 3h8v6h5v6h-5v6H8v-6H3V9h5z',omni:'M4 4h16v16H4z M10 8l6 4-6 4z',library:'M3 5h7l2 3h9v12H3z',accounts:'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M18 8a3 3 0 0 1 0 6 M19 17a3 3 0 0 1 3 3',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2'};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.omni}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const names = {home:'Overview',writer:'Story Writer',agent:'Agent Mode',ingredients:'Ingredients',omni:'Single Clip Omni',library:'Story Library',accounts:'Accounts',settings:'Settings'};
let bootstrap, library=[], accounts={accounts:[]}, preferences={}, current='home', selectedJob='', cursor=0, logLines=[], knownJobs=[], promptData=[], toastTimer;
const forms = {};
const logView=StudioLogView.create($('log'));let logPaused=false;
async function api(path, data){
 const response=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'X-Session-Token':token,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await response.json();if(!response.ok)throw Error(result.detail||'Request failed');return result;
}
function applyTheme(value,save=false){const theme=['crimson','ember','matte'].includes(value)?value:'crimson';document.documentElement.dataset.theme=theme;$('theme-picker').value=theme;preferences.theme=theme;if(save)api('preferences',{...preferences,forms,current}).catch(e=>toast(e.message,true));}
$('theme-picker').onchange=()=>applyTheme($('theme-picker').value,true);
function toast(message,error=false){$('toast').textContent=message;$('toast').className=error?'error':'';$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').style.display='none';},6500);}
function confirmAction(title,text){return new Promise(resolve=>{const dialog=$('confirm-dialog');$('confirm-title').textContent=title;$('confirm-text').textContent=text;$('confirm-yes').onclick=()=>{dialog.close();resolve(true);};$('confirm-no').onclick=()=>{dialog.close();resolve(false);};dialog.oncancel=()=>resolve(false);dialog.showModal();});}
function field(label,id,value,options={}){
 let control=options.items?`<select id="${id}">${options.items.map(x=>{const [v,n]=typeof x==='string'?[x,x]:[x.id,x.name];return `<option value="${esc(v)}" ${String(v)===String(value)?'selected':''}>${esc(n)}</option>`;}).join('')}</select>`:options.textarea?`<textarea id="${id}" placeholder="${esc(options.placeholder||'')}">${esc(value)}</textarea>`:`<input id="${id}" type="${options.type||'text'}" value="${esc(value)}" ${options.min!==undefined?`min="${options.min}"`:''} placeholder="${esc(options.placeholder||'')}">`;
 if(options.browse)control=`<div class="input-row">${control}<button class="button" data-browse="${id}" data-kind="${options.browse}">Browse</button></div>`;
 return `<div class="field ${options.full?'full':''}"><label for="${id}">${label}</label>${control}${options.hint?`<small>${options.hint}</small>`:''}</div>`;
}
function toggle(id,label,value,hint=''){return `<label class="toggle-row" for="${id}"><input id="${id}" type="checkbox" ${value?'checked':''}><span>${label}${hint?`<small>${hint}</small>`:''}</span></label>`;}
function heading(title,subtitle,eyebrow='CREATE WITH INTENTION',right=''){return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div>${right}</div>`;}
function panel(title,subtitle,step,body){return `<section class="panel"><div class="panel-title"><span class="step">${step}</span><div><h2>${title}</h2><small>${subtitle}</small></div></div>${body}</section>`;}
function renderNav(){ $('navigation').innerHTML=Object.keys(names).map(key=>`<button class="nav-item ${key===current?'active':''}" data-view="${key}">${icon(key)}<span>${names[key]}</span>${key==='omni'?'<span class="nav-count">5×</span>':''}</button>`).join('');}
function remember(){
 const form=$('view-form');if(form){const data={};form.querySelectorAll('input,textarea,select').forEach(el=>{if(el.id!=='apiKeys')data[el.id]=el.type==='checkbox'?el.checked:el.value;});forms[current]=data;}
 preferences={...preferences,forms,current};api('preferences',preferences).catch(()=>{});
}
function restore(){const values=forms[current]||{};for(const [id,value] of Object.entries(values)){const el=$(id);if(!el)continue;if(el.type==='checkbox')el.checked=value;else if(el.id==='seconds'&&el.tagName==='SELECT'&&!Array.from(el.options).some(o=>o.value===String(value)))el.value='8';else el.value=value;} if(current==='writer')setSource($('source').value);}
function navigate(view){remember();current=view in names?view:'home';render();preferences.current=current;api('preferences',{...preferences,forms,current}).catch(()=>{});window.scrollTo(0,0);}
function render(){renderNav();$('breadcrumb').textContent=names[current];if(current==='home')renderHome();else if(current==='writer')renderWriter();else if(['agent','omni','ingredients'].includes(current))renderGeneration();else if(current==='library')renderLibrary();else if(current==='accounts')renderAccounts();else renderSettings();restore();bindView();}
function table(rows,compact=false){return `<div class="table-wrap"><table class="story-table"><thead><tr><th>STORY</th><th>CLIPS</th><th>DOWNLOADED</th><th></th></tr></thead><tbody>${rows.map(s=>`<tr><td><strong>${esc(s.title)}</strong><small>${esc(s.preset||'Story package')} · ${s.duration}s</small></td><td>${s.scenes}</td><td><span class="tag">${s.downloaded} / ${s.scenes}</span></td><td><button class="button small" data-story="${esc(s.path)}">${compact?'Open story':'View prompts'}</button></td></tr>`).join('')}</tbody></table>${rows.length?'':'<div class="empty">Your finalized stories will appear here.</div>'}</div>`;}
function renderHome(){
 const total=library.reduce((n,s)=>n+s.scenes,0);
 $('main').innerHTML=heading('A little idea. A whole new story.','Write, generate and finish your videos in one creative workspace.','WELCOME TO YOUR STUDIO')+
 `<section class="hero"><div><span class="eyebrow">FROM IDEA TO FINAL CUT</span><h2>Make something worth watching.</h2><p>Give your story a voice. Choose your characters, build each scene, and bring everything together.</p><button class="button primary" data-view="writer">＋ Write a new story</button></div><div class="hero-art" aria-hidden="true"><span class="spark">✧</span><div class="art-card"><div class="art-screen">✦</div><div class="art-line"></div><div class="art-line short"></div></div><div class="art-card front"><div class="art-screen">▷</div><div class="art-line"></div><div class="art-line short"></div></div></div></section>`+
 `<div class="stats">${[[library.length,'Stories in your library','library'],[total,'Scenes ready to create','omni'],[accounts.accounts.length,'Connected account profiles','accounts']].map(([n,label,i])=>`<div class="stat"><div class="stat-icon">${icon(i)}</div><div><strong>${n}</strong><small>${label}</small></div></div>`).join('')}</div>`+
 `<div class="section-head"><h2>Choose your creative flow</h2><span class="caption">Your existing engines, a fresh workspace</span></div><div class="workflow-cards">${[['agent','Let the agent build','Generate your story in saved batches with Flow Agent.'],['ingredients','Build with continuity','Start with your references, then extend the conversation.'],['omni','One scene at a time','Five standalone clips per group. Upscaled downloads.']].map(([v,title,body])=>`<button class="workflow-card" data-view="${v}"><span class="go">↗</span><div class="stat-icon">${icon(v)}</div><h3>${title}</h3><p>${body}</p></button>`).join('')}</div>`+
 `<div class="section-head"><h2>Recently written</h2><button data-view="library">View all stories →</button></div>`+table(library.slice(0,4),true);
}
function renderWriter(){
 const d=bootstrap.defaults;
 $('main').innerHTML=heading('Every video starts with a story.','Write from an idea or a reference video. Keep creating while your clips generate.','STORY WRITER')+
 `<form id="view-form"><input id="source" type="hidden" value="ideas"><div class="segmented"><button type="button" data-source="ideas" class="selected">Title & details</button><button type="button" data-source="links">Video links</button></div>`+
 panel('Your starting point','One idea, or a batch of stories', '01',
 `<div id="ideas-field">${field('Title on the first line, then your details','ideas','',{textarea:true,placeholder:'A peaceful home begins with trust\nA gentle conversation about small promises and mutual respect.\n\nSTORY 2\nAnother title\nDetails for the second story…',hint:'For multiple stories, separate each with STORY 1, STORY 2, and so on.'})}</div><div id="links-field" class="hidden">${field('Reference video links','links','',{textarea:true,placeholder:'https://www.youtube.com/shorts/…\nOne link per line',hint:'The requested source link is sent with each writing job.'})}<div class="options-grid">${toggle('matchSource','Match each source video duration',true,'Manual clip count applies when this is off.')}</div></div>`)+
 panel('Make it yours','Style, pacing and writing method','02',`<div class="form-grid three">${field('Style preset','preset',d.preset,{items:bootstrap.presets})}${field('Writing method','transport',d.transport,{items:[{id:'web',name:'AI Studio browser'},{id:'api',name:'Gemini API'},{id:'auto',name:'API → browser fallback'}]})}${field('Format','aspect',d.aspect,{items:['9:16','16:9','1:1','Flow']})}${field('Number of clips','clips',8,{type:'number',min:1})}${field('Seconds per clip','seconds',8,{items:['4','6','8','10']})}${field('Gemini model (optional)','geminiModel',d.geminiModel,{placeholder:'Use the saved model'})}</div><div class="hint"><b id="duration-summary">8 clips × 8 seconds = 64 seconds.</b> Browser writing produces up to 20 prompts per call. Interrupted writing restores completed calls from disk.</div>`)+
 `<div class="action-bar"><div class="buttons"><button type="button" class="button primary" data-action="write">✦ Write stories</button><button type="button" class="button" data-action="write">Retry / continue writing</button><button type="button" class="button" data-action="aistudio">Open AI Studio</button><button type="button" class="button danger" data-stop-lane="writer">Stop writing</button></div><span class="caption">Writing uses a separate job queue</span></div>`+
 `<details><summary>Finalize a saved analysis</summary><div class="panel"><div class="form-grid">${field('Saved content-map JSON','analysis','',{browse:'analysis',full:true})}</div><button type="button" class="button" data-action="finalize">Finalize story package</button></div></details></form>`;
}
function updateWriterDuration(){if(!$('duration-summary'))return;$('duration-summary').textContent=$('source').value==='links'&&$('matchSource').checked?'Duration and clip count will follow each source video.':`${Number($('clips').value)||0} clips \u00d7 ${Number($('seconds').value)||0} seconds = ${(Number($('clips').value)||0)*(Number($('seconds').value)||0)} seconds.`;}
function setSource(source){$('source').value=source;$('ideas-field').classList.toggle('hidden',source!=='ideas');$('links-field').classList.toggle('hidden',source!=='links');document.querySelectorAll('[data-source]').forEach(b=>b.classList.toggle('selected',b.dataset.source===source));updateWriterDuration();}
function renderGeneration(){
 const d=bootstrap.defaults, omni=current==='omni', ing=current==='ingredients';
 const storyDefault=preferences.selectedStory||d.story;
 const titles={agent:['Let your agent handle the scenes.','Generate saved batches, recover failed clips, and finish your story.'],omni:['Small batches. Clear control.','Five individual prompts, five-second intervals, and verified Upscaled downloads.'],ingredients:['Keep the conversation flowing.','Prepare your references, create the opening clip, and extend with continuity.']};
 const [title,subtitle]=titles[current];
 $('main').innerHTML=heading(title,subtitle,names[current].toUpperCase())+`<form id="view-form">`+
 panel('Story & project','Choose the story you want to bring to life','01',`<div class="form-grid">${field('Story package','story',storyDefault,{browse:'story',full:true,placeholder:'Choose a story JSON from your library'})}${field('Flow project URL','project',d.project,{full:true,placeholder:'https://flow.google.com/project/…',hint:'Reuse the same project to continue a saved run.'})}${field('From scene','from',1,{type:'number',min:1})}${field('To scene (blank = last)','to','',{type:'number',min:1})}</div><div id="story-info" class="story-meta"></div>`)+
 panel('Video settings','Your choices travel with the generation request','02',`<div class="form-grid three">${field('Video model','model',omni?'Omni 1.1 Flash':d.model,{items:omni?['Omni 1.1 Flash']:bootstrap.models})}${field('Aspect ratio','aspect',d.aspect,{items:['9:16','16:9','1:1','Flow']})}${field(current==='agent'?'Resolution (prompt instruction)':'Resolution','resolution',omni?'360p':d.resolution,{items:omni?['360p','720p']:['Flow','360p','720p']})}${field('Seconds per clip','seconds',8,{type:'number',min:1})}${field('Automation browser port','cdp',d.cdp,{type:'number',min:1024})}</div>${!omni?'<small class="footer-note">Agent resolution is requested in the prompt. Ingredients uses the selected Flow settings.</small>':''}`)+
 panel('References & finishing','Choose how this run should use your project','03',`<div class="options-grid">${toggle('reuseRefs','Use references already in this project',true,'Skip reference preparation when resuming.')}${toggle('genRefs','Make reference images first',false,'Generate and rename the cast and location.')}${toggle('newProject','Create a new project',false,'Use for a fresh run, not for resuming.')}${toggle('download',omni?'Download Upscaled between groups':'Download clips when finished',true,'Verified existing files are skipped.')}${toggle('join','Join after verified downloads',false,'Uses the resolved story order in the manifest.')}${omni?toggle('simple','Use simple prompts when available',true):toggle('refsOnClip1','Attach references to opening clip',true)}</div><div class="hint">${omni?'<b>Five at a time.</b> Submit individually, wait for the group, and download older completed scenes while the next group generates. References attach to every clip.':ing?'<b>Continuity.</b> Scene 1 uses references. Later clips use Extend; resuming after scene 1 keeps the existing project.':'<b>Safe resume.</b> Completed batches are preserved. Failed-clip recovery does not repeat the whole conversation.'}</div>`)+
 `<div class="action-bar"><div class="buttons"><button type="button" class="button primary" data-action="generate">▷ Generate clips</button><button type="button" class="button" data-action="refs">Prepare references only</button><button type="button" class="button danger" data-stop-lane="flow">Stop generation</button>${current==='agent'?'<button type="button" class="button" data-action="build">Build prompts</button>':''}</div><span class="caption">Generation spends Flow credits</span></div>`+
 `<details open><summary>Downloads & final video</summary><div class="buttons action-bar"><button type="button" class="button" data-action="download">↓ Download ${omni||String(d.model).includes('Omni')?'Upscaled':'clips'}</button><button type="button" class="button" data-action="order">Resolve clip order</button><button type="button" class="button dark" data-action="join">Join clips</button><button type="button" class="button" data-action="export_excel">Export Excel</button></div></details>`+
 `${current==='agent'?`<details><summary>Generate a specific batch or selected clips</summary><div class="panel"><div class="form-grid">${field('Selection type','selectionType','batch',{items:[{id:'batch',name:'Batch number (5 clips)'},{id:'clips',name:'Clip numbers / ranges'}]})}${field('Your selection','selection','1',{placeholder:'Batch 4, or clips 2,8,6 / 3-5'})}</div><div class="hint">Manual selection creates new versions even if those clips already exist.</div><div class="action-bar"><button type="button" class="button" data-action="manual">Generate selection</button><button type="button" class="button" data-action="retry_failed">Retry failed tiles only</button></div></div></details>`:''}`+
 `<details><summary>Project cleanup</summary><div class="panel"><p class="settings-note">Move video clips in the selected project to Flow Trash. Images, characters and local files are retained.</p><div class="action-bar"><button type="button" class="button danger" data-action="delete">Delete all video clips</button></div></div></details></form>`;
 updateStoryInfo(storyDefault);
}
async function updateStoryInfo(path){if(!$('story-info'))return;try{const s=await api('story?path='+encodeURIComponent(path));$('story-info').innerHTML=`<span class="tag">${s.scenes} scenes</span><span class="caption">${esc(s.title)}</span>`;}catch(_){$('story-info').textContent='Choose a finalized story package.';}}
function renderLibrary(){
 $('main').innerHTML=heading('Your stories, all in one place.','Find a story, inspect a scene, or send it to your generation workflow.','STORY LIBRARY',`<button class="button primary" data-view="writer">＋ New story</button>`)+
 `<div class="section-head"><h2>${library.length} story packages</h2><div class="library-tools"><input id="library-search" class="search" placeholder="Search stories…" aria-label="Search stories"></div></div><div id="library-table">${table(library)}</div><div id="story-detail"></div>`;
}
async function showStory(path){
 const data=await api('story?path='+encodeURIComponent(path));promptData=data.prompts;preferences.selectedStory=path;api('preferences',{...preferences,forms}).catch(()=>{});
 if(current!=='library'){current='library';render();}
 $('story-detail').innerHTML=`<div class="section-head"><div><span class="eyebrow">SELECTED STORY</span><h2>${esc(data.title)}</h2></div><div class="buttons"><button class="button small" data-use="agent">Use in Agent</button><button class="button small" data-use="omni">Use in Omni</button><button class="button small" data-use="ingredients">Use in Ingredients</button><button class="button small" id="open-folder">Open folder</button></div></div><div class="prompt-list">${data.prompts.map(s=>`<div class="prompt-row"><div><b><span class="prompt-number">${String(s.number).padStart(2,'0')}</span>${esc(s.title)}</b><p>${esc((s.dialogue||[]).map(d=>d.speaker+': '+d.line).join(' · ').slice(0,140))}</p></div><button class="button small" data-prompt="${s.number}">Full prompt</button></div>`).join('')}</div>`;
 $('story-detail').scrollIntoView({behavior:'smooth',block:'start'});
 $('open-folder').onclick=async()=>{try{await nativeBridge('open_story_folder',path);}catch(e){toast(e.message,true);}};
}
function renderAccounts(){
 $('main').innerHTML=heading('A home for every account.','Manage your existing Chrome profiles and open the automation browser.','ACCOUNTS')+
 `<div class="table-wrap"><table class="story-table"><thead><tr><th>ACCOUNT</th><th>CLIPS / MONTH</th><th>STATUS</th><th></th></tr></thead><tbody>${accounts.accounts.map((a,i)=>`<tr><td><strong>${esc(a.label)}</strong><small>${esc(a.email||'Google Flow profile')}</small></td><td>${a.clips_month===new Date().toISOString().slice(0,7)?a.clips_used||0:0} / ${a.max_clips||100}</td><td><span class="tag">${i===accounts.current?'Active · ':''}${a.paused?'Paused':'Ready'}</span></td><td><div class="account-actions"><button class="button small" data-account="use" data-label="${esc(a.label)}">Open browser</button><button class="button small" data-account="${a.paused?'resume':'pause'}" data-label="${esc(a.label)}">${a.paused?'Resume':'Pause'}</button><button class="button small" data-account="reset" data-label="${esc(a.label)}">Reset counter</button><button class="button danger small" data-account="remove" data-label="${esc(a.label)}">Remove</button></div></td></tr>`).join('')}</tbody></table>${accounts.accounts.length?'':'<div class="empty">Add your first account profile below.</div>'}</div>`+
 `<form id="view-form"><div class="section-head"><h2>Add an account</h2></div><div class="panel"><div class="form-grid three">${field('Account label','label','',{placeholder:'My Flow account'})}${field('Email (optional)','email','')}${field('Monthly clip limit','maxClips',100,{type:'number',min:1})}${field('Automation browser port','cdp',bootstrap.defaults.cdp,{type:'number',min:1024})}</div><div class="action-bar"><button type="button" class="button primary" data-action="account_add">Add account</button></div></div></form><p class="footer-note">Opening an account browser switches the active Flow profile. Sign in yourself if Google asks. AI Studio uses its own browser profile.</p>`;
}
function renderSettings(){
 const c=bootstrap.savedCouple;
 $('main').innerHTML=heading('Make this studio yours.','Shared character references and API settings for your existing tool.','SETTINGS')+`<form id="view-form">`+
 panel('Saved couple','Use your approved Sarah and George references','01',`<div class="form-grid">${field('Sarah reference image','couple_sarah_file',c.couple_sarah_file,{browse:'image'})}${field('George reference image','couple_george_file',c.couple_george_file,{browse:'image'})}${field('Sarah approved appearance','couple_sarah_description',c.couple_sarah_description,{textarea:true})}${field('George approved appearance','couple_george_description',c.couple_george_description,{textarea:true})}</div><div class="options-grid">${toggle('agent_saved_couple','Use saved couple in Agent / Story Writer',c.agent_saved_couple)}${toggle('ing_saved_couple','Use saved couple in Ingredients',c.ing_saved_couple)}${toggle('omni_saved_couple','Use saved couple in Single Clip Omni',c.omni_saved_couple)}</div>`)+
 panel('Gemini API keys','Browser writing does not require an API key','02',`<div class="field"><label for="apiKeys">Replace saved key list (one key per line)</label><textarea id="apiKeys" placeholder="Leave empty to keep existing keys"></textarea><small>${bootstrap.hasApiKeys?'Keys are already configured. Their values are not displayed.':'No keys configured. You can still write through AI Studio.'}</small></div>`)+
 `<div class="action-bar"><button type="button" class="button primary" id="save-shared">Save settings</button><span class="caption">Saved locally in the existing tool folder</span></div></form><p class="settings-note">Classic interface remains available for its advanced tools. Both interfaces share story files and existing driver checkpoints. Run only one Flow generation job at a time across both interfaces.</p>`;
}
async function nativeBridge(method,...args){if(!window.pywebview?.api)throw Error('This control is available in the desktop window.');return window.pywebview.api[method](...args);}
function payload(){const form=$('view-form'),p={view:current};form?.querySelectorAll('input,textarea,select').forEach(el=>p[el.id]=el.type==='checkbox'?el.checked:el.value);if(p.to==='')delete p.to;return p;}
async function runAction(action,p=payload()){
 remember();
 if(['generate','refs','manual','retry_failed'].includes(action)){
  const text=action==='manual'?'This manual selection generates new versions, even when older clips exist.':action==='retry_failed'?'Retry only individual failed tiles. Completed clips will be retained.':'This request generates media in Flow using the selected settings.';
  if(!await confirmAction('Start '+(action==='refs'?'reference generation':'generation')+'?',text+'\nFlow credits may be spent.'))return;
 }
 if(action==='delete'){if(!await confirmAction('Move all video clips to Trash?',p.project+'\nImages, characters and local video files are retained.'))return;p.confirmed=true;}
 if(action==='account_remove'){if(!await confirmAction('Remove account from the pool?',p.label+'\nThis removes the saved account entry.'))return;p.confirmed=true;}
 if(action==='account_use'&&!await confirmAction('Switch the automation browser?',p.label+'\nThe existing automation browser will close before this profile opens.'))return;
 try{
  const job=await api('jobs',{action,payload:p});selectedJob=job.id;cursor=0;logLines=[];logView.reset('Starting…');$('activity').classList.add('expanded');document.body.classList.add('log-open');toast('Job started. Follow its progress below.');await pollJobs();
 }catch(e){toast(e.message,true);}
}
function bindView(){
 $('view-form')?.addEventListener('submit',e=>e.preventDefault());
 if(current==='writer'){
  $('clips').oninput=updateWriterDuration;$('seconds').oninput=updateWriterDuration;$('matchSource').onchange=updateWriterDuration;updateWriterDuration();
 }
 if($('story'))$('story').onchange=()=>updateStoryInfo($('story').value);
 if($('library-search'))$('library-search').oninput=()=>{$('library-table').innerHTML=table(library.filter(s=>s.title.toLowerCase().includes($('library-search').value.toLowerCase())));};
 if($('reuseRefs'))$('reuseRefs').onchange=()=>{if($('reuseRefs').checked){$('genRefs').checked=false;$('newProject').checked=false;}};
 if($('genRefs'))$('genRefs').onchange=()=>{if($('genRefs').checked)$('reuseRefs').checked=false;};
 if($('newProject'))$('newProject').onchange=()=>{if($('newProject').checked)$('reuseRefs').checked=false;};
 if($('save-shared'))$('save-shared').onclick=async()=>{try{const p=payload();await api('settings',p);$('apiKeys').value='';toast('Shared settings saved.');bootstrap=await api('bootstrap');}catch(e){toast(e.message,true);}};
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 try{
  if(b.dataset.view)navigate(b.dataset.view);
  if(b.dataset.source)setSource(b.dataset.source);
  if(b.dataset.action)await runAction(b.dataset.action);
  if(b.dataset.stopLane){const job=knownJobs.find(j=>j.lane===b.dataset.stopLane&&j.status==='running');if(job){await api(`jobs/${job.id}/stop`,{});await pollJobs();}else toast('No job is running in this queue.');}
  if(b.dataset.browse){const file=await nativeBridge('choose_file',b.dataset.kind);if(file){$(b.dataset.browse).value=file;if(b.dataset.browse==='story')updateStoryInfo(file);remember();}}
  if(b.dataset.story)await showStory(b.dataset.story);
  if(b.dataset.use){forms[b.dataset.use]={...forms[b.dataset.use],story:preferences.selectedStory,from:'1',to:''};navigate(b.dataset.use);}
  if(b.dataset.prompt){const p=promptData.find(x=>x.number===Number(b.dataset.prompt));$('prompt-title').textContent=`Scene ${p.number} · ${p.title}`;$('prompt-text').value=p.prompt;$('prompt-dialog').showModal();}
  if(b.dataset.account)await runAction('account_'+b.dataset.account,{label:b.dataset.label,cdp:bootstrap.defaults.cdp});
 }catch(err){toast(err.message,true);}
});
$('close-prompt').onclick=()=>$('prompt-dialog').close();
$('copy-prompt').onclick=async()=>{try{await navigator.clipboard.writeText($('prompt-text').value);toast('Full scene prompt copied.');}catch(_){$('prompt-text').focus();$('prompt-text').select();toast('Press Ctrl+C to copy the selected prompt.');}};
$('legacy').onclick=async()=>{try{await nativeBridge('open_legacy');}catch(e){toast(e.message,true);}};
$('refresh').onclick=async()=>{try{await refreshData();render();toast('Library refreshed.');}catch(e){toast(e.message,true);}};
$('toggle-log').onclick=()=>{const open=$('activity').classList.toggle('expanded');document.body.classList.toggle('log-open',open);};
$('job-picker').onchange=()=>{selectedJob=$('job-picker').value;cursor=0;logLines=[];logView.reset();pollJobs();};
$('pause-log').onclick=()=>{logPaused=logView.pause(!logPaused);$('pause-log').textContent=logPaused?'Resume log':'Pause log';};
$('copy-log').onclick=async()=>{let full=logLines.join('\n');try{if(selectedJob)full=(await api(`jobs/${selectedJob}/log`)).text||full;await navigator.clipboard.writeText(full);toast('Full job log copied.');}catch(_){$('prompt-title').textContent='Full job log';$('prompt-text').value=full;$('prompt-dialog').showModal();$('prompt-text').focus();$('prompt-text').select();toast('Press Ctrl+C to copy the selected log.');}};
$('stop-job').onclick=async()=>{if(selectedJob){await api(`jobs/${selectedJob}/stop`,{});pollJobs();}};
async function refreshData(){[library,accounts]=await Promise.all([api('library'),api('accounts')]);}
let polling=false;
async function pollJobs(){
 if(polling)return;polling=true;
 try{
  const previous=knownJobs;knownJobs=await api('jobs');const active=knownJobs.filter(j=>j.status==='running');$('running-pill').textContent=active.length?`${active.length} active job${active.length===1?'':'s'}`:'No active jobs';$('running-pill').classList.toggle('busy',active.length>0);$('activity').classList.toggle('busy',active.length>0);
  if(!selectedJob&&knownJobs.length)selectedJob=knownJobs[0].id;
  const pickerHTML=knownJobs.length?knownJobs.map(j=>`<option value="${j.id}" ${j.id===selectedJob?'selected':''}>${esc(j.lane+' · '+j.action+' · '+j.status)}</option>`).join(''):'<option>No jobs yet</option>';if($('job-picker').innerHTML!==pickerHTML)$('job-picker').innerHTML=pickerHTML;
  if(selectedJob){const data=await api(`jobs/${selectedJob}?after=${cursor}`);cursor=data.cursor;logLines.push(...data.logs.map(x=>x.text));logView.append(data.logs.map(x=>x.text));$('stop-job').disabled=data.status!=='running';$('activity-status').textContent=`${data.lane==='writer'?'Writing':'Flow'} · ${data.status}`;}
  if(knownJobs.some(j=>j.status!=='running'&&previous.find(p=>p.id===j.id)?.status==='running')){await refreshData();if(['home','library','accounts'].includes(current))render();}
 }catch(e){$('activity-status').textContent='Connection interrupted';}finally{polling=false;}
}
async function init(){try{bootstrap=await api('bootstrap');preferences=bootstrap.preferences;applyTheme(preferences.theme);Object.assign(forms,preferences.forms||{});for(const mode of ['agent','ingredients','omni']){if(!forms[mode])forms[mode]={...bootstrap.workflowDefaults[mode]};}current=preferences.current in names?preferences.current:'home';await refreshData();render();await pollJobs();setInterval(pollJobs,1200);}catch(e){$('main').innerHTML=`<div class="panel"><h2>Could not load the studio</h2><p>${esc(e.message)}</p></div>`;}}
let saveTimer;document.addEventListener('input',e=>{if(e.target.closest('#view-form')&&e.target.id!=='apiKeys'){clearTimeout(saveTimer);saveTimer=setTimeout(remember,600);}});
init();
