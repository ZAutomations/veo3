'use strict';
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const {editingPython}=require('./video_editing_hook');
if(require.main===module){try{
 const file=path.resolve(process.argv[2]),request=path.join(path.dirname(file),'multilingual_preflight_request.json');
 fs.writeFileSync(request,JSON.stringify({story:file,preflight:true}));
 execFileSync(editingPython(),[path.join(__dirname,'multilingual.py'),request],{cwd:__dirname,env:process.env,stdio:'inherit',windowsHide:true,timeout:1800000});
}catch(e){process.exitCode=e.status||1;}}
