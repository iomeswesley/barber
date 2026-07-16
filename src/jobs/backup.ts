import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "@/config/env.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backupsDir = path.join(__dirname, "..", "..", "data", "backups");

// Criação do diretório é preguiçosa (não roda no carregamento do módulo):
// em ambiente serverless (Vercel) o filesystem do deployment é somente
// leitura fora de /tmp, e este módulo é importado por dashboard.routes.ts
// mesmo quando ninguém aciona backup — mkdirSync aqui no topo derrubaria
// a função inteira antes de processar qualquer rota.
function ensureBackupsDir() {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // a cada 24h
const RETENTION_COUNT = 14; // mantém as últimas 14 cópias

// Upload off-site é opcional — funciona com AWS S3 e qualquer provedor
// S3-compatível (Cloudflare R2, Backblaze B2, MinIO, Wasabi). Se o bucket não
// estiver configurado, isso é um no-op: o backup local continua funcionando
// normalmente, só sem uma cópia fora da máquina.
const S3_ENABLED = !!(env.BACKUP_S3_BUCKET && env.BACKUP_S3_ACCESS_KEY_ID && env.BACKUP_S3_SECRET_ACCESS_KEY);

let s3ClientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
async function getS3Client() {
  if (!s3ClientPromise) {
    s3ClientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: env.BACKUP_S3_REGION || "auto",
          endpoint: env.BACKUP_S3_ENDPOINT || undefined,
          forcePathStyle: !!env.BACKUP_S3_ENDPOINT, // exigido pela maioria dos provedores S3-compatíveis
          credentials: {
            accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!,
            secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!,
          },
        })
    );
  }
  return s3ClientPromise;
}

async function uploadToOffsite(filePath: string, filename: string) {
  if (!S3_ENABLED) return;
  try {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: env.BACKUP_S3_BUCKET,
        Key: `barbearia-backups/${filename}`,
        Body: fs.readFileSync(filePath),
      })
    );
    console.log(`[BACKUP] Cópia enviada para o bucket off-site: ${filename}`);
  } catch (err) {
    // A falha no upload remoto não deve derrubar o backup local, que já está seguro em disco.
    console.error("[BACKUP] Falha ao enviar cópia para o bucket off-site:", (err as Error).message);
  }
}

function timestampForFilename(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

// Usa pg_dump em formato custom (-Fc): produz um snapshot consistente e
// compactado, restaurável com pg_restore — exige o cliente `pg_dump` do Postgres
// instalado no host que roda o backend (mesma versão major do servidor, idealmente).
export async function runBackup(): Promise<BackupInfo> {
  ensureBackupsDir();
  const filename = `barbearia-${timestampForFilename()}.dump`;
  const filePath = path.join(backupsDir, filename);
  await execFileAsync("pg_dump", [env.DIRECT_URL, "-Fc", "-f", filePath]);
  pruneOldBackups();
  console.log(`[BACKUP] Cópia de segurança criada: ${filename}`);
  // Fire-and-forget: o backup local já está seguro em disco, então quem chamou
  // não precisa esperar (nem tratar falhas) da cópia off-site.
  uploadToOffsite(filePath, filename);
  return listBackups()[0]!;
}

function pruneOldBackups() {
  const files = listBackups();
  for (const file of files.slice(RETENTION_COUNT)) {
    fs.unlinkSync(path.join(backupsDir, file.name));
  }
}

export function listBackups(): BackupInfo[] {
  ensureBackupsDir();
  return fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith(".dump"))
    .map((name) => {
      const stat = fs.statSync(path.join(backupsDir, name));
      return { name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function startBackupScheduler() {
  runBackup().catch((err) => console.error("[BACKUP] Falha ao criar cópia de segurança inicial:", err.message));
  setInterval(() => {
    runBackup().catch((err) => console.error("[BACKUP] Falha ao criar cópia de segurança:", err.message));
  }, CHECK_INTERVAL_MS);
  console.log(`[BACKUP] Agendador de backup iniciado (a cada 24h, mantendo as últimas ${RETENTION_COUNT}).`);
  console.log(
    S3_ENABLED
      ? `[BACKUP] Cópia off-site ativada (bucket: ${env.BACKUP_S3_BUCKET}).`
      : "[BACKUP] Cópia off-site desativada — defina BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID e BACKUP_S3_SECRET_ACCESS_KEY no .env para ativar."
  );
}
