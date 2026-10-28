const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const DEFAULT = path.join(ROOT, 'Preset References');
const key = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
function presets() {
    return ['styles.json', 'genai_styles.json'].flatMap(file => {
        const db = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        return db.styles || db.presets || [];
    }).filter(p => p.id);
}
function ensureFolders() {
    fs.mkdirSync(DEFAULT, {recursive:true});
    for (const p of presets()) fs.mkdirSync(path.join(DEFAULT, p.id), {recursive:true});
}
function readStory(source) {
    if (source && typeof source === 'object') return source;
    if (!source || !fs.existsSync(source)) return {};
    if (fs.statSync(source).isDirectory()) {
        const files = fs.readdirSync(source).filter(f => /_story\.json$/i.test(f));
        if (files.length !== 1) return {};
        source = path.join(source, files[0]);
    }
    return JSON.parse(fs.readFileSync(source, 'utf8').replace(/^\uFEFF/, ''));
}
function load(mode, settings, source) {
    settings ||= fs.existsSync(path.join(ROOT,'gui_settings.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT,'gui_settings.json'),'utf8')) : {};
    const enabled = process.env.VEO_PRESET_REFS === undefined
        ? settings.preset_reference_modes?.[mode] ?? true : process.env.VEO_PRESET_REFS === '1';
    if (!enabled) return null;
    const story = readStory(source), catalog = presets();
    const explicit = story.preset_id || story.preset || story.style_id;
    const inferred = catalog.filter(p => (p.label || p.name) === story.niche);
    const id = explicit || (inferred.length === 1 ? inferred[0].id : null);
    if (!id || !catalog.some(p => p.id === id)) return null;
    ensureFolders();
    const config = settings.preset_reference_library?.[id];
    const folder = typeof config === 'string' ? config : config?.folder || path.join(DEFAULT,id);
    if (!fs.existsSync(folder)) throw Error(`Preset reference folder does not exist: ${folder}`);
    const result = fs.readdirSync(folder, {withFileTypes:true}).filter(f=>f.isFile() && /\.(png|jpe?g|webp)$/i.test(f.name)).map(f=>({
        name:path.parse(f.name).name, localFile:path.resolve(folder,f.name), presetReference:true
    }));
    // Migrate the former approved couple only into its original realistic preset.
    if (id === (/^relationship-dialogue(?:-(?:real|ghibli|3d|colorful-cartoon))?$/.test(settings.gen_preset || '') ? settings.gen_preset : 'relationship-dialogue-real') && !settings.preset_reference_library && settings.agent_saved_couple !== false) {
        for (const name of ['Sarah','SAM']) {
            const file = settings[`couple_${name.toLowerCase()}_file`] || (name === 'SAM' ? settings.couple_george_file : null);
            if (file && fs.existsSync(file) && !result.some(r=>key(r.name)===key(name))) result.push({name,localFile:path.resolve(file),presetReference:true});
        }
    }
    return result;
}
function apply(refs, library) {
    return refs.map(ref => {
        const clean = {...ref};
        if (clean.presetReference) { delete clean.localFile; delete clean.presetReference; }
        const matches = (library || []).filter(r => key(r.name) === key(ref.name));
        if (matches.length > 1) throw Error(`Ambiguous preset reference ${ref.name}: keep one image with that name.`);
        return matches.length ? {...clean,localFile:matches[0].localFile,presetReference:true} : clean;
    }).sort((a,b)=>Number(!a.localFile)-Number(!b.localFile));
}
module.exports = {load, apply, readStory, ensureFolders, key, DEFAULT};
