# PARA Companion

**PARA Companion** is an offline, local-CPU AI assistant for organizing Obsidian
vaults using the PARA method: Projects, Areas, Resources, and Archives.

AI inference runs locally in a WebAssembly worker. On first setup, the plugin
downloads its model; after that, model inference runs on your computer without
a cloud AI service.

## Features

- Organize, rename, tag, and format notes in your vault.
- Chat with notes and use local tools to search and update vault files.
- Process inbox files and configure destination folders and templates.
- Run the local Qwen model on your CPU.

## Build

Requires Node.js and npm.

```sh
npm install
npm run build
```

The build produces `main.js`, `styles.css`, and `wasm/wllama.wasm` in the
repository root. Copy those files and `manifest.json` into
`.obsidian/plugins/para-companion/` in your vault, then enable PARA Companion in
Obsidian.

Run the test suite with `npm test`.

## Privacy

Model inference is local. The model is downloaded during initial setup, and
features that retrieve external content (such as YouTube transcripts) require
an internet connection.

## Attribution

Vibcoded by ckiser074, forked from Nexus-JPF/note-companion.

## License

MIT. See [LICENSE](./LICENSE); the original upstream copyright notice is
preserved.
