# Actual Flow balance in Accounts

FLOW CREDITS LEFT replaces the Clips / Month display. Values come from Flow's visible `.credits-count` after opening the profile panel through `.tier-chip`. The `.credits-link` Email parameter must match the saved account email. No model-cost estimates, automatic +50 additions or assumed monthly resets are used.

Make an account active, keep its automation Chrome signed in, then click Refresh credits. Other accounts keep their timestamped last-known reading. Refresh never switches browser accounts. An identity mismatch refuses to overwrite the balance; failed reads preserve the previous value and mark it stale.

Normal Studio generation/reference operations refresh before and after each operation (including each queued story) and after failures; account activation refreshes afterwards. These reads run in a separate temporary tab and never submit prompts or change the generation composer. They are non-fatal: an unavailable balance does not trigger a generation retry. A displayed change is a balance delta, not proof that all change was caused by this job; refunds, daily refreshes, family sharing and other devices can also affect it.

Account data is saved only in local, gitignored accounts.json. Existing clip counters and account-allocation limits remain intact. The last-updated timestamp is the actual successful observation time, not the latest failed attempt. Inactive accounts are not silently switched just to refresh their values.

The generation engine is not given a new credit-exhaustion failover policy. Use existing account allocation controls. Official behavior and allowances: https://support.google.com/flow/answer/16526234?hl=en

Tests cover the supplied HTML, zero/thousands counts, hidden duplicate DOM, email mismatch, ambiguous counts, actual balance increases, stale preservation, inactive-account guard and temporary-tab cleanup. A live read requires the signed-in automation Chrome to be open.

Manual Refresh credits can launch the current saved profile when no CDP browser is running. If a sign-in-only Chrome window already owns that profile, Chrome cannot add a debugging port to it in-place; use Reconnect active browser for that same account, then Refresh credits. This explicit action uses the existing account-activation confirmation. Credit reads do not close/switch profiles. Automatic refreshes never start a missing browser. Configured automation ports are honored.
