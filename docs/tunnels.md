# Reaching the MCP server from the cloud

The bridge and the display stay on your PC. Only the **MCP server** (port 8790) ever needs to be
reachable from outside, and only for cloud agents (ChatGPT, dots). Claude Code, the voice
fallback and the mock CLI all run locally and need no tunnel.

| | OpenAI Secure MCP Tunnel | Cloudflare named tunnel | Cloudflare quick tunnel |
|---|---|---|---|
| Public URL | none | yes, on your domain | yes, random `trycloudflare.com` |
| Who can reach `/mcp` | supported OpenAI products in your org | anyone who has the token | anyone who has the token |
| Works with | ChatGPT, Codex, Responses API | any MCP client | **not recommended** |
| Needs | OpenAI Platform org + tunnel permissions | Cloudflare account + domain | nothing |

## Option A: OpenAI Secure MCP Tunnel (recommended for ChatGPT and dots)

`tunnel-client` runs on your PC, opens an **outbound** HTTPS connection to OpenAI and forwards
MCP requests to the local server. No inbound port, no public hostname
([OpenAI docs](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)).

1. In the OpenAI Platform, create a tunnel (Tunnels settings) and download `tunnel-client` from
   there, or from the latest `openai/tunnel-client` release. You need the *Tunnels Read and
   Manage* permission to create one and *Read and Use* to run it.
2. Configure it against the local server. These are the commands from OpenAI's docs, with our URL:

   ```sh
   set CONTROL_PLANE_API_KEY=sk-...
   tunnel-client init --profile displayxr --tunnel-id tunnel_<your id> --mcp-server-url http://127.0.0.1:8790/mcp
   tunnel-client doctor --profile displayxr --explain
   tunnel-client run --profile displayxr
   ```
3. In ChatGPT, add the plugin and choose the tunnel as the connection ([connect-dots.md](connect-dots.md)).

Keep `tunnel-client` running: requests fail while it's disconnected. OpenAI's docs say tunnel
traffic isn't emitted as Compliance Platform app events, and tunnel metadata changes go to the
Platform audit log. Public plugin submission needs a public endpoint, so this option is for your
own workspace only.

## Option B: Cloudflare named tunnel (agent-neutral)

A Cloudflare Tunnel also connects outbound, but it gives you a public `https://` hostname. Any
MCP client on the internet can reach `/mcp`; the bearer token is what keeps them out.

1. Install `cloudflared` from Cloudflare's downloads page, then log in and create a tunnel that
   routes a hostname on your domain (for example `dxr.example.com`) to `http://localhost:8790`.
   Follow Cloudflare's "Create a tunnel" guide; the exact steps depend on your account setup.
2. Tell the MCP server to accept that Host header. Requests with any other Host are refused, which
   also blocks DNS rebinding. In `.env`:

   ```
   MCP_PUBLIC_HOSTS=dxr.example.com
   ```
3. Restart the MCP server. Your endpoint is `https://dxr.example.com/mcp`.

**Why not a quick tunnel?** Cloudflare's docs say quick tunnels "do not support Server-Sent
Events". This server answers 2025-protocol MCP requests (what most clients send today) as an SSE
stream, so a quick tunnel can break them. Use a named tunnel or Option A.

## The security tradeoff

Exposing the MCP server means a remote caller can change what your display shows. Here's what
limits the damage:

- **Bearer token** (`MCP_AUTH_TOKEN`, 32 random characters) on every request, compared in constant
  time. On a public URL it's the only gate, so treat it like a password and rotate it in `.env`
  if it leaks.
- **No filesystem, shell or network access in the tools.** A tool can only pick a catalog asset or
  an `https` URL under an allowlisted prefix (`ASSET_URL_ALLOWLIST`), and forward that to the
  display.
- **Rate limit:** 20 commands per minute with a burst of 5 (`MCP_RATE_PER_MIN`, `MCP_RATE_BURST`).
- **The camera can't be turned on remotely.** `start_call` only shows a Start button; a person at
  the display has to press it.
- **The bridge is never exposed.** It listens on `127.0.0.1` and needs `BRIDGE_SECRET`.

What the token doesn't protect against: someone who has it can show any allowlisted asset, switch
2D/3D, or put up the call prompt. Keep the allowlist tight, and stop the tunnel when you're not
demoing.
