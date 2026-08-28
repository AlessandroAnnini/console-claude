# Console Claude

Chrome extension that turns the DevTools console into an agentic REPL. You type a goal. Claude inspects the live page by running JavaScript.

## Load unpacked

1. `npm install`
2. `npm run build`
3. Chrome → `chrome://extensions` → Developer mode → Load unpacked → select `app/dist`
4. Open the extension's **Options** page. Paste your Anthropic API key. Save.
5. Open DevTools on a page. In the console:

```js
claude('Find the video player')
claude.stop()
claude.reset()
claude.help()
```

`await` is optional. The answer is logged either way.

## Options

- **API key** — stored in `chrome.storage.local`. Never injected into the page.
- **Ask before each JavaScript run** — on by default. Uncheck for auto mode. Same flag: `claude.config.confirm`.

## Scripts

```bash
npm test          # unit tests
npm run test:e2e  # fixture page + unpacked extension
npm run build     # write dist/
npm run lint      # tsc + eslint
```
