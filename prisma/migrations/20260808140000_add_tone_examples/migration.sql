-- AlterTable
ALTER TABLE "barbershops" ADD COLUMN "tone_examples" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
