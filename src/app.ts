import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import path from "node:path";
import { env, isProduction } from "@/config/env.js";
import { errorHandler, notFoundHandler } from "@/middleware/errorHandler.js";
import "@/middleware/session.js";
import "@/middleware/rawBody.js";
import { sendDailyReminders } from "@/jobs/reminders.js";
import { expireOverdueTrials } from "@/modules/billing/billing.service.js";

import { authRouter } from "@/modules/auth/auth.routes.js";
import { barbershopsRouter } from "@/modules/barbershops/barbershops.routes.js";
import { barbersRouter } from "@/modules/barbers/barbers.routes.js";
import { servicesRouter } from "@/modules/services/services.routes.js";
import { timeBlocksRouter } from "@/modules/timeBlocks/timeBlocks.routes.js";
import { appointmentsRouter } from "@/modules/appointments/appointments.routes.js";
import { productsRouter } from "@/modules/products/products.routes.js";
import { escalationsRouter } from "@/modules/escalations/escalations.routes.js";
import { auditLogRouter } from "@/modules/auditLog/auditLog.routes.js";
import { pushRouter } from "@/modules/push/push.routes.js";
import { dashboardRouter } from "@/modules/dashboard/dashboard.routes.js";
import { chatRouter } from "@/modules/chat/chat.routes.js";
import { whatsappRouter } from "@/modules/whatsapp/whatsapp.routes.js";
import { onboardingRouter } from "@/modules/onboarding/onboarding.routes.js";
import { clientsRouter } from "@/modules/clients/clients.routes.js";
import { billingRouter } from "@/modules/billing/billing.routes.js";

const PgSession = connectPgSimple(session);

export function createApp() {
  const app = express();

  // O Vercel termina TLS na borda; a função em si recebe HTTP puro. Sem
  // confiar no proxy, req.secure fica false e o cookie de sessão com
  // "secure: true" (isProduction) é descartado silenciosamente pelo
  // express-session — o login parecia funcionar (200 ok) mas nenhum
  // Set-Cookie chegava ao navegador.
  app.set("trust proxy", 1);

  // Headers de segurança (CSP, X-Frame-Options, Strict-Transport-Security
  // etc). CSP liberado com 'unsafe-inline' pra script/style porque todo o
  // frontend (webroot/*.html) é feito com <script>/<style> inline — travar
  // isso exigiria reescrever todas as páginas pra usar nonce, fora do
  // escopo desta rodada. Mesmo assim, a CSP ainda bloqueia carregar
  // recursos de qualquer origem não listada aqui (principal proteção
  // contra XSS que tenta puxar script/exfiltrar dado de outro domínio).
  // crossOriginEmbedderPolicy desligado: o padrão do helmet quebraria o
  // carregamento do Google Fonts e do Chart.js via CDN (exigem que a
  // origem externa mande um header CORP que elas não mandam).
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
    })
  );

  // Guarda o corpo bruto da requisição em req.rawBody: o webhook do
  // WhatsApp precisa dele (não do JSON já parseado) pra validar a
  // assinatura HMAC que a Meta envia no header X-Hub-Signature-256.
  app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request).rawBody = buf; } }));
  app.use(
    session({
      // Usa DATABASE_URL (pooler em modo transaction, porta 6543), não
      // DIRECT_URL: o "session pooler" do Supabase (DIRECT_URL) mantém uma
      // conexão real de Postgres por cliente e tem um teto baixo de conexões
      // simultâneas (ex: 15) — cada instância serverless do Vercel abre seu
      // próprio pool, e um único carregamento do painel já dispara ~9
      // chamadas de API em paralelo, esgotando esse limite rapidamente
      // (erro "EMAXCONNSESSION"). connect-pg-simple só faz queries
      // parametrizadas simples (sem locks, sem transação multi-statement),
      // então é seguro no modo transaction, que multiplexa muito mais
      // conexões lógicas sobre poucas conexões reais.
      store: new PgSession({
        conString: env.DATABASE_URL,
        tableName: "session",
        createTableIfMissing: true,
        pruneSessionInterval: false, // evita um timer de fundo (setInterval) que não faz sentido em serverless
        errorLog: (err) => console.error("[SESSION STORE ERROR]", err),
      }),
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60 * 8, // 8h
        secure: isProduction,
        sameSite: "lax",
      },
    })
  );

  /* ---------------- Rotas de página protegidas (antes do arquivo estático) ---------------- */

  app.get("/", (req, res, next) => {
    if (req.session?.user?.role === "owner") return res.redirect("/admin.html");
    if (req.session?.user?.role === "barber") return res.redirect("/barber.html");
    return next(); // visitante sem sessão: cai no index.html estático (landing page)
  });

  app.get("/admin.html", (req, res, next) => {
    if (req.session?.user?.role === "owner") return next();
    return res.redirect("/login.html");
  });

  app.get("/barber.html", (req, res, next) => {
    if (req.session?.user?.role === "barber") return next();
    return res.redirect("/login.html");
  });

  // Usa process.cwd() em vez de __dirname: __dirname fica em profundidades
  // diferentes conforme o modo (src/ no dev via tsx, dist/src/ compilado),
  // mas o processo sempre roda a partir da raiz do projeto em todos os
  // ambientes (dev, npm start, função serverless do Vercel).
  app.use(express.static(path.join(process.cwd(), "webroot")));

  // Acionado pelo Vercel Cron (ver vercel.json) em vez do setInterval de
  // startReminderScheduler(), que não sobrevive entre invocações serverless.
  // O Vercel envia "Authorization: Bearer <CRON_SECRET>" automaticamente
  // quando CRON_SECRET está configurado nas env vars do projeto.
  app.post("/api/cron/reminders", async (req, res) => {
    if (env.CRON_SECRET && req.headers.authorization !== `Bearer ${env.CRON_SECRET}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
    await sendDailyReminders();
    // Trials vencidos que nunca converteram em assinatura — mesmo cron
    // diário, sem endpoint separado.
    await expireOverdueTrials();
    res.json({ ok: true });
  });

  /* ---------------- Rotas da API ---------------- */

  app.use(authRouter);
  app.use(barbershopsRouter);
  app.use(barbersRouter);
  app.use(servicesRouter);
  app.use(timeBlocksRouter);
  app.use(appointmentsRouter);
  app.use(productsRouter);
  app.use(escalationsRouter);
  app.use(auditLogRouter);
  app.use(pushRouter);
  app.use(dashboardRouter);
  app.use(chatRouter);
  app.use(whatsappRouter);
  app.use(onboardingRouter);
  app.use(clientsRouter);
  app.use(billingRouter);

  app.use("/api", notFoundHandler);
  app.use(errorHandler);

  return app;
}
