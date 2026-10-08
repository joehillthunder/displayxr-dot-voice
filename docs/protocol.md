# Bridge protocol

The bridge (`ws://127.0.0.1:8787/ws`) relays JSON messages between **controllers** (the MCP
server) and **displays** (the display page). Types live in `shared/protocol.ts`.

## Handshake

Every socket's first message, within 3 s:

```json
{ "type": "hello", "v": 1, "role": "display", "secret": "<BRIDGE_SECRET>", "name": "displayxr" }
```

The bridge answers `{ "type": "welcome", "v": 1, "role": "display" }`, or closes with code
`4003` (bad secret or no hello), `4001` (timeout), `4002` (malformed) or `4008` (more than 50
messages in 10 s). Messages are capped at 16 KB.

## Commands (controller → display)

```json
{ "type": "command", "id": "<uuid>", "cmd": "show_model", "args": { "name": "astronaut" } }
```

| `cmd` | `args` |
|---|---|
| `show_model` | `{ name }` or `{ url }` (`.glb` / `.gltf`) |
| `show_splat` | `{ name }` or `{ url }` (`.ply` / `.sog`) |
| `set_mode` | `{ mode: "2d" \| "3d" }` |
| `start_call` | `{}`: shows a local Start button; nothing opens the camera until it's pressed |
| `clear` | `{}` |

The bridge rejects any other `cmd`. With no display connected, it answers at once with
`ok: false`. After 20 s without an answer it reports a timeout.

## Results and state (display → controller)

```json
{ "type": "result", "id": "<same id>", "ok": true, "message": "showing astronaut",
  "state": { "content": { "kind": "model", "name": "astronaut", "url": "…" },
             "mode": "3d", "woven": true, "invite": null } }
```

Displays also send `{ "type": "state", "state": … }` when something changes by itself (a person
joins a call, the panel changes mode). The bridge forwards these to every controller and replays
the latest one to new controllers.

`woven: true` means the page is in the DisplayXR Browser with a live inline-3D session.
