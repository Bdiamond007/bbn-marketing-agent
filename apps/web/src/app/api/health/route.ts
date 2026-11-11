import { NextResponse } from "next/server";
import { serverConfig } from "../../../server-config";

export const dynamic = "force-dynamic";

/** Sonde de vivacité : n'expose aucun secret ni détail de configuration au-delà du mode. */
export function GET() {
  const cfg = serverConfig();
  return NextResponse.json({ status: "ok", env: cfg.APP_ENV, adapterMode: cfg.ADAPTER_MODE });
}
