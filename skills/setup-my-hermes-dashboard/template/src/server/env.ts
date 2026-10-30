import os from "node:os";
import path from "node:path";

export interface Settings {
  /** First name used in the home greeting. */
  owner: string;
  /** Public address of the Hermes dashboard (`https://hermes.<domain>`), linked from the sidebar. */
  hermesUrl: string | null;
  /** Local Hermes dashboard API, never published by itself. */
  hermesApi: string;
  /** Fixed Hermes session token, when Hermes runs with `HERMES_DASHBOARD_SESSION_TOKEN`. Read from its page otherwise. */
  hermesToken: string | null;
  /** Folder of the SQLite database and the key pepper. */
  dataDir: string;
  /** The `hermes` command, for Infra (update check, fix tasks on the Hermes board). */
  hermesBin: string;
  /** Hermes's own folder (`~/.hermes`): Infra reads the daily audit reports in `cron/output`. */
  hermesHome: string;
  /** Infra checks the server every 15 minutes on its own; off in tests and with `INFRA_CHECKS=off`. */
  infraChecks: boolean;
  /** Infra creates its daily audit cron in Hermes once, on its first check; `INFRA_AUDIT=off` skips it. */
  infraAudit: boolean;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    owner: env.DASHBOARD_OWNER?.trim() || "",
    hermesUrl: env.HERMES_URL?.trim().replace(/\/+$/, "") || null,
    hermesApi: (env.HERMES_API?.trim() || "http://127.0.0.1:9119").replace(/\/+$/, ""),
    hermesToken: env.HERMES_DASHBOARD_SESSION_TOKEN?.trim() || null,
    dataDir: path.resolve(env.DATA_DIR?.trim() || ".data"),
    hermesBin: env.HERMES_BIN?.trim() || path.join(os.homedir(), ".local/bin/hermes"),
    hermesHome: path.resolve(env.HERMES_HOME?.trim() || path.join(os.homedir(), ".hermes")),
    infraChecks: env.INFRA_CHECKS !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    infraAudit: env.INFRA_AUDIT !== "off",
  };
}
