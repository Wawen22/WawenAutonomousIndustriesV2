-- ============================================================
-- WAI – Add Missing Models to Model Registry
-- Adds free OpenRouter models and other fallbacks
-- ============================================================

INSERT INTO models (id, provider, display_name, cost_per_1k_input_tokens, cost_per_1k_output_tokens, context_window, is_active, notes)
VALUES
  ('glm-4.5-air', 'openrouter', 'GLM 4.5 Air (Free)', 0.000000, 0.000000, 128000, true,
   'Free via OpenRouter — content, social, marketing, ops, HR'),
  ('nemotron-120b', 'openrouter', 'Nemotron 3 Super 120B (Free)', 0.000000, 0.000000, 128000, true,
   'Free via OpenRouter — CEO, PM, finance, complex tasks, temporary coding default'),
  ('step-flash', 'openrouter', 'Step 3.5 Flash (Free)', 0.000000, 0.000000, 32000, true,
   'Free via OpenRouter — ultra-fast routing and simple tasks'),
  ('qwen3-coder', 'openrouter', 'Qwen3 Coder (Free)', 0.000000, 0.000000, 128000, true,
   'Free via OpenRouter — keep only for manual tests')
ON CONFLICT (id) DO UPDATE SET
  cost_per_1k_input_tokens  = EXCLUDED.cost_per_1k_input_tokens,
  cost_per_1k_output_tokens = EXCLUDED.cost_per_1k_output_tokens,
  is_active                 = EXCLUDED.is_active,
  notes                     = EXCLUDED.notes;
