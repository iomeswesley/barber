-- Rename Barbershop -> Business e Barber -> Professional (motor único,
-- vocabulário genérico por vertical — ver src/config/verticals/). Escrita à
-- mão em vez de gerada por `prisma migrate diff` porque a geração automática
-- detecta isso como DROP TABLE + CREATE TABLE (perda de dados) em vez de
-- reconhecer que é o mesmo dado só com nome novo. Toda operação abaixo é
-- RENAME (tabela, coluna, constraint, índice) ou relabel de enum — nenhuma
-- delas apaga ou reescreve dado nenhum. Espelha a migration equivalente já
-- aplicada no repo irmão (odonto-saas):
-- prisma/migrations/20260808200000_rename_clinic_dentist_to_business_professional.

BEGIN;

-- 1. Tabelas
ALTER TABLE "barbershops" RENAME TO "businesses";
ALTER TABLE "barbers" RENAME TO "professionals";

ALTER TABLE "businesses" RENAME CONSTRAINT "barbershops_pkey" TO "businesses_pkey";
ALTER TABLE "professionals" RENAME CONSTRAINT "barbers_pkey" TO "professionals_pkey";

-- 2. Colunas barbershop_id -> business_id
ALTER TABLE "professionals" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "services" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "appointments" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "users" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "time_blocks" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "reviews" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "products" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "product_sales" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "audit_log" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "business_hours" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "escalations" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "push_subscriptions" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "chat_sessions" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "subscriptions" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "chat_usage_logs" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "client_plans" RENAME COLUMN "barbershop_id" TO "business_id";
ALTER TABLE "client_plan_subscriptions" RENAME COLUMN "barbershop_id" TO "business_id";

-- 3. Colunas barber_id -> professional_id
ALTER TABLE "appointments" RENAME COLUMN "barber_id" TO "professional_id";
ALTER TABLE "users" RENAME COLUMN "barber_id" TO "professional_id";
ALTER TABLE "time_blocks" RENAME COLUMN "barber_id" TO "professional_id";
ALTER TABLE "reviews" RENAME COLUMN "barber_id" TO "professional_id";

-- 4. Enum: valor 'barber' -> 'professional' (relabel de catálogo, preserva as
-- linhas existentes automaticamente — não reescreve dado).
ALTER TYPE "UserRole" RENAME VALUE 'barber' TO 'professional';

-- 5. Constraints de foreign key
ALTER TABLE "professionals" RENAME CONSTRAINT "barbers_barbershop_id_fkey" TO "professionals_business_id_fkey";
ALTER TABLE "services" RENAME CONSTRAINT "services_barbershop_id_fkey" TO "services_business_id_fkey";
ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_barbershop_id_fkey" TO "appointments_business_id_fkey";
ALTER TABLE "appointments" RENAME CONSTRAINT "appointments_barber_id_fkey" TO "appointments_professional_id_fkey";
ALTER TABLE "users" RENAME CONSTRAINT "users_barbershop_id_fkey" TO "users_business_id_fkey";
ALTER TABLE "users" RENAME CONSTRAINT "users_barber_id_fkey" TO "users_professional_id_fkey";
ALTER TABLE "time_blocks" RENAME CONSTRAINT "time_blocks_barbershop_id_fkey" TO "time_blocks_business_id_fkey";
ALTER TABLE "time_blocks" RENAME CONSTRAINT "time_blocks_barber_id_fkey" TO "time_blocks_professional_id_fkey";
ALTER TABLE "reviews" RENAME CONSTRAINT "reviews_barbershop_id_fkey" TO "reviews_business_id_fkey";
ALTER TABLE "reviews" RENAME CONSTRAINT "reviews_barber_id_fkey" TO "reviews_professional_id_fkey";
ALTER TABLE "products" RENAME CONSTRAINT "products_barbershop_id_fkey" TO "products_business_id_fkey";
ALTER TABLE "product_sales" RENAME CONSTRAINT "product_sales_barbershop_id_fkey" TO "product_sales_business_id_fkey";
ALTER TABLE "audit_log" RENAME CONSTRAINT "audit_log_barbershop_id_fkey" TO "audit_log_business_id_fkey";
ALTER TABLE "business_hours" RENAME CONSTRAINT "business_hours_barbershop_id_fkey" TO "business_hours_business_id_fkey";
ALTER TABLE "escalations" RENAME CONSTRAINT "escalations_barbershop_id_fkey" TO "escalations_business_id_fkey";
ALTER TABLE "push_subscriptions" RENAME CONSTRAINT "push_subscriptions_barbershop_id_fkey" TO "push_subscriptions_business_id_fkey";
ALTER TABLE "subscriptions" RENAME CONSTRAINT "subscriptions_barbershop_id_fkey" TO "subscriptions_business_id_fkey";
ALTER TABLE "client_plans" RENAME CONSTRAINT "client_plans_barbershop_id_fkey" TO "client_plans_business_id_fkey";
ALTER TABLE "client_plan_subscriptions" RENAME CONSTRAINT "client_plan_subscriptions_barbershop_id_fkey" TO "client_plan_subscriptions_business_id_fkey";

-- 6. Índices (rename, não recria)
ALTER INDEX "barbers_barbershop_id_idx" RENAME TO "professionals_business_id_idx";
ALTER INDEX "services_barbershop_id_idx" RENAME TO "services_business_id_idx";
ALTER INDEX "appointments_barbershop_id_idx" RENAME TO "appointments_business_id_idx";
ALTER INDEX "appointments_barber_id_date_idx" RENAME TO "appointments_professional_id_date_idx";
ALTER INDEX "users_barbershop_id_idx" RENAME TO "users_business_id_idx";
ALTER INDEX "time_blocks_barbershop_id_idx" RENAME TO "time_blocks_business_id_idx";
ALTER INDEX "reviews_barbershop_id_idx" RENAME TO "reviews_business_id_idx";
ALTER INDEX "products_barbershop_id_idx" RENAME TO "products_business_id_idx";
ALTER INDEX "product_sales_barbershop_id_idx" RENAME TO "product_sales_business_id_idx";
ALTER INDEX "audit_log_barbershop_id_idx" RENAME TO "audit_log_business_id_idx";
ALTER INDEX "business_hours_barbershop_id_weekday_key" RENAME TO "business_hours_business_id_weekday_key";
ALTER INDEX "escalations_barbershop_id_idx" RENAME TO "escalations_business_id_idx";
ALTER INDEX "push_subscriptions_barbershop_id_idx" RENAME TO "push_subscriptions_business_id_idx";
ALTER INDEX "subscriptions_barbershop_id_key" RENAME TO "subscriptions_business_id_key";
ALTER INDEX "chat_usage_logs_barbershop_id_created_at_idx" RENAME TO "chat_usage_logs_business_id_created_at_idx";
ALTER INDEX "client_plans_barbershop_id_idx" RENAME TO "client_plans_business_id_idx";
ALTER INDEX "client_plan_subscriptions_barbershop_id_idx" RENAME TO "client_plan_subscriptions_business_id_idx";

COMMIT;
