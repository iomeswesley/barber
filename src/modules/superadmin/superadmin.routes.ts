import { Router } from "express";
import { prisma } from "@/lib/prisma.js";
import { hashPassword, generateRandomPassword } from "@/lib/auth.js";
import { sendAdminGeneratedPasswordEmail } from "@/lib/email.js";
import { requireSuperAdmin } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { getBarbershops, getBarbershop } from "@/modules/barbershops/barbershops.repository.js";
import { getBarbers, getBarber, updateBarber, setBarberActive } from "@/modules/barbers/barbers.repository.js";
import { getServices, getService, updateService, setServiceActive } from "@/modules/services/services.repository.js";
import { getProducts, getProduct, updateProduct, setProductActive } from "@/modules/products/products.repository.js";

export const superAdminRouter = Router();

// O login em si acontece em POST /api/auth/login (mesma rota/tela de
// dono/barbeiro) — ver auth.routes.ts. Aqui só ficam as rotas que já
// exigem sessão de super-admin.

superAdminRouter.post("/api/superadmin/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

superAdminRouter.get("/api/superadmin/me", requireSuperAdmin, (_req, res) => {
  res.json({ ok: true });
});

// Lista todos os usuários de todas as barbearias (donos e barbeiros) — visão
// só de leitura, sem nenhum dado de agenda/cliente/faturamento.
superAdminRouter.get("/api/superadmin/users", requireSuperAdmin, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      include: { barbershop: { select: { name: true } } },
      orderBy: [{ barbershop: { name: "asc" } }, { role: "asc" }],
    });
    res.json(
      users.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        role: u.role,
        barbershopName: u.barbershop.name,
        emailVerified: !!u.emailVerifiedAt,
        createdAt: u.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Gera uma senha aleatória, salva o hash e manda a senha em texto plano só
// pro e-mail já cadastrado do usuário — a senha nunca volta pra resposta da
// API nem fica visível no próprio painel de admin.
superAdminRouter.post("/api/superadmin/users/:id/reset-password", requireSuperAdmin, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
    if (!user) throw new AppError("Usuário não encontrado", 404);
    if (!user.email) throw new AppError("Esse usuário não tem e-mail cadastrado para receber a nova senha");

    const newPassword = generateRandomPassword();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } });
    await sendAdminGeneratedPasswordEmail(user.email, user.name, user.username, newPassword);

    res.json({ ok: true, sentTo: user.email });
  } catch (err) {
    next(err);
  }
});

/* ---------------- Configuração de uma barbearia (visão/edição de admin) ---------------- */
// Diferente das rotas equivalentes do painel do dono (barbers.routes.ts,
// services.routes.ts, products.routes.ts), aqui não há requireOwner nem
// belongsToSession — o admin da plataforma pode ver e editar qualquer
// barbearia, pra atualização forçada quando o próprio dono não consegue.

superAdminRouter.get("/api/superadmin/barbershops", requireSuperAdmin, async (_req, res, next) => {
  try {
    const shops = await getBarbershops();
    res.json(shops.map((s) => ({ id: s.id, name: s.name })));
  } catch (err) {
    next(err);
  }
});

superAdminRouter.get("/api/superadmin/barbershops/:id", requireSuperAdmin, async (req, res, next) => {
  try {
    const barbershopId = Number(req.params.id);
    const shop = await getBarbershop(barbershopId);
    if (!shop) throw new AppError("Barbearia não encontrada", 404);

    const [barbers, services, products] = await Promise.all([
      getBarbers(barbershopId, { includeInactive: true }),
      getServices(barbershopId, { includeInactive: true }),
      getProducts(barbershopId, { includeInactive: true }),
    ]);

    res.json({
      barbershop: { id: shop.id, name: shop.name, address: shop.address, phone: shop.phone },
      barbers,
      services,
      products,
    });
  } catch (err) {
    next(err);
  }
});

// Confere que o recurso realmente pertence à barbearia da URL antes de deixar
// editar — evita que um bug de UI (ou uma chamada manual à API) altere o
// recurso errado ao trocar só o id na URL.
function assertBelongsToShop(resource: { barbershopId: number } | null, barbershopId: number, label: string) {
  if (!resource || resource.barbershopId !== barbershopId) {
    throw new AppError(`${label} não encontrado nessa barbearia`, 404);
  }
}

superAdminRouter.put("/api/superadmin/barbershops/:id/barbers/:barberId", requireSuperAdmin, async (req, res, next) => {
  try {
    const barbershopId = Number(req.params.id);
    const barberId = Number(req.params.barberId);
    const barber = await getBarber(barberId);
    assertBelongsToShop(barber, barbershopId, "Barbeiro");

    const { name, commissionPercent, monthlyGoalCents, active } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError("Nome é obrigatório");

    await updateBarber(barberId, String(name).trim(), {
      commissionPercent: commissionPercent !== undefined ? Number(commissionPercent) : undefined,
      monthlyGoalCents: monthlyGoalCents !== undefined ? Number(monthlyGoalCents) : undefined,
    });
    if (active !== undefined) await setBarberActive(barberId, !!active);

    res.json(await getBarber(barberId));
  } catch (err) {
    next(err);
  }
});

superAdminRouter.put("/api/superadmin/barbershops/:id/services/:serviceId", requireSuperAdmin, async (req, res, next) => {
  try {
    const barbershopId = Number(req.params.id);
    const serviceId = Number(req.params.serviceId);
    const service = await getService(serviceId);
    assertBelongsToShop(service, barbershopId, "Serviço");

    const { name, priceCents, durationMin, active } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError("Nome é obrigatório");
    if (!(Number(priceCents) > 0)) throw new AppError("Preço inválido");
    if (!(Number(durationMin) > 0)) throw new AppError("Duração inválida");

    await updateService(serviceId, { name: String(name).trim(), priceCents: Number(priceCents), durationMin: Number(durationMin) });
    if (active !== undefined) await setServiceActive(serviceId, !!active);

    res.json(await getService(serviceId));
  } catch (err) {
    next(err);
  }
});

superAdminRouter.put("/api/superadmin/barbershops/:id/products/:productId", requireSuperAdmin, async (req, res, next) => {
  try {
    const barbershopId = Number(req.params.id);
    const productId = Number(req.params.productId);
    const product = await getProduct(productId);
    assertBelongsToShop(product, barbershopId, "Produto");

    const { name, priceCents, stockQuantity, lowStockThreshold, active } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError("Nome é obrigatório");
    if (!(Number(priceCents) > 0)) throw new AppError("Preço inválido");

    await updateProduct(productId, {
      name: String(name).trim(),
      priceCents: Number(priceCents),
      stockQuantity: stockQuantity !== undefined ? Number(stockQuantity) : undefined,
      lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : undefined,
    });
    if (active !== undefined) await setProductActive(productId, !!active);

    res.json(await getProduct(productId));
  } catch (err) {
    next(err);
  }
});
