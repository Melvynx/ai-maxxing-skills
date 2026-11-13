import { Chat } from "./chat/chat";
import { HermesApiServer } from "./chat/hermes-api";
import { ChatStore } from "./chat/store";
import { ApiKeys } from "./db/api-keys";
import { openDb, readPepper, type Db } from "./db/client";
import { loadSettings, type Settings } from "./env";
import { Hermes } from "./hermes";
import { Infra } from "./infra/infra";

/** Every long-lived piece of the server, built once on first use. */
export interface App {
  settings: Settings;
  hermes: Hermes;
  /** The SQLite database: modules that keep their own data add their tables to BOOTSTRAP and schema.ts. */
  db: Db;
  keys: ApiKeys;
  /** Built-in module: server health, the daily audit and fix tasks (src/server/infra). */
  infra: Infra;
  /** Built-in module: the Chat page, talking to Hermes's API Server (src/server/chat). */
  chat: Chat;
}

let app: App | null = null;

export function getApp(): App {
  if (app) return app;
  const settings = loadSettings();
  const db = openDb(settings.dataDir);
  const hermes = new Hermes(settings.hermesApi, settings.hermesToken);
  app = {
    settings,
    hermes,
    db,
    keys: new ApiKeys(db, readPepper(settings.dataDir)),
    infra: new Infra(db, hermes, settings),
    chat: new Chat(new HermesApiServer(settings.hermesApiServer, settings.hermesApiServerKey), new ChatStore(db)),
  };
  if (settings.infraChecks) app.infra.start();
  // Follows the runs still going after a restart, and writes the smart titles.
  if (!process.env.VITEST) app.chat.startWatcher();
  return app;
}
