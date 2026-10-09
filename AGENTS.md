# Protected working behavior

The user asked on 2026-10-07 to preserve the working automation so later changes do not reintroduce these issues. Treat the saved baseline under `backups/stable_20261007/` as the recovery copy, not as disposable extra files.

Preserve these contracts unless the user explicitly requests changing the relevant behavior:

- Joining follows the resolved story mapping in `manifest.json`. Download filenames are not story scene numbers. Never substitute filename order for an unresolved story mapping or silently approve an uncertain mapping.
- Manual selected generation ignores the normal batch checkpoint, attaches the required character/location references, applies and saves GUI model/ratio settings, and waits for the selected clips before continuing. Never pass the inspection-only `--settings` command to a generation run or report an inspection as completed generation.
- Automatic generation preserves checkpoints, waits for each batch, and does not resend completed batches or use conversation-level Try again to regenerate everything.
- Full-grid scans load older media through wheel scrolling over the media list. Downloads exclude references, preserve verified existing downloads, validate playable media, and select the original video in the resolution submenu.
- Agent and Ingredients workflows remain separate. A fix to one must not silently change the other's reference or continuation behavior.
- Preserve the user's approved character identities, preset style, calm respectful dialogue and 0.30-second speaker gap when working on unrelated features.

Before changing these paths: inspect the current behavior, keep a recovery copy, make the smallest change needed, and run `node tests/stable_workflows.js` and `python tests/stable_gui_order.py`. Add a focused check when fixing a new concrete regression. Never claim tests guarantee future compatibility with Google's UI or model output.

User GUI choices such as model, ratio and story remain editable. This protects working code behavior; it does not freeze the user's controls.
