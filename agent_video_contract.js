function preparePrompt(prompt){
 // Preserve scene boundaries: collapsing all whitespace prevents per-scene
 // settings injection and leaves a long batch with just one global request.
 return String(prompt).replace(/@([A-Za-z0-9_.\-]+)/g,'$1').replace(/[^\S\r\n]{2,}/g,' ').trim();
}
function withSettings(prompt,{model='',resolution='Flow',seconds=8,aspect='Flow'}={}){
 if(!prompt||resolution==='Flow')return prompt;
 if(!['360p','720p'].includes(resolution))throw Error('Invalid Agent video resolution.');
 const settings=`VIDEO GENERATION SETTINGS: Model ${model||'the selected Flow model'}; duration ${seconds} seconds; resolution ${resolution}; aspect ${aspect==='Flow'?'selected Flow ratio':aspect}; quantity 1. Use exactly these settings for this clip and every generated video tool call. Resolution is the native generation size; aspect is a separate canvas setting. Do not substitute a different model or a higher native resolution. If the requested generation resolution is unavailable, report that instead of generating at another resolution.`;
 return settings+'\n'+prompt.replace(/^(Scene\s+\d+[^\n]*|CLIP\s+\d+[^\n]*)$/gim,line=>line+'\n'+settings);
}
module.exports={withSettings,preparePrompt};
