-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "confirmation_token" TEXT,
ADD COLUMN     "google_event_id" TEXT,
ALTER COLUMN "status" SET DEFAULT 'scheduled';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "ai_personality" TEXT NOT NULL DEFAULT 'acolhedor',
ADD COLUMN     "ical_import_url" TEXT,
ADD COLUMN     "master_prompt" TEXT;

-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "ai_paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needs_attention" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN     "google_calendar_connected_at" TIMESTAMP(3),
ADD COLUMN     "google_calendar_id" TEXT,
ADD COLUMN     "google_calendar_refresh_token_enc" TEXT,
ADD COLUMN     "google_calendar_token_enc" TEXT;

-- AlterTable
ALTER TABLE "time_blocks" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "campaigns" (
    "id" SERIAL NOT NULL,
    "business_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "message_template" TEXT NOT NULL,
    "inactive_days_threshold" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_sends" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "business_id" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_business_id_idx" ON "campaigns"("business_id");

-- CreateIndex
CREATE INDEX "campaign_sends_business_id_client_id_sent_at_idx" ON "campaign_sends"("business_id", "client_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_confirmation_token_key" ON "appointments"("confirmation_token");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
