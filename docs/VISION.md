# WAI Vision – Zero Human Company

## What is WAI?

**WAI (Wawen Autonomous Industries)** is an experiment in building a fully autonomous AI company. It operates 24/7 using a coordinated fleet of specialized AI agents, each responsible for a business domain, collectively operating as a coherent, self-directing organization.

The ultimate goal: WAI generates revenue, manages projects, serves clients, and grows — with minimal human intervention. The human Founder (Neb) sets direction, reviews critical outputs, and intervenes when strategic decisions require human judgment.

---

## The Zero Human Company Model

A Zero Human Company doesn't mean humans are unwanted — it means the *default mode of operation is autonomous*. Humans are in the loop by choice, not by necessity.

### Core Principles

1. **Agents are employees, not tools.** Each agent has a persistent identity, role, memory, and accountability within the organization.
2. **Tasks flow top-down, results flow bottom-up.** The CEO Agent breaks down Neb's strategic direction into delegated tasks; agents report back with outputs and blockers.
3. **Every action is logged.** All agent runs, model calls, tool uses, and decisions are recorded in Supabase for transparency, debugging, and cost control.
4. **The Founder is always one command away.** Neb can pause, redirect, approve, reject, or override anything via Telegram or Dashboard.
5. **Cost and quality are first-class citizens.** Agent routing considers model cost alongside capability. Budget alerts prevent runaway spend.

---

## Business Lines

WAI operates across multiple verticals simultaneously:

| Business Line | Description |
|--------------|-------------|
| **SaaS Products** | Autonomous development and management of software products |
| **Custom Software Dev** | Client projects designed and built by Dev agents |
| **Consulting** | Research, analysis, strategic reports, technical and AI advisory |
| **AI Services** | AI strategy, automation design, internal copilots, applied AI delivery |
| **Content & Marketing** | Blog posts, social media, campaigns, funnels, authority building |
| **Copywriting & Design** | Landing page copy, offer positioning, brand/design support |
| **Automation** | Internal workflows, lead pipelines, process automation for clients |

WAI is intentionally not a software-only company. Software is one delivery lane, not the company identity.
The operating system must support a broad multi-service business where some projects need a repo and others need only briefs, deliverables, campaign assets, or strategic documents.

## Current Autonomous Loops

As of 2026-03-17, WAI can already execute these end-to-end autonomous patterns locally:

- **SaaS chain:** `Neb /task → CEO → PM SaaS → Dev Lead SaaS → Dev SaaS workers → deliverables + PROGRESS + review`
- **Consulting chain:** `Neb /task client/project → CEO → Consulting Lead → proposal.md → Analyst → analysis.md`
- **Marketing chain:** `Neb /task client/project → CEO → Marketing Strategist → Content Creator + Social Manager → content/social deliverables`

The largest remaining execution gap is **custom software delivery for client projects that are not SaaS products**, where `architect`, `dev_general_*`, and `qa` still need full runtime implementation.

---

## Medium-Term Goals (6–18 months)

- [ ] Full autonomous SaaS development pipeline (spec → code → review → revenue)
- [ ] Full autonomous custom software pipeline (architecture → implementation → QA → client-ready delivery)
- [ ] First paying customer acquired without Neb's direct involvement
- [ ] Real-time cost tracking with zero budget overruns
- [ ] WAI Dashboard used as primary Founder interface (replacing ad-hoc CLI)
- [ ] Agent collaboration patterns: CEO delegates to team leads, team leads to workers
- [ ] Multi-model routing optimized by empirical cost/quality data

Production deployment remains a later operationalization step. The system should first prove that it can plan, deliver, review, and monetize work locally before it is moved to always-on infrastructure.

## Long-Term Vision (18 months+)

- WAI is a multi-product company generating recurring revenue
- WAI is a multi-service company capable of switching between software, advisory, marketing, and creative delivery lanes
- Agent teams evolve: specialization increases, new teams added as needed
- Neb's role shifts from operator to investor/strategist
- The WAI "operating system" becomes a replicable template for other ZHC ventures

---

## Neb's Role as Founder

Neb is not an agent but the **ultimate authority**. He:

- Sets strategic direction (via Telegram, Dashboard, or direct DB intervention)
- Reviews and approves agent outputs flagged as requiring human judgment
- Controls the budget and model assignments
- Can pause, stop, or redirect any agent or task at any time
- Is notified immediately of: incidents, budget alerts, agent failures, and outputs marked for review

**Interaction channels:**
- Telegram Bot (real-time commands and notifications)
- WAI Dashboard (visual task board, agent status, costs)
- Direct Supabase queries (power-user interventions)
- OpenClaw CLI (advanced agent management)

---

## Guiding Philosophy

> "The best companies aren't built by the most people. They're built by the clearest systems."

WAI is a bet that AI agents, given the right structure, autonomy, and feedback loops, can outperform small human teams across a range of knowledge-work domains — faster, cheaper, and without burnout.
