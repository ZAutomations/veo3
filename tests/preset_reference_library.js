const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../preset_reference_library');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'preset-library-'));
const prior = process.env.VEO_PRESET_REFS;
try {
    delete process.env.VEO_PRESET_REFS;
    const realistic = path.join(dir,'real'), cartoon = path.join(dir,'cartoon');
    fs.mkdirSync(realistic); fs.mkdirSync(cartoon);
    for (const file of ['Sarah.jpg','SAM.png','Bedroom.webp','Unused.png']) fs.writeFileSync(path.join(realistic,file),'image');
    fs.writeFileSync(path.join(cartoon,'Sarah.png'),'cartoon');
    const settings = {preset_reference_library:{'relationship-dialogue-real':{folder:realistic},'relationship-dialogue-colorful-cartoon':{folder:cartoon}}};
    const refs = [{name:'SARAH',kind:'character',prompt:'Existing appearance'}, {name:'SAM',kind:'character',prompt:'Male'},
        {name:'Neighbour',kind:'character',prompt:'Extra person'}, {name:'Bedroom',kind:'place',prompt:'Room'}, {name:'Kitchen',kind:'place',prompt:'Kitchen'}];
    for (const mode of ['agent','ingredients','omni']) {
        const library=L.load(mode,settings,{preset_id:'relationship-dialogue-real'});
        const result=L.apply(refs,library);
        assert.equal(result.length,5);
        assert.equal(result.find(r=>r.name==='SARAH').localFile,path.join(realistic,'Sarah.jpg'));
        assert(result.find(r=>r.name==='Bedroom').localFile);
        assert(!result.find(r=>r.name==='Neighbour').localFile);
        assert(!result.find(r=>r.name==='Kitchen').localFile);
        assert.equal(result[0].prompt,'Existing appearance');
        assert(!result.some(r=>r.name==='Unused'));
        const other=L.apply(refs,L.load(mode,settings,{preset_id:'relationship-dialogue-colorful-cartoon'}));
        assert.equal(other.find(r=>r.name==='SARAH').localFile,path.join(cartoon,'Sarah.png'));
        assert(!other.find(r=>r.name==='SAM').localFile);
        const disabled=L.load(mode,{...settings,preset_reference_modes:{[mode]:false}},{preset_id:'relationship-dialogue-real'});
        assert.equal(disabled,null);
        assert(!L.apply(result,disabled).some(r=>r.localFile));
    }
    process.env.VEO_PRESET_REFS='0';
    assert.equal(L.load('agent',settings,{preset_id:'relationship-dialogue-real'}),null);
    process.env.VEO_PRESET_REFS='1';
    fs.writeFileSync(path.join(realistic,'sarah.png'),'duplicate');
    assert.throws(()=>L.apply(refs,L.load('agent',settings,{preset_id:'relationship-dialogue-real'})),/Ambiguous/);
    assert.equal(L.load('agent',settings,{preset_id:'unknown'}),null);
    console.log('PASS: preset isolation, all modes, missing references, names, toggle off and ambiguous filenames.');
} finally {
    if(prior===undefined) delete process.env.VEO_PRESET_REFS; else process.env.VEO_PRESET_REFS=prior;
    fs.rmSync(dir,{recursive:true,force:true});
}
