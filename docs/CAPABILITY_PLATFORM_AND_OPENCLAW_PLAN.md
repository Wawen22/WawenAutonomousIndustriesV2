# WAI Capability Platform Plan

> Canonical strategic plan for bringing skills, plugins, memory, integrations, and channel capabilities into WAI without splitting Company and Personal into separate systems.

---

## Why This Exists

WAI is no longer just a task router for a fleet of company agents.
It is becoming a **dual runtime**:

- a **Company Runtime** for autonomous delivery, operations, and revenue
- a **Personal Runtime** for Neb as founder and operator

Both runtimes need the same underlying capability primitives:

- skills
- plugins
- memory
- integrations
- channels
- filesystem and tool access
- security and policy enforcement

The mistake to avoid is building one system for `Company` and another for `Personal`.
WAI should instead have **one shared capability platform** with different governance rules depending on the runtime and agent.

---

## Product Positioning

OpenClaw is a strong reference for:

- gateway thinking
- plugin and skills structure
- workspace-centric memory
- explicit trust boundaries
- runtime extensibility

But WAI should not become "OpenClaw with a dashboard."

WAI's product position remains different:

- **OpenClaw** is a personal assistant runtime
- **WAI** is a company operating system with a founder runtime built on top

So the goal is not wholesale adoption.
The goal is to absorb the best runtime patterns and apply them to a broader business operating system.

---

## Core Principle

WAI should have:

- **one capability platform**
- **two consuming runtimes**
  - `WAI Company Runtime`
  - `WAI Personal Runtime`

The distinction is not where a capability exists.
The distinction is:

- who can use it
- under what policy
- with what visibility
- with what audit trail

---

## Capability Types

### Skills

Reusable operational instructions that teach an agent how to perform a workflow or use a tool effectively.

Examples:

- `proposal-writing`
- `repo-bootstrap`
- `founder-briefing`
- `important-email-triage`
- `invoice-followup`

### Plugins

Runtime extensions that register one or more capabilities into WAI.

Examples:

- `telegram`
- `gmail`
- `google-drive`
- `local-filesystem`
- `vector-memory`

### Memory Providers

Pluggable memory backends with clear scope and retention rules.

Required memory layers:

- `Personal Memory`
- `Agent Memory`
- `Company Memory`

### Integrations

External business or productivity systems exposed in a controlled way.

Examples:

- Gmail
- Google Calendar
- Google Drive
- Stripe
- Notion
- Supabase admin helpers

### Channels

Messaging and control surfaces through which WAI can receive instructions and send outputs.

Examples:

- Telegram
- Dashboard
- future WhatsApp / Slack

---

## Governance Model

Every capability in WAI should be governed through five lenses.

### 1. Catalog

What exists in the system.

Each capability should have at least:

- id
- type
- label
- description
- owner
- runtime target
- status
- risk level

### 2. Assignment

Who can use it.

Assignments should support:

- `personal`
- `company`
- single agent
- team
- global shared assignment

### 3. Policy

What limits apply.

Examples:

- read-only filesystem
- restricted paths
- approval required
- allowed commands
- environment requirements
- rate or usage limits

### 4. Health

Whether the capability is actually usable right now.

Examples:

- connected
- degraded
- missing config
- auth expired
- failing
- disabled

### 5. Audit

What happened when the capability was used.

Examples:

- who enabled it
- who assigned it
- last successful use
- last failed use
- impacted runs or tasks
- last configuration change

---

## Target Architecture

The shared capability platform should introduce five backend layers.

### Capability Registry

Source of truth for all skills, plugins, memory providers, channels, and integrations known to WAI.

### Assignment Engine

Resolves which runtime, team, or agent can access which capability.

### Policy Engine

Applies execution constraints before a tool, integration, or plugin can be used.

### Runtime Adapter Layer

Exposes the same capability platform to:

- company agents
- founder personal runtime
- dashboard actions
- future external channels

### Observability Layer

Collects:

- health state
- usage
- errors
- config drift
- audit events

---

## Company And Personal Usage

This platform is shared by both sides of WAI, but not used in the same way.

### Company Runtime

Company agents should use capabilities under stricter governance:

- explicit per-agent assignment
- stronger policy enforcement
- auditable changes
- safer defaults
- business-oriented memory boundaries

This is where agent teams become truly observable and configurable from the dashboard.

### Personal Runtime

Personal mode can move faster:

- founder-centric quick activation
- direct setup workflows
- lighter UI for experimentation
- more flexible daily operations

But it should still consume the same underlying registry, assignments, and policy rules.

---

## Dashboard Direction

The dashboard should become the control plane for capabilities.

Recommended future area:

- `Capabilities`

Recommended views:

### Catalog

Browse all known capabilities with type, status, requirements, and risk.

### Assignments

Matrix view of:

- runtimes
- teams
- agents
- attached capabilities

### Policies

View and edit safety rules, scope, path restrictions, approval mode, and required configuration.

### Health

Operational status of integrations, memory backends, channels, and plugins.

### Audit

Recent capability changes and usage history.

---

## What To Build First

The first implementation wave should stay narrow and real.

### MVP Backend

Build:

- capability type definitions
- capability registry service
- assignment model
- basic policy model
- health model
- read APIs for dashboard consumption

Do not build a full marketplace or general plugin execution framework in the first pass.

### MVP Dashboard

Build:

- `Capabilities` view
- compact catalog
- assignment visibility
- health badges
- basic filtering

The MVP should prioritize visibility and control before advanced editing.

### First Real Capability Set

Start with a small high-value set:

- core skills metadata
- current Google Workspace integrations
- current personal quick-action capabilities
- memory providers as explicit platform objects

This gives WAI immediate structure without pretending the plugin system is finished.

---

## Scope Boundaries

### Build Now

- shared capability data model
- dashboard visibility
- company and personal assignment model
- explicit memory layering
- health and audit foundation

### Build Later

- full plugin lifecycle hooks
- install/update flow from UI
- multi-channel expansion
- richer security presets
- agent-specific skill editors

### Do Not Rush

- marketplace dynamics
- unbounded third-party plugin loading
- many new channels at once
- complicated nested capability inheritance rules

---

## Milestone Direction

Recommended sequence after this documentation phase:

1. Introduce capability contracts in backend
2. Add a read-only capability registry API
3. Add dashboard `Capabilities` MVP
4. Model company and personal assignments
5. Make current integrations and skills visible through the new system
6. Expand policy and health handling
7. Refactor `Assistant HQ` to consume the same platform cleanly

---

## Strategic Outcome

If this plan is executed well, WAI gains:

- a cleaner product architecture
- one extensibility model for both Company and Personal
- safer growth into channels, tools, and integrations
- founder control from dashboard instead of hidden config sprawl
- a real path from today's MCP integrations to a full capability platform

This is the right way to learn from OpenClaw:

- adopt the strong runtime ideas
- preserve WAI's identity as a company operating system
- make the founder runtime and the company runtime converge on one shared platform
