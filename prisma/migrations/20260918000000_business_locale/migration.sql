-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'pt-BR',
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'BR',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'BRL';
