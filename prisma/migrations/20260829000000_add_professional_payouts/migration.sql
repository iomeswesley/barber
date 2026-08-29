-- CreateEnum
CREATE TYPE "ProfessionalPayoutStatus" AS ENUM ('open', 'paid');

-- CreateTable
CREATE TABLE "professional_payouts" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "professional_id" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "service_commission_cents" INTEGER NOT NULL,
    "product_commission_cents" INTEGER NOT NULL,
    "adjustment_cents" INTEGER NOT NULL DEFAULT 0,
    "adjustment_reason" TEXT,
    "status" "ProfessionalPayoutStatus" NOT NULL DEFAULT 'open',
    "paid_at" TIMESTAMP(3),
    "note" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "professional_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "professional_payouts_business_id_idx" ON "professional_payouts"("business_id");

-- CreateIndex
CREATE INDEX "professional_payouts_professional_id_idx" ON "professional_payouts"("professional_id");

-- AddForeignKey
ALTER TABLE "professional_payouts" ADD CONSTRAINT "professional_payouts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_payouts" ADD CONSTRAINT "professional_payouts_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
