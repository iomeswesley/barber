-- AlterTable
ALTER TABLE "barbershops" ADD COLUMN "whatsapp_waba_id" TEXT,
ADD COLUMN "whatsapp_access_token_enc" TEXT,
ADD COLUMN "whatsapp_pin_enc" TEXT,
ADD COLUMN "whatsapp_display_phone" TEXT,
ADD COLUMN "whatsapp_connection_status" TEXT NOT NULL DEFAULT 'not_connected';

-- CreateIndex
CREATE UNIQUE INDEX "barbershops_whatsapp_waba_id_key" ON "barbershops"("whatsapp_waba_id");
