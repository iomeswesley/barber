-- AlterTable
ALTER TABLE "users" ADD COLUMN "email" TEXT;
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "email_verification_token" TEXT;
ALTER TABLE "users" ADD COLUMN "email_verification_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_verification_token_key" ON "users"("email_verification_token");
