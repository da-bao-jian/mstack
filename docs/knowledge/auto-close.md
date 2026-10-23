# Auto-close

## Simple

Auto-close lets the worker end a position when its funding rule no longer passes. It is separate from liquidation protection. A size mismatch or a missing leg can also lead to a close. Read the reported close reason and error before deciding what happened. A request to close is not proof that both legs have closed.

## Precise

The task exposes `auto_close` and `min_funding_apy` for funding-target auto-close. The current server also applies that setting to its pre-open carry gate. Size-mismatch control has its own `size_mismatch_pct` and `size_mismatch_suppressed` boolean; suppression means the worker is holding that rule off. Do not infer suppression from the configured threshold. Statuses such as `mismatch_checking`, `leg_gone_checking`, and `closing` describe intermediate work. `close_reason`, `error`, and `error_context` report the outcome and its context. MoB does not publish the complete worker timing or confirmation policy, so mstack does not invent a local threshold evaluator or infer a close from one funding quote. mstack reads this status only.
