import { z } from "zod";

// Falha rápido e alto na inicialização se uma variável de ambiente obrigatória
// estiver faltando, em vez de deixar o erro aparecer silenciosamente depois
// (ex: uma query rodando sem DATABASE_URL só na primeira requisição).
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),
  // Conexão direta (sem pooler em modo transaction) — exigida pelo Prisma
  // Migrate e pelo pg_dump do job de backup. Com Supabase, é a URL do
  // pooler em modo session (porta 5432), não a de modo transaction (6543).
  DIRECT_URL: z.string().min(1, "DIRECT_URL é obrigatório"),
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET é obrigatório"),
  // Usado para autenticar chamadas do Vercel Cron ao endpoint de lembretes
  // (o Vercel envia "Authorization: Bearer <CRON_SECRET>" automaticamente).
  CRON_SECRET: z.string().optional(),
  SEED_DEMO_DATA: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  ANTHROPIC_API_KEY: z.string().optional(),
  // URL pública de onde o app é servido (ex: https://barbearia-saas-jet.vercel.app),
  // sem barra no final. Usada só pra montar links absolutos em canais sem
  // contexto de navegador (WhatsApp, SMS) — no chat.html (simulador dentro
  // do navegador) um caminho relativo já funciona, então isso fica opcional;
  // sem ela, os links caem de volta pra caminho relativo (só funciona no
  // simulador, quebrado se mandado por WhatsApp de verdade).
  PUBLIC_BASE_URL: z.string().optional(),
  // WhatsApp Cloud API (Meta) — todos opcionais: sem eles, o envio real de
  // WhatsApp fica desligado (stub que só loga no console, igual antes).
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_S3_REGION: z.string().optional(),
  // Monitoramento de erro (Sentry) — opcional: sem DSN configurado, fica
  // completamente desligado (sem custo, sem dependência de rede em dev).
  SENTRY_DSN: z.string().optional(),
  // E-mail transacional (Resend) — opcional: sem API key, o cadastro
  // continua funcionando, só não manda o e-mail de confirmação (fica
  // registrado no console, igual ao stub do WhatsApp antes de configurado).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("onboarding@resend.dev"),
  // Cobrança (Stripe) — tudo opcional: sem as chaves, a aba de cobrança
  // fica desligada (mostra só o status do trial, sem botão de assinar).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  // Painel de administração da plataforma (super-admin, fora do escopo de
  // qualquer barbearia) — login fixo via variável de ambiente, não uma
  // conta na tabela users. Sem ADMIN_PASSWORD_HASH configurado, o login
  // fica desligado (rota responde 503). Gere o hash com
  // `npx tsx scripts/hash-password.ts <senha>`.
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  // Setado automaticamente pelo Vercel em toda função serverless — usado
  // pra desligar funcionalidades que exigem filesystem persistente/binários
  // do sistema (ex: backup local via pg_dump), indisponíveis nesse ambiente.
  VERCEL: z
    .string()
    .optional()
    .transform((v) => v === "1"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Configuração de ambiente inválida:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
