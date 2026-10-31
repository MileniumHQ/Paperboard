import { json, modscan, type Env } from "./modscan";

export { SteamBudget, GAMES, type Env, type Item } from "./modscan";

// Each panel API owns the first path segment of panels.ariapis.com.
const ROUTES: Record<string, ExportedHandler<Env>> = { modscan };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const segment = new URL(request.url).pathname.split("/")[1]!;
    const route = Object.hasOwn(ROUTES, segment) ? ROUTES[segment]!.fetch : undefined;
    if (!route) return json({ error: { code: "not_found", message: "Unknown panel API." } }, 404);
    return route(request as Parameters<typeof route>[0], env, ctx);
  },
} satisfies ExportedHandler<Env>;
