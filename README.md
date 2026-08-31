# Console Claude

Chrome extension that turns the DevTools console into an agentic REPL. You type a goal. Claude inspects the live page by running JavaScript. It is not a chatbot overlay.

**This is an independent project. It is not an official Anthropic product and is not affiliated with, endorsed by, or sponsored by Anthropic PBC.** You bring your own Anthropic API key and pay Anthropic for usage.

```js
claude('Find the video player')
await claude('Why does playback reset to 1x?')
claude`set playback to 2.5x`
claude.stop()
claude.reset()
claude.help()
```

`await` is optional. The run starts immediately and the answer is logged either way.

Architecture: [docs/architecture.md](docs/architecture.md). Privacy: [docs/privacy.md](docs/privacy.md).

## Load unpacked

1. `npm install`
2. `npm run build`
3. Chrome → `chrome://extensions` → Developer mode → Load unpacked → select **`dist`**
4. Open Options (toolbar icon). Paste an Anthropic API key. Save.
5. Open DevTools on an `http` or `https` page. Type `claude('…')` in the console.

DevTools must stay open. After you reload the extension, close DevTools and open it again. The visible console is not enough; a hidden DevTools page owns the agent loop.

Confirm-before-eval defaults on. Uncheck **Ask before each JavaScript run**, or set `claude.config.confirm = false`. After a key is saved, Options shows **Remove key** instead of the password field.

Default model is `claude-sonnet-5`. Options lists other current Claude API models.

You pay Anthropic for API usage. This repo does not include a key.

Source: [github.com/AlessandroAnnini/console-claude](https://github.com/AlessandroAnnini/console-claude). Author: [alessandroannini.com](https://alessandroannini.com).

## Scripts

```bash
npm test          # unit tests
npm run test:watch
npm run test:e2e  # build + Playwright (Chromium channel, not headless shell)
npm run build     # write dist/
npm run pack      # build + zip dist/ for the Chrome Web Store
npm run lint
npm run dev       # watch all four Vite configs
```

## Security

The API key stays in `chrome.storage.local` and is used only from the DevTools page. The MAIN-world stub must never see it. Confirm-before-eval is the brake against a page that calls `claude()` or forges `postMessage`. Privacy policy: [docs/privacy.md](docs/privacy.md).

## License

[AGPL-3.0](LICENSE)
