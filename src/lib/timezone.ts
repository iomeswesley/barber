// Garante que Date/horários "locais" usem o fuso da barbearia (Brasil),
// independente do fuso do ambiente onde o processo roda — o Vercel, por
// exemplo, roda os containers da função em UTC por padrão, e "TZ" é um nome
// de variável de ambiente reservado lá (não dá pra configurar por env var).
//
// Precisa ser o PRIMEIRO import de qualquer entrypoint (api/index.js,
// server.ts), antes de qualquer outro módulo que possa fazer contas de
// data/hora — import declarations são resolvidas em ordem, então só isso
// garante que process.env.TZ já está setado antes do resto do código rodar.
process.env.TZ = "America/Sao_Paulo";

export {};
