-- AlterEnum
-- Precisa ficar numa migration separada da que usa o valor novo (a que faz
-- ALTER COLUMN status SET DEFAULT 'scheduled', na migration seguinte) --
-- Postgres não permite usar um valor de enum recém-adicionado antes da
-- transação que o criou ser commitada.
ALTER TYPE "AppointmentStatus" ADD VALUE 'scheduled';
