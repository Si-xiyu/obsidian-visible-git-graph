# Agent install notes — Visible Git Graph

This file is for coding agents asked to install **Visible Git Graph** into a user's Obsidian vault.
It is a plain Obsidian plugin: three files in a folder. No npm, no build step, no server.

## Target layout

```text
<vault>/.obsidian/plugins/visible-git-graph/
├── main.js
├── manifest.json
└── styles.css
```

`data.json` (created by Obsidian when the user changes settings) may already exist.
**Never overwrite or delete it.**

## Install

1. Ask the user for their vault path if it was not provided. Do not guess between multiple vaults.
2. Create the plugin folder if needed.
3. Download the three assets of the **latest** release:

   ```text
   https://github.com/Si-xiyu/obsidian-visible-git-graph/releases/latest/download/main.js
   https://github.com/Si-xiyu/obsidian-visible-git-graph/releases/latest/download/manifest.json
   https://github.com/Si-xiyu/obsidian-visible-git-graph/releases/latest/download/styles.css
   ```

4. Verify (see below), then tell the user to enable the plugin.

### macOS / Linux

```sh
VAULT="/path/to/vault"
PLUGIN="$VAULT/.obsidian/plugins/visible-git-graph"
mkdir -p "$PLUGIN"
BASE="https://github.com/Si-xiyu/obsidian-visible-git-graph/releases/latest/download"
for f in main.js manifest.json styles.css; do
  curl -fL "$BASE/$f" -o "$PLUGIN/$f"
done
```

### Windows (PowerShell)

```powershell
$Vault  = "C:\path\to\vault"
$Plugin = Join-Path $Vault ".obsidian\plugins\visible-git-graph"
New-Item -ItemType Directory -Force $Plugin | Out-Null
$Base   = "https://github.com/Si-xiyu/obsidian-visible-git-graph/releases/latest/download"
foreach ($f in "main.js", "manifest.json", "styles.css") {
  Invoke-WebRequest "$Base/$f" -OutFile (Join-Path $Plugin $f)
}
```

## Verify before reporting success

- All three files exist and are non-empty.
- `manifest.json` contains `"id": "visible-git-graph"`, `"isDesktopOnly": true` and a `"version"` that matches the release tag.
- Approximate sizes for `0.2.3`: `main.js` ~120 KB, `styles.css` ~21 KB.
- The plugin folder name must be exactly `visible-git-graph` (it matches `manifest.json`'s `id`).

## User action after install

Tell the user:

1. Open Obsidian → **Settings → Community plugins**.
2. Turn off Restricted mode if it is on.
3. Enable **Visible Git Graph**.
4. If Obsidian was already running, reload it (**Ctrl/Cmd + R** inside the app) so the new plugin is discovered.

No skill or tool registration is needed; the plugin adds a ribbon icon and the **Open Git Graph** command.

## Constraints

- Write only inside `<vault>/.obsidian/plugins/visible-git-graph/` and do not touch other vault files.
- Download only from `github.com/Si-xiyu/obsidian-visible-git-graph` release assets.
- Do not modify, disable or reinstall other community plugins.
- Do not run `git`, `npm` or any build step for a normal install.

## Uninstall

Remove the plugin folder. If the user wants to keep their settings, keep `data.json`; otherwise remove it too.

## Troubleshooting

| Symptom | Check |
|---|---|
| "Failed to load plugin" | `manifest.json` is present and has `"id": "visible-git-graph"`; the folder name matches the id. |
| "Git executable not found" | Install `git`, or set its absolute path in the plugin settings. |
| Plugin not listed in Obsidian | Reload the app; confirm the folder is under `.obsidian/plugins/`, not the vault root. |
| Requires a newer Obsidian | The plugin needs Obsidian **1.7.2** or newer. |
| Nothing renders for the vault | The vault must be a Git repository, or a folder inside one. |

## Developer install (only if asked)

```sh
git clone https://github.com/Si-xiyu/obsidian-visible-git-graph.git
cd obsidian-visible-git-graph
npm ci
npm run build
# copy manifest.json, dist/main.js and dist/styles.css into
# <vault>/.obsidian/plugins/visible-git-graph/
```
