# character_refs

Drop one image per character here, named to match the `character_references`
map in your story JSON:

```
character_refs/
  alex_reference_sheet.jpeg
  sam_reference_sheet.jpeg
```

The engine resolves those paths relative to the **story JSON's folder**, so
`"./character_refs/alex_reference_sheet.jpeg"` means this directory.

Notes:

- `.jpg`, `.jpeg` and `.png` all work. If the exact extension is missing the
  engine retries the other two before giving up.
- Reference sheets (a face at several angles on one image) give noticeably
  better character consistency than a single portrait.
- Flow accepts a limited number of ingredients per prompt and the engine warns
  when a scene asks for more than that limit. Keep `characters` per scene short.
- These images are gitignored — they are yours, not the repo's.
