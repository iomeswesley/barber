import { Router } from "express";
import { requireAuth, requireOwner, belongsToSession } from "@/middleware/auth.js";
import { AppError } from "@/middleware/errorHandler.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { toApiExpense } from "@/lib/apiMappers.js";
import { getExpenses, getExpense, createExpense, updateExpense, markExpensePaid, deleteExpense } from "./expenses.repository.js";

export const expensesRouter = Router();

expensesRouter.get("/api/manage/expenses", requireAuth, requireOwner, async (req, res) => {
  const status = req.query.status === "open" || req.query.status === "paid" ? req.query.status : undefined;
  const expenses = await getExpenses(req.session.user!.businessId, { status });
  res.json(expenses.map(toApiExpense));
});

function validateBody(body: any) {
  const { description, amountCents, dueDate } = body || {};
  if (!description || !String(description).trim()) throw new AppError("description é obrigatório");
  if (!amountCents || Number(amountCents) <= 0) throw new AppError("amountCents deve ser maior que zero");
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate))) throw new AppError("dueDate é obrigatório (YYYY-MM-DD)");
}

expensesRouter.post("/api/manage/expenses", requireAuth, requireOwner, async (req, res, next) => {
  try {
    validateBody(req.body);
    const businessId = req.session.user!.businessId;
    const { description, amountCents, dueDate, category } = req.body;
    const expense = await createExpense(businessId, {
      description: String(description).trim(),
      amountCents: Number(amountCents),
      dueDate: String(dueDate),
      category: category ? String(category).trim() : null,
    });
    await logAudit(businessId, req.session.user!.name, "Criou despesa", `${expense.description} · R$ ${(expense.amountCents / 100).toFixed(2)}`);
    res.status(201).json(toApiExpense(expense));
  } catch (err) {
    next(err);
  }
});

expensesRouter.put("/api/manage/expenses/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const expense = await getExpense(Number(req.params.id));
    if (!belongsToSession(req, expense)) throw new AppError("Despesa não encontrada", 404);
    validateBody(req.body);
    const { description, amountCents, dueDate, category } = req.body;
    const updated = await updateExpense(expense!.id, {
      description: String(description).trim(),
      amountCents: Number(amountCents),
      dueDate: String(dueDate),
      category: category ? String(category).trim() : null,
    });
    await logAudit(req.session.user!.businessId, req.session.user!.name, "Editou despesa", updated.description);
    res.json(toApiExpense(updated));
  } catch (err) {
    next(err);
  }
});

expensesRouter.post("/api/manage/expenses/:id/pay", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const expense = await getExpense(Number(req.params.id));
    if (!belongsToSession(req, expense)) throw new AppError("Despesa não encontrada", 404);
    const paid = req.body?.paid !== false;
    const updated = await markExpensePaid(expense!.id, paid);
    await logAudit(req.session.user!.businessId, req.session.user!.name, paid ? "Marcou despesa como paga" : "Reabriu despesa", updated.description);
    res.json(toApiExpense(updated));
  } catch (err) {
    next(err);
  }
});

expensesRouter.delete("/api/manage/expenses/:id", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const expense = await getExpense(Number(req.params.id));
    if (!belongsToSession(req, expense)) throw new AppError("Despesa não encontrada", 404);
    await deleteExpense(expense!.id);
    await logAudit(req.session.user!.businessId, req.session.user!.name, "Excluiu despesa", expense!.description);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
