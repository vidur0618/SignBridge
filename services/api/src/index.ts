import { buildApp, createDependencies } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const dependencies = await createDependencies(config);
const app = await buildApp(dependencies);

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ errorName: error instanceof Error ? error.name : "unknown" }, "server failed to start");
  process.exit(1);
}
