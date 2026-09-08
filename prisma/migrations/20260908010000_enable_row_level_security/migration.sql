-- Achado pelo Security Advisor do Supabase (08/09): as 35 tabelas do schema
-- "public" estavam sem Row Level Security habilitado — qualquer um com a URL
-- do projeto e a chave "anon" (pública por design no Supabase) conseguia
-- ler/editar/apagar tudo via API REST automática do Supabase (PostgREST),
-- completamente à parte do Prisma/backend.
--
-- Confirmado antes de aplicar: a conexão da aplicação (role "postgres", via
-- DATABASE_URL/DIRECT_URL) tem o atributo BYPASSRLS — Prisma ignora RLS
-- sempre, então isso não muda NADA no funcionamento do app. Só fecha a
-- exposição via PostgREST: as roles "anon"/"authenticated" (as que a API
-- pública usa) não têm BYPASSRLS, então com RLS ligado e nenhuma policy
-- criada, elas passam a não enxergar nenhuma linha (nega tudo por padrão) —
-- exatamente o comportamento desejado, já que o produto nunca usa a API
-- REST do Supabase (sem @supabase/supabase-js, sem chave anon em lugar
-- nenhum do código/histórico do repo).
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_hours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_sends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_usage_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_plan_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coupons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "escalations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "phone_verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processed_whatsapp_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "professional_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "professionals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_limit_hits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
-- "session": criada em runtime pelo connect-pg-simple, fora do controle de
-- migrations do Prisma (mesma ressalva de sempre, ver CLAUDE.md) — mas
-- existe de verdade no schema "public" e guarda dado de sessão, então
-- precisa do mesmo tratamento.
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "short_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "time_blocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;
