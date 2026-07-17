-- AlterTable
ALTER TABLE "barbershops" ADD COLUMN "whatsapp_phone_number_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "barbershops_whatsapp_phone_number_id_key" ON "barbershops"("whatsapp_phone_number_id");
