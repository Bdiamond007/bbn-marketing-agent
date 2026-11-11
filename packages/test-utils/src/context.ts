import type {} from "vitest";

/** Valeurs fournies par le globalSetup DB aux tests (`inject("dbUrls")`). */
export interface DbUrls {
  appUrl: string;
  migrationUrl: string;
  adminUrl: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: DbUrls;
  }
}
