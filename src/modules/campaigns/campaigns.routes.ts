import { Router } from "express";
import { requireAuth, requireOwner } from "@/middleware/auth.js";
import { logAudit } from "@/modules/auditLog/auditLog.repository.js";
import { createAndDispatchCampaign, getCampaignsForBusiness } from "./campaigns.service.js";

export const campaignsRouter = Router();

// Sem gate de plano Pro de propósito por enquanto: campanha é uma feature
// nova, e o teste grátis já é "acesso completo ao painel" (ver CLAUDE.md) —
// bloquear isso especificamente exigiria uma decisão de produto que ainda
// não foi tomada. Reavaliar se fizer sentido restringir depois.

campaignsRouter.get("/api/manage/campaigns", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const campaigns = await getCampaignsForBusiness(req.session.user!.businessId);
    res.json(
      campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        message_template: c.messageTemplate,
        inactive_days_threshold: c.inactiveDaysThreshold,
        sent_count: c.sentCount,
        created_at: c.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post("/api/manage/campaigns", requireAuth, requireOwner, async (req, res, next) => {
  try {
    const businessId = req.session.user!.businessId;
    const { name, message, inactiveDays } = req.body || {};
    const result = await createAndDispatchCampaign(businessId, {
      name: String(name || "").trim(),
      messageTemplate: String(message || "").trim(),
      inactiveDaysThreshold: Number(inactiveDays),
    });
    await logAudit(
      businessId,
      req.session.user!.name,
      "Criou campanha de reativação",
      `"${name}" · ${result.sent}/${result.targeted} enviada(s)${result.skippedNoOptIn ? ` · ${result.skippedNoOptIn} sem consentimento` : ""}${result.skippedRecentlyCampaigned ? ` · ${result.skippedRecentlyCampaigned} já campanhados nos últimos 90 dias` : ""}`
    );
    res.status(201).json({
      campaign_id: result.campaignId,
      targeted: result.targeted,
      sent: result.sent,
      skipped_no_opt_in: result.skippedNoOptIn,
      skipped_recently_campaigned: result.skippedRecentlyCampaigned,
    });
  } catch (err) {
    next(err);
  }
});
