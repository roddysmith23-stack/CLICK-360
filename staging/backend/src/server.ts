import { buildApp } from "./app.js";
import { createTokenVerifier } from "./auth.js";
import { loadConfig } from "./config.js";
import { createFirestoreRepository } from "./firestore-repository.js";

const config = loadConfig();
const app = buildApp({
  config,
  repository: createFirestoreRepository(config.projectId),
  tokenVerifier: createTokenVerifier(config.projectId)
});

try {
  await app.listen({ host: "0.0.0.0", port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
