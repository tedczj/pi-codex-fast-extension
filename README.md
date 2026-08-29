# Pi Codex Fast Extension

Enable OpenAI Codex priority processing in [Pi](https://github.com/earendil-works/pi) with one small extension.

The extension adds `service_tier: "priority"` to provider requests whenever the active Pi model uses the `openai-codex` provider. Requests for every other provider are left unchanged.

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

No command or configuration is required. Start Pi with an OpenAI Codex model after installing the package:

```bash
pi --provider openai-codex
```

The extension runs for every provider request in that session and returns a new payload with:

```json
{
  "service_tier": "priority"
}
```

It does not mutate the original payload and does not affect providers such as `openai`, `anthropic`, or `google`.

## Development

```bash
npm install --ignore-scripts
npm test
npm run check
```

## License

MIT
