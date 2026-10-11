# Management checks

Resize uses base amounts, rounds toward current sizes, and checks venue floors.
Show quantized targets with the requested values. Use known leverage from the
task; absent values stay unknown.

Close accepts a non-terminal owned task. Other management commands require a
running owned task. The request is replayable inside the server's 300-second
window because these routes have no nonce. A local Proposal expires after
300 seconds and can be signed once.
