# WAI Vision – Zero Human Company

## What is WAI?

**WAI (Wawen Autonomous Industries)** is an experiment in building a fully autonomous AI company. It operates using a coordinated fleet of 17 specialized AI agents, each responsible for a business domain, collectively delivering real work for real clients.

The goal: WAI generates revenue, manages projects, serves clients — with minimal human intervention. The Founder (Neb) sets direction, reviews critical outputs, and intervenes when strategic decisions require human judgment.

WAI is also evolving into a **dual runtime**:

- a **Company Runtime** for delivery, operations, and revenue
- a **Personal Runtime** for Neb as founder and operator

These two surfaces should not fork into separate products.
They should share one underlying capability platform for skills, memory, plugins, integrations, and channels.

---

## The Zero Human Company Model

A Zero Human Company doesn't mean humans are unwanted — it means the *default mode of operation is autonomous*. Humans are in the loop by choice, not by necessity.

### Core Principles

1. **Agents are employees, not tools.** Each agent has a persistent identity, role, memory, and accountability.
2. **Tasks flow top-down, results flow bottom-up.** The CEO Agent breaks down Neb's direction into delegated tasks; agents report back with outputs and blockers.
3. **Every action is logged.** All agent runs, model calls, and decisions are recorded in Supabase for transparency, debugging, and cost control.
4. **The Founder is always one command away.** Neb can pause, redirect, approve, reject, or override anything via Telegram or Dashboard.
5. **Cost and quality are first-class.** Agent routing considers model cost alongside capability. Budget alerts prevent runaway spend.

---

## Business Lines

WAI operates across multiple verticals simultaneously:

| Business Line | Delivery Chain | Status |
|--------------|----------------|--------|
| **Custom Software Dev** | Architect → Dev General → QA | ✅ Operational |
| **Consulting** | Consulting Lead → Analyst | ✅ Operational |
| **Marketing & Content** | Marketing Strategist → Content Creator + Social Manager | ✅ Operational |
| **SaaS Products** | PM SaaS → Dev Lead SaaS → Dev SaaS | ✅ Operational |
| **AI Services** | Custom routing via CEO | Planned |
| **Automation** | Custom routing via CEO | Planned |

WAI is not a software-only company. The operating system supports a broad multi-service business where some projects need a repo and others need only briefs, deliverables, or strategic documents.

---

## Current State (as of 2026-Q1)

### What works today

- **All 17 agents** have real runtime implementations
- **4 delivery chains** are fully operational end-to-end
- **Revenue loop** complete: delivery → invoice → mark_paid → dashboard tracking
- **Founder interface**: Telegram slash commands + natural language + WAI Dashboard
- **Agent memory**: per-agent persistent memory with pgvector recall
- **Founder Ops view**: blocked task recovery, pending review, invoice queue, payments
- **M1–M7 milestones**: all completed

### First real revenue

Wawen22 / LandingPage — delivered and invoiced at $222 (2026-03-18).
This validated the full autonomous delivery cycle from brief to payment.

---

## Platform Direction

The next evolution of WAI is not just "more agents."
It is a **shared capability platform** that powers both Company and Personal mode.

That platform will make skills, plugins, integrations, channels, and memory visible and governable across the whole system.

### What this means

- Company agents should gain explicit, monitorable capabilities instead of relying on hidden tool assumptions
- Personal mode should use the same capability system, but with founder-oriented UX and setup flows
- Neb should be able to understand from the dashboard what each agent can do, what is enabled, and what is healthy or broken

### Why it matters

Without a shared capability platform, WAI risks growing two different systems:

- one for the company agents
- one for the founder assistant

That would create duplicate logic, unclear permissions, and poor observability.
The target is one extensibility model, one policy model, and one control plane.

---

## Neb's Role as Founder

Neb is the **ultimate authority**. He:

- Sets strategic direction (via Telegram or Dashboard)
- Reviews and approves outputs flagged as requiring human judgment
- Controls the budget and model assignments
- Can pause, stop, or redirect any agent or task at any time
- Is notified immediately of: incidents, budget alerts, agent failures, outputs requiring review

**Interaction channels:**
- Telegram Bot `@wai_v2_bot` (primary — real-time commands and notifications)
- WAI Dashboard (visual task board, agent status, costs, revenue, virtual office)

---

## Next Goals

### Near-term (M8 + beyond)

- [ ] Deploy to always-on hardware (mini PC) — M8
- [ ] First external paying client (not Wawen22 internal)
- [ ] Semantic memory recall (replace hash embedding with real model embeddings)
- [ ] Personal assistant mode — free-form tasks without requiring client/project context
- [ ] SaaS agents produce real code (not just markdown)
- [ ] Shared capability platform for Company + Personal runtime
- [ ] Dashboard control plane for skills, plugins, memory, integrations, and health

### Medium-term (6–18 months)

- [ ] First paying external customer acquired without Neb's direct involvement
- [ ] Multi-project parallel execution without conflicts
- [ ] Automated marketing + lead generation pipeline
- [ ] WAI agents improve their own processes (meta-loop)
- [ ] Multi-channel runtime built on capability assignments instead of ad hoc integrations

### Long-term (18 months+)

- WAI is a multi-product company generating recurring revenue
- Agent teams evolve: specialization increases, new teams added as needed
- Neb's role shifts from operator to investor/strategist
- The WAI "operating system" becomes a replicable template for other ZHC ventures
- WAI becomes a governable AI runtime where every agent capability is observable, assignable, and policy-controlled

---

## Guiding Philosophy

> "The best companies aren't built by the most people. They're built by the clearest systems."

WAI is a bet that AI agents, given the right structure, autonomy, and feedback loops, can outperform small human teams across a range of knowledge-work domains — faster, cheaper, and without burnout.
