'use strict';

// Veo renders each requested clip as a separate asset. Cross-clip camera
// movement is therefore applied after a verified Join, not left to the model.
const DIRECTION = 'CLIP-TO-CLIP CAMERA HANDOFF: These are independently generated clips, so Veo cannot physically pan from the last frame of one generation into the next. Keep each clip’s final and opening composition clean and readable; do not request a black frame, split screen, extra shot, extra duration, or a hard cut for a connected story beat. After Join, the tool applies a visible 0.65-second horizontal camera pan/swipe at every verified clip boundary when global Camera Transitions and Apply after every Join are enabled. This transition preserves the audio timeline. The raw joined MP4 remains the unedited version; view the separately named _edited.mp4 to see finishing effects. Do not add a Transition: parser field.';

module.exports = { DIRECTION };
