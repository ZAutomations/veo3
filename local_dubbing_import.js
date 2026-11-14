// Parse existing ready-import scripts only. Never imports projects or generates media.
const fs=require('fs');
const sources=require('./ready_script_parser').parse(fs.readFileSync(process.argv[2],'utf8'));
process.stdout.write(JSON.stringify(sources.map(s=>({title:s.title,preset_id:s.preset,scene_seconds:s.seconds,multilingual_translation_mode:'supplied_only',scenes:s.clips.map(c=>({script_line:c.narration||'',dialogue:c.dialogue||[],narration_translations:c.narrations||{},dialogue_translations:c.dialogue_translations||{}}))}))));
