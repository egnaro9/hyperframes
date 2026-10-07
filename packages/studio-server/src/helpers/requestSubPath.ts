// The decoded path after `route` ("projects/:id/preview", "composition"), cut by segment from the raw URL:
// Hono's c.req.path leaves %40 %25 %23 %26 %3F encoded, so cutting a decoded prefix out of it misses.
export function requestSubPath(url: string, route: string): string {
  const routeSegments = route.split("/");
  const segments = new URL(url).pathname.split("/");
  const start = segments.indexOf(routeSegments[0] ?? "");
  return decodeWellFormedEscapes(segments.slice(start + routeSegments.length).join("/"));
}

// A browser sends src="100%.png" as-is, so a % without two hex digits after it is the file's own.
function decodeWellFormedEscapes(path: string): string {
  return path.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}
