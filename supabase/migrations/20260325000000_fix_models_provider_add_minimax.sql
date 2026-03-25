-- ============================================================
-- WAI – Fix models table: provider constraint + minimax model
--
-- 1. Drop the inline CHECK on models.provider that only allowed
--    'azure', 'google', 'openai', 'local' — adds 'openrouter'
--    and 'anthropic' so all current and near-future providers
--    are accepted.
--
-- 2. Insert minimax/minimax-m2.7 via OpenRouter.
-- ============================================================

-- Fix provider constraint (PostgreSQL auto-names inline checks as <table>_<col>_check)
ALTER TABLE models
  DROP CONSTRAINT IF EXISTS models_provider_check;

ALTER TABLE models
  ADD CONSTRAINT models_provider_check
  CHECK (provider IN ('azure', 'google', 'openai', 'openrouter', 'anthropic', 'local'));

-- Backfill previously-blocked openrouter models (idempotent)
INSERT INTO models (id, provider, display_name, cost_per_1k_input_tokens, cost_per_1k_output_tokens, context_window, is_active, notes)
VALUES
  ('glm-4.5-air', 'openrouter', 'GLM 4.5 Air (Free)', 0.000000, 0.000000, 128000, true,
   'Free via OpenRouter — content, social, marketing, ops, HR'),
  ('nemotron-120b', 'openrouter', 'Nemotron 3 Super 120B (Free)', 0.000000, 0.000000, 128000, true,
   'Free via OpenRouter — CEO, PM, finance, complex tasks, temporary coding default'),
  ('step-flash', 'openrouter', 'Step 3.5 Flash (Free)', 0.000000, 0.000000, 32000, true,
   'Free via OpenRouter — ultra-fast routing and simple tasks'),
  ('qwen3-coder', 'openrouter', 'Qwen3 Coder (Free)', 0.000000, 0.000000, 128000, true,
   'Free via OpenRouter — keep only for manual tests'),
  ('minimax-m2.7', 'openrouter', 'MiniMax M2.7', 0.000800, 0.003200, 1000000, true,
   'Via OpenRouter (minimax/minimax-m2.7) — 1M context, strong coding; assigned to architect and all dev agents')
ON CONFLICT (id) DO UPDATE SET
  display_name              = EXCLUDED.display_name,
  cost_per_1k_input_tokens  = EXCLUDED.cost_per_1k_input_tokens,
  cost_per_1k_output_tokens = EXCLUDED.cost_per_1k_output_tokens,
  is_active                 = EXCLUDED.is_active,
  notes                     = EXCLUDED.notes;
