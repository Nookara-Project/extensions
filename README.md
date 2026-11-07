# Nookara extensions

TurboWarp / PenguinMod extensions for Nookara: sign-in, payments, data, social, profiles, voice and chat.
Load them as custom extensions from `https://ikelene.net/gallery/extensions/nookara-login.js` (start there), then add the add-ons you need.
Guide: https://nookara.cc/guides/nookara-extensions

## How it's built

`velora_extension.js` stays the one file to edit. `split/build.js` cuts it into a small core and add-ons, using `split/manifest.js` to say which block goes where.

| File in `dist/` | ID |
|---|---|
| `nookara-login.js` (core) | `ikelenenookaralogin` |
| `nookara-payments.js` | `ikelenenookarapayments` |
| `nookara-data.js` | `ikelenenookaradata` |
| `nookara-social.js` | `ikelenenookarasocial` |
| `nookara-profiles.js` | `ikelenenookaraprofiles` |
| `nookara-voice.js` | `ikelenenookaravoice` |
| `nookara-chat.js` | `ikelenenookarachat` |
| `nookara-forums.js` (written by hand in `split/forums.js`) | `ikelenenookaraforums` |

## After changing `velora_extension.js`

```bash
cd split
npm i
node build.js
node check.js
```

- `build.js` stops without writing anything if a new block or socket message type has no home in `manifest.js`, or if a patch no longer matches the source. Add it to the manifest.
- `check.js` runs the blocks of the old extension and the split ones against the same fake server and compares results and requests. It also checks missing-core errors, load order, socket frames, logout and the project converter. Blocks that wait on a popup or a real socket reply are only checked to exist.
- Commit the rebuilt `dist/` and `migrate/block-map.json`.

## How the add-ons connect

The core sets `runtime.ext_ikelenenookaralogin = this` itself, because neither TurboWarp nor PenguinMod does that for custom extensions. Add-ons use `.api` on it (contract in `/guides/nookara-extensions`). They look it up when used and watch `EXTENSION_ADDED`, because a project loads its extensions in parallel. There is one Nookara socket, owned by the core, and every frame is passed on to the add-ons.

Bump `API_VERSION` in `build.js` only for a breaking change. An add-on refuses a core with a different version and says to update it.

Voice and Chat also reach each other: voice channels on Ember servers need Chat to find the channel, and the server gateway hands voice frames back to Voice. Voice says so if Chat is missing; Chat works alone.

## Project converter

`migrate/` turns a project that used the old all-in-one `velora_extension.js` into one that uses the split extensions (served at `nookara.cc/assets/extensions/migrate.html`). `jszip.min.js` is JSZip (MIT).

## License

MIT, see [LICENSE](LICENSE).
