import { ApiKeys } from "./db/api-keys";
import { openDb, readPepper, type Db } from "./db/client";
import { loadSettings, type Settings } from "./env";
import { Hermes } from "./hermes";

/** Every long-lived piece of the server, built once on first use. */
export interface App {
  settings: Settings;
  hermes: Hermes;
  /** The SQLite database: modules that keep their own data add their tables to BOOTSTRAP and schema.ts. */
  db: Db;
  keys: ApiKeys;
}

let app: App | null = null;

export function getApp(): App {
  if (app) return app;
  const settings = loadSettings();
  const db = openDb(settings.dataDir);
  app = {
    settings,
    hermes: new Hermes(settings.hermesApi, settings.hermesToken),
    db,
    keys: new ApiKeys(db, readPepper(settings.dataDir)),
  };
  return app;
}
