# Worker

## Simple

The MoB worker runs on the server and manages tasks using approved venue keys. It places and closes orders and runs the configured protection rules. The CLI reads what the server reports. A pending task is still waiting for work, and a closing task may still hold exposure. Funding accrued is an estimate until checked against venue records.

## Precise

The worker can place and close orders, trim both legs, resize, neutralize exposure, and adjust isolated margin. Its workflow never deposits, withdraws, or transfers funds. That workflow restriction is distinct from the wider capabilities of a Lighter venue key. Task status, actual leg sizes and entries, protection suspension, mismatch suppression, notices, and errors come from the server's public projection. `funding_usd` is labeled an estimate and accompanied by `funding_updated_at`. Leverage and margin-mode fields can be stored metadata while a browser-local key applies the setting, so mstack does not treat them as proof of venue configuration. MoB does not publish the complete worker internals, and server availability or a reported action does not guarantee a venue fill. The CLI never starts a local trading worker.
