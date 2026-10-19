# `@mstack/keys`

This package stores one MoB API key per owner. Public methods return the full
secret only from `get`. `describe` returns the prefix, backend, and metadata.

Backend selection uses `MOBIUS_API_KEY` first. That backend is read-only. With
`key_store=auto`, macOS uses Keychain. Linux uses `secret-tool` when present.
Other systems use a private file under `~/.mob/keys`.

The macOS backend runs this command directly, without a shell:

```text
/usr/bin/security add-generic-password -U -s mstack.mobius-api -a <owner> -w <key>
```

The `-w` argument causes a brief same-user process-list exposure while that one
child process runs. The Linux backend avoids argv exposure and sends the secret
to `secret-tool store --label ...` on stdin. The file backend rejects symlinks,
requires a `0700` directory, and writes `0600` files through an exclusive
temporary file.
