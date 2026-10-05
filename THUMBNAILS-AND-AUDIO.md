# Thumbnail prompts and dialogue volume

Every newly written story package includes:

- `thumbnail_prompt.txt`: landscape 16:9 YouTube thumbnail.
- `thumbnail_prompt_vertical.txt`: portrait 9:16 cover.

Copy the desired prompt into your image generator and supply the same character reference sheets used for the film. Thumbnail generation is manual; writing these prompts does not spend image-generation credits. Gemini designs the headline and visual hook during the existing cast/outline request. Older imported outline JSON works too: the title and description provide a fallback.

Dialogue prompts request clear, consistent speech volume from the first word, including Ingredients clip 1 and all Extend continuations. Flow still controls its generated audio mix.

The Join Clips action automatically measures and balances each clip to -16 LUFS for stories with `narration_scope: "dialogue"`. It preserves segment timing and leaves the downloaded originals unchanged. Rejoin existing downloaded clips to apply this correction. This balances the complete audio mix; it cannot isolate voices from loud music or repair incorrect spoken lines.

CLI overrides: `--normalize-audio` enables this for other stories; `--no-normalize-audio` or `--copy` preserves original loudness. Re-encoding takes longer than a stream copy.
