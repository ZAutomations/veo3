# Speaking shots

The Patterns We Ignore already assigned the first line, "You've changed.", to George. Its saved speaker labels were correct. A generated video assigning that line to Sarah is an error during the Flow/Veo generation stage. The source file alone cannot reveal whether Flow's agent rewrote an individual request or Veo ignored it.

Relationship scenes now compile into a sequence of speaking shots. Every shot connects the visible character, their clothing, their voice and their exact spoken line. Only the active speaker's mouth is clearly visible. The scene returns to its shared framing after the final line. Background activities and the location reference's empty-room instructions are omitted from the speaking scene. One scene still produces one clip.

Both Agent and Ingredients use this sequence. Ingredients reconstructs it from the structured dialogue even when an older Extend prompt is cached. Original words, turn order, scene count and source speaker ownership are preserved.

This follows the recommendation to describe each character's appearance, voice, action and dialogue in [Google DeepMind's Veo prompting guide](https://deepmind.google/models/veo/prompt-guide/). It is a prompt correction, not a verified guarantee about generated audio. Tests check the actual outgoing text, not the voices in a newly generated video.

The updated 18-scene story and prompt files have backups. Existing videos are unchanged. Existing Agent project checkpoints remain intact; because the story's generation instructions changed, their fingerprint protection can require a fresh project. Do not delete checkpoints to force a replay of all clips in the existing project.
