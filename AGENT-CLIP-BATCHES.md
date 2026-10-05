# Agent Mode clip batches

Generate batch now sends five scene prompts by default per request. For fourteen
scenes, the requests contain scenes 1-5, 6-10, and 11-14. Each contains the same
cast, style, location and blocking instructions. The next request runs only
after the driver reports the exact cumulative number of ready clips, with no
failed or generating video tiles.

This applies to the Agent Mode batch pipeline. The standalone manual Run Agent
button still uses its existing direct driver.

## If a batch fails or the laptop restarts

1. Keep the Flow project and its generated clips.
2. In Agent Mode Auto, choose the second phase, Clip generation.
3. Choose Existing stories and add the same story JSON.
4. Paste the SAME Flow project URL.
5. Click Generate batch.

The saved `agent_batches_<project-id>.json` in the story folder records both
finished batches and a batch that was started but not confirmed. Recovery of an uncertain submitted batch uses failed media tile controls. A request that failed before the submit click can be prepared again. A matching Agent request error with no video media can be retried only after two confirming observations. Existing or queued clips block prompt replay. Once the current batch is ready, the next batch runs.

Do not use Flow's conversation-level Try again: it may repeat the entire
request. If individual media retry controls are absent, recovery stops. It
cannot safely guess which scenes failed from the clip count alone. Keep the
good clips and identify missing scenes before generating replacements.

A project created before this batching change has no scene batch checkpoint.
The new driver refuses to add a fresh batch over its existing clips. Use the
existing Retry failed clips action if Flow offers tile retry controls; otherwise
identify the missing scene clips manually. Smaller batches do not eliminate
Flow service/model errors.

## Verification

Offline tests cover default 5/5/4 and explicit 6/6/2 prompt ranges, stopping on a failed second batch,
resuming that batch without replay, skipping already finished work, and refusing
to mix a changed story with the old checkpoint. Live Flow generation has not
been exercised as part of this code change.
