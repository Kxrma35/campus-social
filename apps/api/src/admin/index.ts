import pg from "pg";
import { LocalPhotoStore } from "../content/photos.js";
import { loadConfig } from "../config.js";
import { BlindIndexer } from "../identity/linkCrypto.js";
import { buildAdminApp } from "./app.js";
import { PgAdminStore } from "./pgStore.js";
import { AdminService, DEFAULT_ADMIN_OPTIONS } from "./service.js";

const config = loadConfig();
if (!config.ADMIN_DATABASE_URL) {
  console.error("ADMIN_DATABASE_URL (the moderator database role) is required.");
  process.exit(1);
}

const blind = config.LINK_BLIND_INDEX_KEY ? new BlindIndexer(config.LINK_BLIND_INDEX_KEY) : undefined;
const pool = new pg.Pool({ connectionString: config.ADMIN_DATABASE_URL, max: 5 });
const app = buildAdminApp({
  admin: new AdminService(new PgAdminStore(pool), {
    ...DEFAULT_ADMIN_OPTIONS,
    blindIndexFor: blind ? (id) => blind.indexFor(id) : undefined,
  }),
  photos: new LocalPhotoStore(config.PHOTO_DIR),
});

app.listen({ port: config.ADMIN_PORT, host: "127.0.0.1" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
