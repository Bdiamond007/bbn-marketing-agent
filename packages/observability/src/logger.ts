import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogFields {
  requestId?: string;
  correlationId?: string;
  organizationId?: string;
  [k: string]: unknown;
}

export interface Logger {
  child(fields: LogFields): Logger;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** Logger JSON structuré, expurgé. `sink` injectable pour les tests. */
export function createLogger(base: LogFields = {}, sink: (line: string) => void = (l) => process.stdout.write(l + "\n")): Logger {
  const log = (level: LogLevel, msg: string, fields?: LogFields) =>
    sink(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact({ ...base, ...fields }) as object) }));
  return {
    child: (f) => createLogger({ ...base, ...f }, sink),
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
  };
}
