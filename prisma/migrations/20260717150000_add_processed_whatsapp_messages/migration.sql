-- CreateTable
CREATE TABLE "processed_whatsapp_messages" (
    "id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_whatsapp_messages_pkey" PRIMARY KEY ("id")
);
