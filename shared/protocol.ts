// Wire protocol between controllers (MCP server, tests) and displays, relayed by the bridge.
// Every message is one JSON object. See docs/protocol.md.

export const PROTOCOL_VERSION = 1;
export const COMMANDS = ['show_model', 'show_splat', 'set_mode', 'start_call', 'clear'] as const;
export type Command = (typeof COMMANDS)[number];
export type Role = 'display' | 'controller';

export interface Hello { type: 'hello'; v: number; role: Role; secret: string; name?: string }
export interface CommandMsg { type: 'command'; id: string; cmd: Command; args: Record<string, unknown> }
export interface ResultMsg { type: 'result'; id: string; ok: boolean; message?: string; state?: DisplayState }
export interface StateMsg { type: 'state'; state: DisplayState }

export interface DisplayState {
  content: { kind: 'model' | 'splat' | 'call' | 'none'; name?: string; url?: string };
  mode: '2d' | '3d';
  /** True when the page is in the DisplayXR Browser with an inline-3D session. */
  woven: boolean;
  invite?: string | null;
}

export const MAX_MESSAGE_BYTES = 16 * 1024;

export function isCommand(x: unknown): x is Command {
  return typeof x === 'string' && (COMMANDS as readonly string[]).includes(x);
}
