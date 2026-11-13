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

Running `npm run build` generates a ready-to-copy `extension/` folder containing
the compiled plugin, manifest, styles, and required WASM asset. Copy the
contents of `extension/` into
`<My-Vault>/.obsidian/plugins/para-companion/`, then enable PARA Companion in
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
