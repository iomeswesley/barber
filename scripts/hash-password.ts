// Gera o hash (formato "salt:hash", mesmo usado pelos usuários normais) de
// uma senha em texto plano — usado pra preencher ADMIN_PASSWORD_HASH no
// .env / Vercel sem deixar a senha em texto puro salva em lugar nenhum.
//
// Uso: npx tsx scripts/hash-password.ts "senha-nova"
import { hashPassword } from "../src/lib/auth.js";

const password = process.argv[2];
if (!password) {
  console.error("Uso: npx tsx scripts/hash-password.ts <senha>");
  process.exit(1);
}

console.log(hashPassword(password));
