import { dispatch, type HandlerName } from "./api";
import { apiDeps } from "./container";

/** Adaptateur Next.js : fichier route.ts → handler indépendant du framework. */
export function route(name: HandlerName) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => dispatch(name, req, apiDeps(), await ctx.params);
}
