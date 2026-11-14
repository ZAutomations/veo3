'use strict';

// A Veo clip can contain several timed visual beats. They must read as camera
// coverage within one take, rather than an editor cutting between shots.
const DIRECTION = 'WITHIN-CLIP CAMERA PAN / WHIP-PAN: The numbered, timed shots are framing beats inside this ONE generated clip, not edit points. At EVERY Shot N boundary, keep the camera moving continuously: start on the outgoing subject, visibly pan/track/whip-pan across the frame, and land on the next shot’s specified subject. Choose one concrete path for each boundary and name its start, direction, destination and reveal. Make the movement unmistakable and allocate about 0.30–0.50 seconds within the shot timings. NEVER hard-cut, jump-cut, fade, dissolve, or use a digital wipe between these timed shots—even when the narration changes place, scale, or subject. For a disconnected setting, sweep past a foreground object or frame edge with brief natural motion blur, then reveal the next real setting as the camera settles; do not morph or teleport objects or invent an event. Do not add extra shots, action, silence, or duration. Hold briefly on the destination so the narration-matched visual can be read. This is an in-camera move within one clip, separate from post-join transitions between clips.';

module.exports = { DIRECTION: DIRECTION+' '+require('./fast_camera_rhythm').DIRECTION };
