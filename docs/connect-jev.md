# Connecting Jev

Jev judges code and chooses the world's components through OpenRouter. A new
world needs your OpenRouter key. The showcase uses bundled answers and opens
without one.

## Configure the key

Set `OPENROUTER_API_KEY` in the environment before starting Gaia. In Bash, read it without putting it in shell history:

```sh
read -rs -p "OpenRouter key: " OPENROUTER_API_KEY
export OPENROUTER_API_KEY
```

In Zsh, use `read -rs "OPENROUTER_API_KEY?OpenRouter key: "` in place of the
first line. In PowerShell:

```powershell
$secure = Read-Host "OpenRouter key" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:OPENROUTER_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
```

Set `GAIA_JEV` to `live`, then run `pnpm dev`. In PowerShell, set it with
`$env:GAIA_JEV = "live"`. In Bash or Zsh, use `export GAIA_JEV=live`.

The Rust engine reads the key and passes it to curl on stdin. The key never
crosses the engine's JSON-RPC protocol and never appears in request logs or
command-line arguments. Clearing the variable removes it from that shell's
environment.

## Cost and consent

The [README](../README.md#get-started) gives rough costs for first openings and
updates. Gaia estimates request cost before sending, prints usage in the
terminal and reuses saved answers when requests are unchanged. Composing the
world's things depends on Jev's first answers, so the estimate prices it at
about two requests for each thing in the world. Estimates are approximate. The
connector's rate and token estimate are defined in
[`engine/src/jev/client.rs`](../engine/src/jev/client.rs).

There is no default spend limit. To set one, close Gaia and set the
`settings.jev-spend-limit` entry in `<userData>/projects/app/store.json`:

```json
{"settings":{"jev-spend-limit":{"usd":0.25}}}
```

Preserve other entries when editing an existing store. If a world's estimate
exceeds the limit, the waiting screen asks **Go ahead** or **Not now**.
**Not now** leaves the world unopened, and opening it again asks again.

The engine's understanding requests include source code and neighboring
signatures. World design requests use derived facts and descriptions. See
[the two Jev paths](architecture.md#the-two-jev-paths) for their boundaries.

## Saved answers

The app uses Electron's per-user data folder:

| Platform | `userData` |
| --- | --- |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Gaia` |
| Windows | `%APPDATA%\Gaia` |
| macOS | `~/Library/Application Support/Gaia` |

`GAIA_DATA_DIR` overrides the store directory. Each project's answers live in
`projects/<project>/store.json`. A Git project's ID comes from its root
commit. On Linux, the engine's command-line fallback directory can differ from
Electron's, so set `GAIA_DATA_DIR` when tools and the app share a store.

To forget a project's answers, remove only that project's directory. The `app`
project holds application settings and recent worlds. Bundled fixture answers
are separate from these stores.

Without live access or a key, Gaia can open a world if all its answers are
already saved. If an answer is missing, failed or invalid, the world stays
unopened, and Gaia explains why and offers a retry. Gaia never substitutes
invented judgments.

## Local development

To exercise the connector without sending code to OpenRouter, use the local
stand-in for OpenRouter's Decisions API. Start it in one terminal:

```sh
pnpm openrouter-stand-in --port 8787
```

In another terminal, set `GAIA_JEV=live`,
`GAIA_JEV_ENDPOINT=http://127.0.0.1:8787/api/alpha/decisions`, and
`GAIA_DATA_DIR` to a temporary directory, then run `pnpm dev`.

`GAIA_JEV_ENDPOINT` accepts loopback addresses only. The engine sends a
placeholder key to the stand-in and does not read `OPENROUTER_API_KEY` for it.
Keep the trial store apart from real saved answers.
