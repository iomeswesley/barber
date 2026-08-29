-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('dinheiro', 'pix', 'cartao', 'outro');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('open', 'paid');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('entrada', 'saida', 'ajuste');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('aguardando', 'notificado', 'atendido', 'expirado');

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "coupon_id" INTEGER,
ADD COLUMN     "payment_method" "PaymentMethod";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "supplier_id" INTEGER;

-- CreateTable
CREATE TABLE "expenses" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'open',
    "paid_at" TIMESTAMP(3),
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" "CouponDiscountType" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "valid_from" DATE,
    "valid_to" DATE,
    "usage_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "professional_id" INTEGER,
    "service_id" INTEGER,
    "desired_date_start" DATE NOT NULL,
    "desired_date_end" DATE NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'aguardando',
    "notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "document" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_business_id_idx" ON "expenses"("business_id");

-- CreateIndex
CREATE INDEX "coupons_business_id_idx" ON "coupons"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_business_id_code_key" ON "coupons"("business_id", "code");

-- CreateIndex
CREATE INDEX "waitlist_entries_business_id_idx" ON "waitlist_entries"("business_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_status_idx" ON "waitlist_entries"("status");

-- CreateIndex
CREATE INDEX "suppliers_business_id_idx" ON "suppliers"("business_id");

-- CreateIndex
CREATE INDEX "stock_movements_business_id_idx" ON "stock_movements"("business_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
