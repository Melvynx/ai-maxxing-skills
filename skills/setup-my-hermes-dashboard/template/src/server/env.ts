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
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  return {
    owner: env.DASHBOARD_OWNER?.trim() || "",
    hermesUrl: env.HERMES_URL?.trim().replace(/\/+$/, "") || null,
    hermesApi: (env.HERMES_API?.trim() || "http://127.0.0.1:9119").replace(/\/+$/, ""),
    hermesToken: env.HERMES_DASHBOARD_SESSION_TOKEN?.trim() || null,
    dataDir: path.resolve(env.DATA_DIR?.trim() || ".data"),
  };
}
