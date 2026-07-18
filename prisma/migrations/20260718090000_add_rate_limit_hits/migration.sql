-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limit_hits_key_created_at_idx" ON "rate_limit_hits"("key", "created_at");
