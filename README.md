Leggi docs/PROJECT_TRACKING.md e docs/AGENTS_AND_TEAMS.md prima di fare qualsiasi cosa.

Procedi con T121 — Agent Roster Expansion: aggiungi 8 nuovi agenti specializzati a WAI.

Il reference è nella cartella `IDEE-E-INTEGRAZIONI-DI-RIFERIMENTO-PER-WAI/agency-agents-main/` — contiene 160+ prompt agenti organizzati per funzione. Usali come ISPIRAZIONE e adattali al contesto WAI, non fare copia-incolla.

## Agenti da aggiungere

Aggiungi questi 8 agenti in ordine di priorità:

1. **security_auditor** (team: ops) — Analisi sicurezza codice, infra, dipendenze. Cerca vulnerabilità, OWASP top 10, secrets esposti.

2. **db_optimizer** (team: dev) — Review schema DB, query performance, indici mancanti, N+1 queries. Opera su progetti software con DB.

3. **api_tester** (team: dev) — Test automatico endpoint API: autenticazione, edge case, contract testing, response validation.

4. **legal_compliance** (team: ops) — Review contratti, GDPR compliance, privacy policy, termini di servizio. Solo analisi e raccomandazioni — non da consigli legali vincolanti.

5. **proposal_strategist** (team: consulting) — Costruisce proposte commerciali complete: executive summary, scope, pricing, timeline, ROI. Si basa su brief progetto.

6. **executive_summary** (team: ops) — Trasforma documenti lunghi, riunioni, output agenti in executive summary concisi e actionable per Neb/clienti.

7. **feedback_synthesizer** (team: consulting) — Analizza feedback raccolto (cliente, utenti, stakeholder), identifica pattern, priority score, action items.

8. **behavioral_coach** (team: ops) — Personal mode only. Tracker abitudini, accountability check-in, nudge produttività per Neb via Telegram.

## Cosa implementare per ogni agente

Per ogni agente, seguendo i pattern esistenti nel codebase:

1. **`backend/src/agents/<nome>.ts`** — file agente con:
   - System prompt specifico (personalità, expertise, output format)
   - Funzione `run<Nome>Agent(task, notify)` con firma standard
   - Output strutturato (JSON parsato + fallback)
   - Log eventi con `recordEvent`

2. **`backend/src/config/agents.ts`** — registra il nuovo agente nel registry

3. **`backend/src/agents/ceo.ts`** — aggiungi il nuovo agente all'AGENT_ROSTER e alla logica di routing del CEO (quali task delega al nuovo agente)

4. **`backend/src/services/founder_task_actions.ts`** — aggiungi il case nella funzione di dispatch per i nuovi agenti

## Vincoli

- Segui esattamente i pattern degli agenti esistenti (architect.ts, consulting_lead.ts, qa.ts)
- Ogni agente usa `runAgent` da `services/llm.ts` con `projectId`/`clientId` se disponibili dal task
- System prompt: italiano o inglese a seconda del contesto, massimo pragmatico
- Output sempre in JSON parsabile con fallback su errore di parsing
- `captureMemory: false` per agenti di analisi (security, legal, db) — non salvano output grezzo
- Nessun hardcode di model ID — usa il routing standard
- `pnpm typecheck` deve passare alla fine

## Ordine di esecuzione suggerito

Implementa in questo ordine (dal più semplice al più complesso):
1. executive_summary, feedback_synthesizer (output semplice, nessuna dipendenza)
2. security_auditor, api_tester, db_optimizer (analisi tecnica)
3. legal_compliance (analisi con disclaimer)
4. proposal_strategist (output strutturato complesso)
5. behavioral_coach (personal mode, logica Telegram)

Alla fine: `pnpm typecheck` backend, aggiorna docs/PROJECT_TRACKING.md con T121 → ✅ Done.

ultrathink e procedi.
