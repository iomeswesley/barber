import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiFinancialAccount } from "@/lib/apiMappers.js";
import { getFinancialAccounts, getFinancialAccount, createFinancialAccount, setFinancialAccountActive } from "./financialAccounts.repository.js";

export const financialAccountsRouter = Router();

financialAccountsRouter.get("/api/manage/financial-accounts", requireAuth, requireOwner, async (req, res) => {
  const accounts = await getFinancialAccounts(req.session.user!.businessId, { includeInactive: true });
  res.json(accounts.map(toApiFinancialAccount));
});

financialAccountsRouter.post("/api/manage/financial-accounts", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const { name, type } = req.body || {};
    if (!name || !String(name).trim()) throw new AppError("name é obrigatório");
    if (!["caixa", "banco"].includes(type)) throw new AppError("type deve ser caixa ou banco");
    const businessId = req.session.user!.businessId;
    const account = await createFinancialAccount(businessId, { name: String(name).trim(), type });
    await logAudit(businessId, req.session.user!.name, "Criou conta financeira", `${account.name} (${account.type})`);
    res.status(201).json(toApiFinancialAccount(account));
  } catch (err) {
    next(err);
  }
});

financialAccountsRouter.post("/api/manage/financial-accounts/:id/active", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const account = await getFinancialAccount(Number(req.params.id));
    if (!belongsToSession(req, account)) throw new AppError("Conta não encontrada", 404);
    const updated = await setFinancialAccountActive(account!.id, !!req.body?.active);
    res.json(toApiFinancialAccount(updated));
  } catch (err) {
    next(err);
  }
});
