import { stripe, stripeConfigured } from "@/lib/stripe.js";
import { AppError } from "@/middleware/errorHandler.js";

// Stripe Connect (contas Standard) — recebimento das assinaturas que cada
// barbearia vende pros próprios clientes finais. Diferente do billing da
// plataforma (src/lib/stripe.ts): aqui o dinheiro vai direto pra conta
// conectada da barbearia, o Stripe cuida de KYC/compliance, e a plataforma
// só participa via application_fee (comissão, hoje em 0%).
export { stripeConfigured };

function requireStripe() {
  if (!stripe) throw new AppError("Cobrança não configurada no servidor.", 503);
  return stripe;
}

export async function createConnectAccount(barbershopId: number): Promise<string> {
  const account = await requireStripe().accounts.create({
    type: "standard",
    metadata: { barbershopId: String(barbershopId) },
  });
  return account.id;
}

export async function createAccountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<string> {
  const link = await requireStripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });
  return link.url;
}

export async function getAccountStatus(
  accountId: string
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean }> {
  const account = await requireStripe().accounts.retrieve(accountId);
  return { chargesEnabled: !!account.charges_enabled, payoutsEnabled: !!account.payouts_enabled };
}

// Produto/preço criados na conta conectada da barbearia (via stripeAccount
// como request option), não na conta da plataforma — preços do Stripe são
// imutáveis, então editar o valor de um plano existente cria um preço novo.
export async function createConnectedProductAndPrice(
  accountId: string,
  name: string,
  priceCents: number
): Promise<{ productId: string; priceId: string }> {
  const client = requireStripe();
  const product = await client.products.create({ name }, { stripeAccount: accountId });
  const price = await client.prices.create(
    { product: product.id, unit_amount: priceCents, currency: "brl", recurring: { interval: "month" } },
    { stripeAccount: accountId }
  );
  return { productId: product.id, priceId: price.id };
}
