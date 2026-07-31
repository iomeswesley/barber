import zlib from "node:zlib";
import { promisify } from "node:util";
import { prisma } from "@/lib/prisma.js";
import { env } from "@/config/env.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Backup compatível com serverless (Vercel): pg_dump (usado em src/jobs/backup.ts)
// não funciona aqui — não tem o binário instalado nem filesystem gravável fora
// de /tmp (efêmero). Em vez de um dump binário, faz um dump lógico via SQL puro
// (SELECT * de cada tabela, serializado em JSON) e sobe direto pro bucket
// S3-compatível — sem passar por disco em momento nenhum.
export const serverlessBackupConfigured = !!(
  env.BACKUP_S3_BUCKET &&
  env.BACKUP_S3_ACCESS_KEY_ID &&
  env.BACKUP_S3_SECRET_ACCESS_KEY
);

const RETENTION_COUNT = 14;
const KEY_PREFIX = "barbearia-backups/";

let s3ClientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
async function getS3Client() {
  if (!s3ClientPromise) {
    s3ClientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          region: env.BACKUP_S3_REGION || "auto",
          endpoint: env.BACKUP_S3_ENDPOINT || undefined,
          forcePathStyle: !!env.BACKUP_S3_ENDPOINT,
          credentials: {
            accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!,
            secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!,
          },
        })
    );
  }
  return s3ClientPromise;
}

function timestampForFilename(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

// Lista as tabelas do schema public dinamicamente (em vez de manter uma lista
// manual aqui) — assim uma tabela nova criada por uma migration futura já
// entra no backup automaticamente, sem precisar lembrar de atualizar isto.
async function listTableNames(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
  );
  return rows.map((r) => r.table_name);
}

async function dumpAllTables(): Promise<Buffer> {
  const tables = await listTableNames();
  const dump: Record<string, unknown[]> = {};
  for (const table of tables) {
    // Nome de tabela não pode ser parametrizado num prepared statement —
    // vem só da própria introspecção do banco acima (nunca de input externo),
    // então interpolar aqui é seguro.
    dump[table] = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${table}"`);
  }
  const json = JSON.stringify({ generatedAt: new Date().toISOString(), tables: dump });
  return gzip(json);
}

export interface BackupInfo {
  key: string;
  sizeBytes: number;
  lastModified: string;
}

export async function runServerlessBackup(): Promise<BackupInfo> {
  if (!serverlessBackupConfigured) {
    throw new Error(
      "Backup off-site não configurado — defina BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID e BACKUP_S3_SECRET_ACCESS_KEY."
    );
  }
  const buffer = await dumpAllTables();
  const filename = `barbearia-${timestampForFilename()}.json.gz`;
  const key = `${KEY_PREFIX}${filename}`;

  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: env.BACKUP_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "application/gzip",
    })
  );
  console.log(`[BACKUP] Cópia serverless enviada: ${key} (${buffer.length} bytes)`);

  await pruneOldBackups();
  return { key, sizeBytes: buffer.length, lastModified: new Date().toISOString() };
}

export async function listServerlessBackups(): Promise<BackupInfo[]> {
  if (!serverlessBackupConfigured) return [];
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const client = await getS3Client();
  const res = await client.send(new ListObjectsV2Command({ Bucket: env.BACKUP_S3_BUCKET, Prefix: KEY_PREFIX }));
  return (res.Contents || [])
    .map((obj) => ({
      key: obj.Key!,
      sizeBytes: obj.Size || 0,
      lastModified: (obj.LastModified || new Date()).toISOString(),
    }))
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

// Mantém só as últimas RETENTION_COUNT cópias no bucket — sem isso o
// armazenamento cresce pra sempre (um backup novo por dia, todo dia).
async function pruneOldBackups() {
  const backups = await listServerlessBackups();
  const toDelete = backups.slice(RETENTION_COUNT);
  if (toDelete.length === 0) return;
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getS3Client();
  for (const backup of toDelete) {
    await client.send(new DeleteObjectCommand({ Bucket: env.BACKUP_S3_BUCKET, Key: backup.key }));
  }
  console.log(`[BACKUP] ${toDelete.length} cópia(s) antiga(s) removida(s) (retenção: ${RETENTION_COUNT}).`);
}

// Baixa e descompacta uma cópia específica — usado só num restore manual,
// nunca chamado automaticamente (restaurar é sempre uma decisão humana
// deliberada, nunca algo que o próprio sistema decide fazer sozinho).
export async function downloadServerlessBackup(key: string): Promise<Record<string, unknown[]>> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getS3Client();
  const res = await client.send(new GetObjectCommand({ Bucket: env.BACKUP_S3_BUCKET, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(chunk);
  const compressed = Buffer.concat(chunks);
  const json = (await gunzip(compressed)).toString("utf8");
  return JSON.parse(json).tables;
}
