// Corpo bruto da requisição, capturado pelo "verify" do express.json() em
// app.ts — necessário pra validar a assinatura HMAC do webhook do WhatsApp.
declare module "express-serve-static-core" {
  interface Request {
    rawBody?: Buffer;
  }
}

export {};
