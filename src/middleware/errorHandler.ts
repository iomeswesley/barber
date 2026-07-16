import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Handler central de erros — as rotas lançam AppError (ou Error comum) e deixam
// o Express cair aqui, em vez de cada handler repetir seu próprio try/catch com
// status hardcoded. Erros não esperados viram 500 sem vazar detalhes internos.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor" });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Rota não encontrada" });
}
