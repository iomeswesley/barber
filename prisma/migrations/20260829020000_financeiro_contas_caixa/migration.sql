-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('caixa', 'banco');

-- AlterTable
ALTER TABLE "product_sales" ADD COLUMN     "payment_method" "PaymentMethod";

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "financial_account_id" INTEGER NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "opening_balance_cents" INTEGER NOT NULL,
    "closing_balance_cents" INTEGER,
    "expected_closing_cents" INTEGER,
    "opened_by" TEXT NOT NULL,
    "closed_by" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_accounts_business_id_idx" ON "financial_accounts"("business_id");

-- CreateIndex
CREATE INDEX "cash_sessions_business_id_idx" ON "cash_sessions"("business_id");

-- CreateIndex
CREATE INDEX "cash_sessions_financial_account_id_idx" ON "cash_sessions"("financial_account_id");

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_financial_account_id_fkey" FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
