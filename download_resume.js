const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { playableVideo } = require('./download_media_validation');

const hash = value => createHash('sha256').update(value).digest('hex');

// Stage valid files by asset identity BEFORE grid numbering can overwrite any
// old scene filename. The stable cache also survives an interrupted manifest.
function existingDownloads(outDir, projectUrl, tiles, validate = playableVideo, log = () => {}) {
    const project = (projectUrl.match(/\/project\/([^/?#]+)/) || [])[1];
    const cacheDir = path.join(outDir, '.download-cache', project);
    fs.mkdirSync(cacheDir, { recursive: true });
    const old = new Map();
    try {
        const ledger = JSON.parse(fs.readFileSync(path.join(cacheDir, 'index.json'), 'utf8'));
        for (const clip of Object.values(ledger)) if (clip.assetId && path.basename(clip.file || '') === clip.file) old.set(clip.assetId, clip);
    } catch (_) {}
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
        if ((String(manifest.projectUrl).match(/\/project\/([^/?#]+)/) || [])[1] === project) {
            for (const clip of [...(manifest.clips || []), ...(manifest.alternateClips || [])]) {
                if (clip.got && clip.assetId && path.basename(clip.file || '') === clip.file) old.set(clip.assetId, clip);
            }
        }
    } catch (_) {}
    const disk = fs.readdirSync(outDir).filter(f => /\.mp4$/i.test(f)).map(file => ({file,sha256:hash(fs.readFileSync(path.join(outDir,file)))}));
    const result = new Map();
    for (const tile of tiles) {
        if (!tile.assetId) continue;
        const stable = path.join(cacheDir, `asset_${hash(tile.assetId)}.mp4`);
        const previous = old.get(tile.assetId);
        const candidates = [stable, previous && path.join(outDir, previous.file)];
        // Previous versions cached by the unsigned URL path. Match that cache
        // locally using observed source/preview identity; no network request.
        const urls = [tile.downloadSrc, ...(tile.imgSrcs || []).map(src =>
            src.startsWith('https://flow-content.google/image/') ? src.replace('/image/', '/video/') : null)];
        for (const raw of urls.filter(Boolean)) {
            try { const url = new URL(raw); candidates.push(path.join(cacheDir, hash(url.origin + url.pathname) + '.mp4')); } catch (_) {}
        }
        const found = candidates.filter(Boolean).find(file => fs.existsSync(file) && validate(file).ok);
        if (!found) continue;
        if (found !== stable) fs.copyFileSync(found, stable);
        const sha256=hash(fs.readFileSync(stable));
        const outputFile=disk.find(d=>d.file===previous?.file&&d.sha256===sha256)?.file || disk.find(d=>d.sha256===sha256)?.file;
        result.set(tile.assetId, { file: stable, outputFile, sha256, metadata:previous, caption: previous?.caption, prompt: previous?.prompt });
        if (previous && outputFile) saveReceipt(outDir, projectUrl, {...previous,file:outputFile,sha256});
        log(`Verified existing clip ${result.size}: ${tile.assetId}; network download skipped.`);
    }
    return result;
}
function nextFilename(outDir,reserved=new Set()) {
    let number=1;
    while(true){const file=`scene-${String(number++).padStart(2,'0')}.mp4`;if(!reserved.has(file)&&!fs.existsSync(path.join(outDir,file))){reserved.add(file);return file;}}
}
function saveReceipt(outDir,projectUrl,clip){
    if(!clip.got||!clip.assetId)return;
    const project=(projectUrl.match(/\/project\/([^/?#]+)/)||[])[1];if(!project)return;
    const folder=path.join(outDir,'.download-cache',project);fs.mkdirSync(folder,{recursive:true});
    const file=path.join(folder,'index.json');let ledger={};try{ledger=JSON.parse(fs.readFileSync(file));}catch{}
    ledger[clip.assetId]=clip;fs.writeFileSync(file+'.tmp',JSON.stringify(ledger,null,2));fs.renameSync(file+'.tmp',file);
}

module.exports = { existingDownloads, nextFilename, saveReceipt };
