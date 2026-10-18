// Validated YYYY-MM-DD range from query params (defaults: last 30 days → today).
// Validation also keeps junk out of the cache keys.
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateRange(searchParams: URLSearchParams): { from: string; to: string } {
  const today = new Date().toISOString().split("T")[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const f = searchParams.get("from");
  const t = searchParams.get("to");
  let from = f && ISO.test(f) ? f : monthAgo;
  let to = t && ISO.test(t) ? t : today;
  if (from > to) [from, to] = [to, from];
  return { from, to };
}
