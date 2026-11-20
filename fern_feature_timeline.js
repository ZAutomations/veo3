'use strict';
function forScene(scene,seconds=10){
 const shots=scene.shots||[];
 const shot=shots.find(s=>Number(s.end_seconds)-Number(s.start_seconds)>=2.8);
 const lines=['FERN EXECUTION TIMELINE: The following phases override generic slow/continuous pushes for the SAME target; retain supplied actions, subjects, chronology and documentary style. These are generated inside this clip, not post-production transitions.'];
 if(shot){const a=+shot.start_seconds,b=+shot.end_seconds,zin=a+.15,inside=zin+.3,hold=inside+Math.min(2.8,b-a-.8),out=hold+.3;
 lines.push(`FEATURE TARGET: principal physical object or feature explicitly visible in this supplied shot: ${shot.visual}. Keep this target centred. ${zin.toFixed(2)}–${inside.toFixed(2)}s SNAP IN to about 2× detail; ${inside.toFixed(2)}–${hold.toFixed(2)}s HOLD camera position/scale while the actual action continues; ${hold.toFixed(2)}–${out.toFixed(2)}s SNAP OUT to the original wider context. Do not replace this hold with a continuous drift or zoom oscillation.`);
 }
 for(let i=0;i<Math.min(shots.length,3);i++){
 const s=shots[i],a=+s.start_seconds,b=+s.end_seconds;if(!Number.isFinite(a)||!Number.isFinite(b)||b-a<1)continue;
 lines.push(`FRAMING ${i+1} ROUND BADGE: choose the recognizable icon of the important subject explicitly shown here (${s.visual}); no extra subject or inferred fact. Entry ${Math.min(a+.35,b-.6).toFixed(2)}s: spring-scale a small circular pictogram into view beside that subject, draw a teal/amber luminous outer ring with travelling arc, and play one audible popup/plop. Hold stable through this shot's explanation; exit ${(b-.3).toFixed(2)}–${b.toFixed(2)}s: shrink ring/icon toward its anchor with a curved trail and synchronized swoosh. Never cover the actual action; no more than two overlays. Exact supplied numeric/date labels keep their own typewriter timing and ticks. No music-only substitution for these sound cues.`);
 }
 return shots.length?lines.join('\n'):'';
}
module.exports={forScene};
