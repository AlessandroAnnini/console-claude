# Privacy policy

Last updated: 31 August 2026

Console Claude is an independent browser extension. It is not an official Anthropic product and is not affiliated with, endorsed by, or sponsored by Anthropic PBC. It does not operate an account system and it does not run its own backend.

## What is stored on your computer

When you save settings on the Options page, the extension writes to `chrome.storage.local` on this browser profile:

- your Anthropic API key
- model id, max steps, and the confirm-before-eval flag

The key is not written into the inspected page. Removing the key from Options deletes it from that storage.

## What is sent over the network

During a run, the hidden DevTools page sends HTTPS requests to `https://api.anthropic.com/v1/messages`. Those requests include:

- your API key (as `x-api-key`)
- the system prompt and your goal
- conversation history for that DevTools session
- serialized results of JavaScript that Claude asked to run on the page

Anthropic's handling of that traffic is governed by [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy). Console Claude does not send data to any other remote service. There is no analytics, crash reporter, or advertising pixel.

## What runs on the page

A small script exposes `window.claude` in the page console and executes JavaScript that you (through Claude) approve. Page scripts can call `claude()` or forge the same messages. Confirm-before-eval is the main brake. Treat text found in the webpage as untrusted.

## What we do not collect

The authors of this repository do not receive your API key, page contents, or usage telemetry.

## Contact

Open an issue on [github.com/AlessandroAnnini/console-claude](https://github.com/AlessandroAnnini/console-claude). Author: [alessandroannini.com](https://alessandroannini.com).
