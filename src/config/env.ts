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
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_S3_REGION: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Configuração de ambiente inválida:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
