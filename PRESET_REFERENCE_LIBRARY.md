# Preset reference library

The tool creates `Preset References/<preset-id>/` for each available preset.
Settings → Preset reference library lets you choose a different folder per preset.
Each generation tab has a **Use selected preset’s saved reference images** switch.
That switch applies to single stories, selected clips and story queues, and is
preserved when retrying the job.

Use the story's reference names as filenames, for example `Sarah.jpg`, `Cat.png`
or `Bedroom.webp`. Matching ignores letter case, spaces and punctuation. PNG,
JPG, JPEG and WebP are supported. Keep one image per reference name. Only files
directly inside the configured preset folder are searched.

Preparation uploads matching images first, using each story reference's name.
Missing characters and locations use the existing reference generation workflow.
Unused library images are never attached. Presets have separate folders, so
Sarah's realistic image cannot replace her cartoon image. The story must still
declare the required character and location reference names.

Approved images guide appearance; they do not rewrite dialogue, scene descriptions
or completion checkpoints. Existing per-scene model ingredient limits still apply.
On resume, existing upload receipts and reference generation receipts are reused.

Personal images are ignored by Git. The empty preset folder structure is included
in the repository. Copy your images separately when moving to another laptop.
