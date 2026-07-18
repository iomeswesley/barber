// Cria (ou reaproveita, se já existirem) os Products/Prices dos planos
// Starter e Pro no Stripe, e imprime os Price IDs pra colar em
// STRIPE_PRICE_STARTER / STRIPE_PRICE_PRO no .env / Vercel.
//
// Uso: npx tsx --env-file=.env scripts/setup-stripe-products.ts
// (precisa de STRIPE_SECRET_KEY já configurado no .env)
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error("STRIPE_SECRET_KEY não configurado no ambiente.");
  process.exit(1);
}

const stripe = new Stripe(secretKey);

const PLANS = [
  { key: "starter", name: "Starter", unitAmount: 9900, description: "Até 2 barbeiros" },
  { key: "pro", name: "Pro", unitAmount: 14900, description: "Barbeiros ilimitados" },
] as const;

async function findExistingPrice(lookupKey: string): Promise<string | null> {
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  return prices.data[0]?.id ?? null;
}

async function main() {
  const results: Record<string, string> = {};

  for (const plan of PLANS) {
    const lookupKey = `barbearia_saas_${plan.key}_monthly`;
    const existing = await findExistingPrice(lookupKey);
    if (existing) {
      console.log(`[${plan.key}] já existe — reaproveitando price ${existing}`);
      results[plan.key] = existing;
      continue;
    }

    const product = await stripe.products.create({
      name: `Painel da Barbearia — ${plan.name}`,
      description: plan.description,
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "brl",
      unit_amount: plan.unitAmount,
      recurring: { interval: "month" },
      lookup_key: lookupKey,
    });
    console.log(`[${plan.key}] criado — product ${product.id}, price ${price.id}`);
    results[plan.key] = price.id;
  }

  console.log("\nAdicione ao .env / variáveis de ambiente do Vercel:");
  console.log(`STRIPE_PRICE_STARTER=${results.starter}`);
  console.log(`STRIPE_PRICE_PRO=${results.pro}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
