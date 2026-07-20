-- CreateEnum
CREATE TYPE "ClientPlanBenefitType" AS ENUM ('services_included', 'percent_discount', 'unlimited_service');

-- AlterTable
ALTER TABLE "barbershops" ADD COLUMN "stripe_connect_account_id" TEXT,
ADD COLUMN "stripe_connect_onboarded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "client_plans" (
    "id" SERIAL NOT NULL,
    "barbershop_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "benefit_type" "ClientPlanBenefitType" NOT NULL,
    "benefit_value" INTEGER NOT NULL,
    "service_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stripe_product_id" TEXT,
    "stripe_price_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "barbershops_stripe_connect_account_id_key" ON "barbershops"("stripe_connect_account_id");

-- CreateIndex
CREATE INDEX "client_plans_barbershop_id_idx" ON "client_plans"("barbershop_id");

-- AddForeignKey
ALTER TABLE "client_plans" ADD CONSTRAINT "client_plans_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_plans" ADD CONSTRAINT "client_plans_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
