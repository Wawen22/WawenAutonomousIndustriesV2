# WAI Superpowers: Native Scaffolding, Vision & Terminal Autonomy

This document describes the "Superpowers" added to WAI to enable fully autonomous web development and testing.

## 1. Native Scaffolding (Terminal Autonomy)

WAI no longer relies solely on manual file generation for starting projects. The **Architect** agent can now decide to use official industry-standard CLI tools to bootstrap a repository.

- **Capability:** The `Architect` can specify an `initializationCommand` in its architectural plan.
- **Example:** `npx create-next-app@latest . --typescript --tailwind --eslint`
- **How it works:** When a project is initialized, WAI executes this command directly in the repository folder before any other implementation tasks begin. This ensures the project starts with a perfect, standard configuration.

## 2. Full Terminal Autonomy (Arbitrary Shell Commands)

Developer agents (`dev_saas`, `dev_general`) are no longer restricted to a fixed set of commands (`npm install`, `npm build`).

- **Capability:** Implementation plans now support a `shellCommands` array.
- **Example:**
  - `npm install lucide-react` (adding a specific library during dev)
  - `npx prisma generate` (running database tools)
  - `npm run lint --fix` (automatic code cleanup)
- **Workflow:** Edits are applied first, then requested shell commands are executed. If a blocking command fails, the agent stops and reports the issue, allowing for the "Self-Correction Loop" to kick in.

## 3. Vision & Visual QA (Browser Power)

WAI agents can now "see" the applications they build using Playwright-powered browser tools.

- **Tool:** `screenshot`
- **Capabilities:**
  - **Dev Verification:** Developers can take a screenshot of a local running server to verify that the UI matches the requirements.
  - **QA Validation:** The QA agent uses screenshots to perform visual regression testing and include "proof of work" in the final QA report.
- **Implementation:** Integrated via the `screenshot` tool in the `TOOL_REGISTRY`, using a headless Chromium instance.

## 4. Architectural Integrity (Sequential Bootstrap)

To prevent file conflicts and structure drift (e.g., `src/app` vs `/app`), WAI now enforces a strict sequential process for new projects.

- **Rule:** The Architect forces Task 1 to be "Core Scaffolding" (Single Agent). Task 2 and beyond are blocked until the foundation is committed.
- **Rule:** Developers obey "Respect the Repo". They detect existing folder structures (`src/`) and conform to them rather than inventing their own.

## How to Test these Superpowers

To verify that WAI is using its new powers, you can run a test project with the following prompt:

> "Crea un nuovo progetto chiamato 'SuperApp' usando Next.js. 
> 1. Usa lo scaffolding ufficiale (npx create-next-app).
> 2. Implementa una landing page moderna con Tailwind CSS.
> 3. Installa la libreria 'lucide-react' per le icone e usala nella pagina.
> 4. Esegui un controllo QA che includa uno screenshot della pagina per verificare il layout."

### What to look for in the logs:
1. **Architect:** Check if the architecture plan includes the `initializationCommand`.
2. **Software Runtime:** Watch the terminal output for the `npx` command and the `npm install` for Lucide.
3. **QA Report:** Verify that the final `qa_report.md` (or the project deliverables folder) contains a `screenshot.png`.
