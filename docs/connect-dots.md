# Connecting an agent

The MCP server is agent-neutral: anything that speaks MCP over Streamable HTTP can drive the
display. This page covers OpenAI dots, ChatGPT, Claude, and the two command sources that need no
cloud agent.

Before you start, run `setup-windows.bat` and check that `npm run mock -- demo` moves the
display. Every agent below calls the same six tools that the mock CLI calls.

## What we know about dots (as of 8 Oct 2026)

From OpenAI's own docs:

- A dot "can use supported plugins installed and enabled for your account", and your existing
  ChatGPT app permissions apply to it
  ([Computers and apps](https://learn.chatgpt.com/docs/dots/computers-and-apps)).
- Workspace admins: "Only supported connections a member already uses in ChatGPT may be available
  to their dot" ([Manage dots](https://help.openai.com/en/articles/20001554-manage-dots-in-chatgpt-workspaces)).
- You can message a dot from ChatGPT (text or voice calls on desktop), Slack and Microsoft Teams
  ([Messaging](https://learn.chatgpt.com/docs/dots/channels)).
- Dots launched 29 Sep 2026 for Pro and Business Premium; Enterprise is a beta that's off by default.

**Not documented:** whether a custom MCP plugin added in developer mode counts as a "supported
plugin" for a dot. The only way to find out is to try it (step 3 below). If it doesn't work, use
the [voice fallback](#voice-fallback-no-dots-needed).

## 1. Make the MCP server reachable from OpenAI

ChatGPT calls MCP servers from OpenAI's cloud, so `http://127.0.0.1:8790/mcp` isn't reachable.
Pick one option from [tunnels.md](tunnels.md):

- **OpenAI Secure MCP Tunnel** (recommended for ChatGPT and dots): no public URL.
- **Cloudflare named tunnel**: a public HTTPS URL, protected by your bearer token.

## 2. Add the plugin in ChatGPT

OpenAI's flow ([Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt),
[Developer mode](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt)):

1. Turn on developer mode. On Business/Enterprise, an admin enables custom MCP connectors under
   Workspace settings → Permissions & roles.
2. In ChatGPT, go to Plugins (or Apps) → Create and add a custom MCP server:
   - Public endpoint: `https://<your-host>/mcp` (the `/mcp` path is required).
   - Secure MCP Tunnel: pick your tunnel.
3. Authentication: this server takes `Authorization: Bearer <MCP_AUTH_TOKEN>` (from `.env`).
   **Unverified:** OpenAI's docs name OAuth 2.1 and don't say whether a static bearer token can be
   entered. If your connector screen offers only OAuth or "No auth", stop there and open an issue.
   OAuth support is the planned next step. Don't switch the server to no-auth on a public URL.
4. Scan tools. You should see `list_assets`, `show_model`, `show_splat`, `set_mode`,
   `start_call` and `clear`.
5. In a ChatGPT chat with the plugin enabled, say "show the astronaut on my 3D display".

## 3. Try it from your dot

1. Make sure the plugin is installed and enabled for your account (step 2).
2. Message your dot in ChatGPT, Slack or Teams: "Show the planet on my 3D display."
3. If the dot says it can't access the tool, or never calls it, the plugin isn't a supported
   connection for dots on your plan yet. Use the voice fallback.

Please report what happened (plan, surface, result) in an issue. That's the information the
docs don't have yet.

## Claude (Claude Code, Claude Desktop, or any MCP client)

Local, no tunnel:

```sh
claude mcp add --transport http displayxr http://127.0.0.1:8790/mcp --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Then ask Claude to "show the ambulance on the 3D display". Other MCP clients take the same URL
and header.

## Voice fallback (no dots needed)

```bat
setup-windows.bat voice
```

Put `OPENAI_API_KEY` in `.env`, open http://localhost:8791, press **Start talking** and allow the
microphone. The page runs a Realtime voice agent (OpenAI Agents SDK, WebRTC). Each tool call goes
to the local voice server, which calls the MCP server as an MCP client. Nothing needs a tunnel,
and your API key never reaches the browser; the page only gets a short-lived `ek_` key.

Optional `.env` settings: `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2.1`) and
`OPENAI_REALTIME_VOICE` (default `marin`).

## Mock CLI (no OpenAI account)

```sh
npm run mock              # interactive: list, model astronaut, splat planet, mode 2d, call, clear
npm run mock -- demo      # every tool in turn
```
