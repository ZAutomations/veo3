function preparePrompt(prompt){
 // Preserve scene boundaries: collapsing all whitespace prevents per-scene
 // settings injection and leaves a long batch with just one global request.
 return String(prompt).replace(/@([A-Za-z0-9_.\-]+)/g,'$1').replace(/[^\S\r\n]{2,}/g,' ').trim();
}
function withSettings(prompt,{model='',resolution='Flow',seconds=8,aspect='Flow'}={}){
 if(!prompt)return prompt;
 if(!['Flow','360p','720p'].includes(resolution))throw Error('Invalid Agent video resolution.');
 if(![4,6,8,10].includes(Number(seconds)))throw Error('Invalid Agent clip duration.');
 const settings=`VIDEO GENERATION SETTINGS: Model ${model||'the selected Flow model'}; duration ${seconds} seconds; resolution ${resolution==='Flow'?'selected Flow resolution':resolution}; aspect ${aspect==='Flow'?'selected Flow ratio':aspect}; quantity 1. Use exactly these settings for this clip and every generated video tool call. DURATION PARAMETER CHECK: Before calling the video-generation tool for EACH scene, explicitly set its supported duration parameter to ${seconds} seconds and verify the selected model supports it. Writing ${seconds} seconds in visual prose alone is insufficient. Do not leave duration at a tool default or silently substitute 4, 6 or 8 seconds. If the tool does not expose/support the requested duration, stop and report the actual supported setting instead of submitting. Keep narration and all timed actions within the full requested runtime; no truncated speech, duplicated frames, freeze-frame padding or slow-motion workaround. After rendering, inspect actual output duration and report a mismatch without repeating successful scenes. Resolution is the native generation size; aspect is a separate canvas setting. Do not substitute a different model or a higher native resolution. If the requested generation resolution is unavailable, report that instead of generating at another resolution.`;
 return settings+'\n'+prompt.replace(/^(Scene\s+\d+[^\n]*|CLIP\s+\d+[^\n]*)$/gim,line=>line+'\n'+settings);
}
module.exports={withSettings,preparePrompt};
