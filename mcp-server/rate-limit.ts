// A token bucket: `perMinute` sustained, `burst` at once. One bucket for the whole server,
// because there is one physical display to protect.
export function tokenBucket(perMinute: number, burst: number, now = () => Date.now()) {
  let tokens = burst;
  let last = now();
  return function take(): boolean {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 60_000) * perMinute);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
