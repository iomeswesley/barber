import "@/lib/timezone.js";
import { env } from "@/config/env.js";
import { createApp } from "./app.js";
import { startReminderScheduler } from "@/jobs/reminders.js";
import { startBackupScheduler } from "@/jobs/backup.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`Barbearia SaaS rodando em http://localhost:${env.PORT}`);
  startReminderScheduler();
  startBackupScheduler();
});
