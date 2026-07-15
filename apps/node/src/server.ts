import { createApplication } from "./app.js";

const application = await createApplication();
const { app, database, orders, federation, config } = application;

await orders.sweep();
await federation.syncAll();

const maintenanceTimer = setInterval(() => {
  void orders.sweep().catch((error: unknown) => app.log.error(error));
}, 5_000);
const federationTimer = setInterval(() => {
  void federation.syncAll().catch((error: unknown) => app.log.error(error));
}, 60_000);

const shutdown = async () => {
  clearInterval(maintenanceTimer);
  clearInterval(federationTimer);
  await app.close();
  database.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ host: config.host, port: config.port });
