// Scene identity is project metadata, never text rendered into the video.
const crypto=require('crypto');
function prefix(story){return 'V3_'+crypto.createHash('sha256').update(JSON.stringify({title:story.title,preset:story.preset_id,scenes:(story.scenes||[]).map(s=>({script:s.script_line||'',dialogue:s.dialogue||[],shots:s.shots||[],action:s.narrative_context||'',start:s.start_state||'',end:s.end_state||''}))})).digest('hex').slice(0,12);}
const sceneId=(story,n)=>`${prefix(story)}_S${String(n).padStart(3,'0')}`;
const ids=text=>[...new Set(String(text||'').match(/\bV3_[a-f0-9]{12}_S\d{3}\b/g)||[])];
function inject(text,story){
 if(!text||!story?.scenes?.length)return text;
 const names=[];
 const body=text.replace(/^(Scene\s+(\d+)\b[^\n]*|CLIP\s+(\d+)\b[^\n]*)$/gim,(heading,a,b,c)=>{
  const n=Number(b||c);if(n<1||n>story.scenes.length)return heading;
  const id=sceneId(story,n);names.push(id);
  return `${heading}\nSCENE ASSET ID: ${id}. This ID belongs only to this scene's generated video asset. Preserve it in this scene's tool prompt and use it as that video asset's exact title/name.`;
 });
 if(!names.length)return text;
 // Idempotence is important for regenerated batch exports and saved retries.
 if(names.every(id=>String(text).includes('SCENE ASSET ID: '+id)))return text;
 return `SCENE ID TRACKING: Generate one separate video asset for each requested scene. The asset ID labels below are METADATA ONLY: never render them into frames, subtitles, dialogue or audio. Keep each ID with only its own scene's video tool call. Name/rename each successful VIDEO asset to its exact SCENE ASSET ID using available asset-title tools. Never rename reference images or assign an ID to an unrelated video. Retain the same ID when retrying that scene; do not regenerate successful scenes. Verify each completed asset's title; if naming is unavailable, explicitly report this rather than claiming the IDs were saved. Never claim an asset-ID mapping without inspecting actual generated assets.\n\n`+body;
}
function tileId(tile){
 // Prefer asset-owned metadata; a parent batch prompt can contain every ID.
 const titles=[tile.assetTitle,tile.assetName,tile.title,tile.caption,...(tile.buttons||[]).map(b=>b.aria||b.label||'')].filter(Boolean);
 const own=ids(titles.join('\n'));if(own.length)return own.length===1?own[0]:null;
 const all=ids([tile.text,tile.prompt,tile.sourcePrompt].filter(Boolean).join('\n'));
 return all.length===1?all[0]:null;
}
function plan(tiles,story){
 const total=story.scenes.length,expected=new Map(story.scenes.map((s,i)=>[sceneId(story,i+1),i+1]));
 const mapped=new Map(),used=new Set();
 for(const t of tiles){
  if(!t.assetId||t.failed||t.busy||t.ready===false)continue;
  const id=tileId(t);if(!id||!expected.has(id))continue;
  const n=expected.get(id);
  if(mapped.has(n)&&mapped.get(n).receipt.assetId!==t.assetId)throw Error(`RECOVERY_REVIEW_REQUIRED: Scene ID ${id} belongs to multiple completed video assets. Choose the intended version; no duplicate was substituted.`);
  if(used.has(t.assetId)&&!mapped.has(n))throw Error('RECOVERY_REVIEW_REQUIRED: One video asset claims multiple scene IDs.');
  used.add(t.assetId);const source=String(t.text||t.prompt||'').split(/Created\s/i).pop(),nativeResolution=/\b360p\b/i.test(source)?360:720;
  mapped.set(n,{job:{number:n,scene:story.scenes[n-1],prompt:story.scenes[n-1].veo3_prompt||'',sceneId:id},receipt:{scene:n,sceneId:id,assetId:t.assetId,key:'',nativeResolution,native720:nativeResolution===720,match_from:'scene_id'}});
 }
 return mapped.size===total?Array.from({length:total},(_,i)=>mapped.get(i+1)):null;
}
module.exports={prefix,sceneId,ids,inject,tileId,plan};
