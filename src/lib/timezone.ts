// Garante que Date/horários "locais" usem o fuso do deploy (Brasil por padrão,
// ou o da região configurada em APP_TIMEZONE, ex: Europe/Luxembourg),
// independente do fuso do ambiente onde o processo roda — o Vercel, por
// exemplo, roda os containers da função em UTC por padrão, e "TZ" é um nome
// de variável de ambiente reservado lá (não dá pra configurar por env var;
// por isso o nome próprio APP_TIMEZONE).
//
// Precisa ser o PRIMEIRO import de qualquer entrypoint (api/index.js,
// server.ts), antes de qualquer outro módulo que possa fazer contas de
// data/hora — import declarations são resolvidas em ordem, então só isso
// garante que process.env.TZ já está setado antes do resto do código rodar.
// Lê process.env direto (não src/config/env.ts) porque env.ts não pode ser
// importado antes disto; o zod de env.ts valida o mesmo valor logo depois.
process.env.TZ = process.env.APP_TIMEZONE || "America/Sao_Paulo";

export {};
