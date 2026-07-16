-- CreateTable
CREATE TABLE "chat_sessions" (
    "session_id" TEXT NOT NULL,
    "barbershop_id" INTEGER NOT NULL,
    "messages" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("session_id")
);
