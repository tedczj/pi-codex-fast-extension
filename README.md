# Pi Codex Fast Extension

Enable session-scoped OpenAI Codex priority processing in [Pi](https://github.com/earendil-works/pi) with one small extension.

When fast mode is enabled, the extension adds `service_tier: "priority"` to provider requests whenever the active Pi model uses the `openai-codex` provider. Requests for every other provider are left unchanged.

## Requirements

- Pi `0.84.2` or newer
- Node.js `22.19.0` or newer
- An OpenAI Codex account with access to priority processing

Availability, limits, latency, and cost are controlled by OpenAI and your account. This extension only requests the priority service tier; it cannot guarantee that OpenAI will honor it.

## Install

Install directly from GitHub:

```bash
pi install git:github.com/tedczj/pi-codex-fast-extension
```

To try it without adding it to settings:

```bash
pi -e git:github.com/tedczj/pi-codex-fast-extension
```

For local development:

```bash
pi -e /path/to/pi-codex-fast-extension
```

Pi packages execute with your full user permissions. Review extension source before installing it.

## Usage

Fast mode defaults to **off** for a project's first session. Use `/fast` to toggle it on or off:

The footer always displays `fast: off` or `⚡ fast: on`. The selected state is stored in the current session and restored when that session is resumed. A session created with `/new` inherits the previous session's state; it can then be changed independently.

When enabled with an OpenAI Codex model, every provider request gets:

```json
{
  "service_tier": "priority"
}
```

The extension does not mutate the original payload and does not affect providers such as `openai`, `anthropic`, or `google`.

## Development

```bash
npm install --ignore-scripts
npm test
npm run check
```

## License

MIT
