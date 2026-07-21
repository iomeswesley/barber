-- CreateEnum
CREATE TYPE "ClientPlanSubscriptionStatus" AS ENUM ('active', 'past_due', 'canceled');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN "price_charged_cents" INTEGER,
ADD COLUMN "client_plan_subscription_id" INTEGER,
ADD COLUMN "plan_credit_consumed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "client_plan_subscriptions" (
    "id" SERIAL NOT NULL,
    "barbershop_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "client_plan_id" INTEGER NOT NULL,
    "status" "ClientPlanSubscriptionStatus" NOT NULL DEFAULT 'active',
    "stripe_subscription_id" TEXT,
    "stripe_customer_id" TEXT,
    "current_period_end" TIMESTAMP(3),
    "used_this_period" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_plan_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_verifications" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_plan_subscriptions_stripe_subscription_id_key" ON "client_plan_subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "client_plan_subscriptions_barbershop_id_idx" ON "client_plan_subscriptions"("barbershop_id");

-- CreateIndex
CREATE INDEX "client_plan_subscriptions_client_id_idx" ON "client_plan_subscriptions"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_plan_subscriptions_client_id_client_plan_id_key" ON "client_plan_subscriptions"("client_id", "client_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "phone_verifications_phone_key" ON "phone_verifications"("phone");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_plan_subscription_id_fkey" FOREIGN KEY ("client_plan_subscription_id") REFERENCES "client_plan_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_plan_subscriptions" ADD CONSTRAINT "client_plan_subscriptions_barbershop_id_fkey" FOREIGN KEY ("barbershop_id") REFERENCES "barbershops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_plan_subscriptions" ADD CONSTRAINT "client_plan_subscriptions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_plan_subscriptions" ADD CONSTRAINT "client_plan_subscriptions_client_plan_id_fkey" FOREIGN KEY ("client_plan_id") REFERENCES "client_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
