# T135 — WAI Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public-facing single-page site for WAI, served directly from the existing backend, with a contact form that feeds inbound leads into the pipeline and notifies Neb on Telegram.

**Architecture:** Vanilla HTML/CSS/JS in `landing/` at repo root. The raw Node.js HTTP server in `backend/src/index.ts` serves the three files statically for `GET /`, `GET /styles.css`, `GET /main.js`. A new `POST /api/contact` route saves the form submission as an `inbound` lead (score 50), notifies Neb via Telegram, and attempts an auto-reply via Gmail MCP.

**Tech Stack:** HTML5, CSS custom properties, vanilla JS fetch. Node.js built-in `readFile` for static serving. Existing `saveLead`, `sendFounderNotification`, `callGoogleWorkspaceMcpTool` services.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `landing/index.html` | Full single-page site markup |
| Create | `landing/styles.css` | All styles (dark theme, responsive) |
| Create | `landing/main.js` | Contact form fetch + success/error state |
| Modify | `backend/src/index.ts` | Add `fileURLToPath`/`dirname` imports, `LANDING_DIR` constant, static serving block, `/api/contact` route |
| Modify | `backend/src/types/index.ts` | Add `'inbound'` to `LeadSource` union |
| Modify | `dashboard/src/types/index.ts` | Add `'inbound'` to `LeadSource` union |

---

## Task 1 — Extend LeadSource type

**Files:**
- Modify: `backend/src/types/index.ts`
- Modify: `dashboard/src/types/index.ts`

- [ ] **Step 1: Update LeadSource in backend types**

Find this line in `backend/src/types/index.ts`:
```typescript
export type LeadSource = 'website_audit' | 'google_maps' | 'manual' | 'freelance'
```
Replace with:
```typescript
export type LeadSource = 'website_audit' | 'google_maps' | 'manual' | 'freelance' | 'inbound'
```

- [ ] **Step 2: Update LeadSource in dashboard types**

Find this same line in `dashboard/src/types/index.ts` and apply the identical change:
```typescript
export type LeadSource = 'website_audit' | 'google_maps' | 'manual' | 'freelance' | 'inbound'
```

- [ ] **Step 3: Update DB CHECK constraint**

In `supabase/migrations/20260326030000_leads.sql`, the `source` column has a CHECK constraint. **Do not modify the migration file** (it's already applied). Instead, run this in the Supabase SQL Editor:
```sql
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
  CHECK (source IN ('website_audit', 'google_maps', 'manual', 'freelance', 'inbound'));
```

- [ ] **Step 4: Typecheck**

```bash
cd backend && pnpm typecheck
cd dashboard && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/types/index.ts dashboard/src/types/index.ts
git commit -m "feat(T135): add 'inbound' to LeadSource type"
```

---

## Task 2 — Create landing/styles.css

**Files:**
- Create: `landing/styles.css`

- [ ] **Step 1: Create the file**

Create `landing/styles.css` at the repo root with this content:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0a0a0a;
  --surface: #111111;
  --border: #1e1e1e;
  --text: #f0f0f0;
  --muted: #666;
  --accent: #c8ff00;
  --font: 'Inter', -apple-system, sans-serif;
}

html { scroll-behavior: smooth; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  line-height: 1.6;
  font-size: 16px;
}

a { color: inherit; text-decoration: none; }

/* ── Nav ── */
nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 2rem;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: rgba(10, 10, 10, 0.95);
  backdrop-filter: blur(8px);
  z-index: 100;
}

.wordmark {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  font-family: 'Courier New', monospace;
}

.nav-cta {
  background: var(--accent);
  color: #000;
  font-weight: 600;
  font-size: 0.875rem;
  padding: 0.5rem 1.25rem;
  border-radius: 4px;
  transition: opacity 0.15s;
}
.nav-cta:hover { opacity: 0.8; }

/* ── Sections ── */
.inner { max-width: 1000px; margin: 0 auto; padding: 0 2rem; }

/* ── Hero ── */
.hero { padding: 8rem 2rem; max-width: 1000px; margin: 0 auto; }
.hero h1 {
  font-size: clamp(3rem, 8vw, 6rem);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.03em;
}
.accent { color: var(--accent); }
.subline {
  margin-top: 1.5rem;
  font-size: 1.25rem;
  color: var(--muted);
  max-width: 520px;
  line-height: 1.5;
}
.cta-button {
  display: inline-block;
  margin-top: 2.5rem;
  background: var(--accent);
  color: #000;
  font-weight: 700;
  font-size: 1rem;
  padding: 0.875rem 2rem;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s;
  font-family: var(--font);
}
.cta-button:hover { opacity: 0.85; }

/* ── Pills ── */
.pills-band {
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 2rem;
}
.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
  max-width: 1000px;
  margin: 0 auto;
}
.pill {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 0.5rem 1.25rem;
  border-radius: 999px;
  font-size: 0.875rem;
  color: var(--muted);
}

/* ── Services ── */
.services { padding: 5rem 2rem; max-width: 1000px; margin: 0 auto; }
.services h2 { font-size: 2rem; font-weight: 700; margin-bottom: 2.5rem; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem; }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.75rem;
}
.card-icon { font-size: 1.75rem; margin-bottom: 1rem; }
.card h3 { font-size: 1rem; font-weight: 600; margin-bottom: 0.5rem; }
.card p { font-size: 0.875rem; color: var(--muted); line-height: 1.6; }

/* ── Case Study ── */
.case-study {
  background: var(--surface);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 5rem 2rem;
}
.case-inner { max-width: 1000px; margin: 0 auto; }
.case-tag {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent);
  display: block;
  margin-bottom: 1.5rem;
}
.case-study h2 {
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  font-weight: 700;
  line-height: 1.3;
  margin-bottom: 1.5rem;
}
.case-study p { font-size: 1rem; color: var(--muted); max-width: 620px; }

/* ── Contact ── */
.contact { padding: 5rem 2rem; max-width: 1000px; margin: 0 auto; }
.contact h2 { font-size: 2rem; font-weight: 700; margin-bottom: 0.75rem; }
.contact-sub { color: var(--muted); margin-bottom: 2.5rem; }
#contact-form { display: flex; flex-direction: column; gap: 1rem; max-width: 560px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
input, textarea {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.875rem 1rem;
  color: var(--text);
  font-family: var(--font);
  font-size: 0.9rem;
  width: 100%;
  transition: border-color 0.15s;
}
input:focus, textarea:focus { outline: none; border-color: var(--accent); }
input::placeholder, textarea::placeholder { color: var(--muted); }
textarea { resize: vertical; }
.form-status { font-size: 0.875rem; min-height: 1.25rem; }
.form-status.ok { color: var(--accent); }
.form-status.err { color: #ff4444; }

/* ── Footer ── */
footer {
  border-top: 1px solid var(--border);
  padding: 2rem;
  display: flex;
  gap: 1rem;
  align-items: center;
}
.footer-sub { font-size: 0.8rem; color: var(--muted); }

/* ── Responsive ── */
@media (max-width: 600px) {
  .form-row { grid-template-columns: 1fr; }
  .hero { padding: 4rem 1.5rem; }
  nav { padding: 1rem 1.5rem; }
}
```

- [ ] **Step 2: Commit**

```bash
git add landing/styles.css
git commit -m "feat(T135): add landing page stylesheet"
```

---

## Task 3 — Create landing/main.js

**Files:**
- Create: `landing/main.js`

- [ ] **Step 1: Create the file**

Create `landing/main.js` at the repo root:

```javascript
const form = document.getElementById('contact-form')
const statusEl = document.getElementById('form-status')

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = form.querySelector('button[type="submit"]')
  btn.disabled = true
  btn.textContent = 'Sending…'
  statusEl.textContent = ''
  statusEl.className = 'form-status'

  const data = {}
  new FormData(form).forEach((value, key) => { data[key] = value })

  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (!res.ok) throw new Error(`${res.status}`)

    statusEl.textContent = "Sent. We'll be in touch within 24 hours."
    statusEl.className = 'form-status ok'
    form.reset()
    btn.textContent = 'Sent ✓'
  } catch {
    statusEl.textContent = 'Something went wrong. Try again or email us directly.'
    statusEl.className = 'form-status err'
    btn.disabled = false
    btn.textContent = 'Send →'
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add landing/main.js
git commit -m "feat(T135): add landing page contact form JS"
```

---

## Task 4 — Create landing/index.html

**Files:**
- Create: `landing/index.html`

- [ ] **Step 1: Create the file**

Create `landing/index.html` at the repo root:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WAI – Wawen Autonomous Industries</title>
  <meta name="description" content="AI-powered delivery for software, marketing, and consulting — with zero agency overhead.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>

  <!-- Nav -->
  <nav>
    <span class="wordmark">WAI</span>
    <a href="#contact" class="nav-cta">Get in touch</a>
  </nav>

  <!-- Hero -->
  <section class="hero">
    <h1>Work runs<br><span class="accent">autonomously.</span></h1>
    <p class="subline">AI-powered delivery for software, marketing, and consulting — with zero agency overhead.</p>
    <a href="#contact" class="cta-button">Get in touch →</a>
  </section>

  <!-- What we do -->
  <div class="pills-band">
    <div class="pills">
      <span class="pill">⚡ 24/7 autonomous delivery</span>
      <span class="pill">🎯 Founder-governed, not black-box</span>
      <span class="pill">🚫 No account managers. No markup.</span>
    </div>
  </div>

  <!-- Services -->
  <section class="services" id="services">
    <h2>What we deliver</h2>
    <div class="cards">
      <div class="card">
        <div class="card-icon">💻</div>
        <h3>Software Development</h3>
        <p>Web apps, APIs, and automation tools built and shipped by AI agents.</p>
      </div>
      <div class="card">
        <div class="card-icon">📣</div>
        <h3>Digital Marketing</h3>
        <p>Landing pages, content, and social campaigns — from strategy to execution.</p>
      </div>
      <div class="card">
        <div class="card-icon">📊</div>
        <h3>Business Consulting</h3>
        <p>Market analysis, process audits, and strategic briefs at machine speed.</p>
      </div>
      <div class="card">
        <div class="card-icon">🤖</div>
        <h3>AI Automation</h3>
        <p>Custom AI workflows that eliminate repetitive work from your operations.</p>
      </div>
    </div>
  </section>

  <!-- Case Study -->
  <div class="case-study">
    <div class="case-inner">
      <span class="case-tag">Case Study</span>
      <h2>We built and delivered a landing page autonomously.<br>Billed: <span class="accent">$222</span>. Same-day delivery.</h2>
      <p>Wawen22 needed a landing page. WAI's agents handled the brief, design, development, and delivery — end to end, without a single human writing a line of code.</p>
    </div>
  </div>

  <!-- Contact -->
  <section class="contact" id="contact">
    <h2>Ready to work with us?</h2>
    <p class="contact-sub">Tell us what you need. We'll get back to you within 24 hours.</p>
    <form id="contact-form">
      <div class="form-row">
        <input type="text" name="name" placeholder="Your name" required>
        <input type="text" name="company" placeholder="Company (optional)">
      </div>
      <input type="email" name="email" placeholder="Email address" required>
      <textarea name="message" placeholder="What do you need?" rows="4"></textarea>
      <button type="submit" class="cta-button">Send →</button>
      <p class="form-status" id="form-status"></p>
    </form>
  </section>

  <!-- Footer -->
  <footer>
    <span class="wordmark">WAI</span>
    <span class="footer-sub">Wawen Autonomous Industries</span>
  </footer>

  <script src="/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add landing/index.html
git commit -m "feat(T135): add landing page HTML"
```

---

## Task 5 — Backend: imports + LANDING_DIR constant

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add fileURLToPath and dirname imports**

In `backend/src/index.ts`, find the existing import:
```typescript
import { join, resolve as resolvePath } from 'node:path'
```
Replace with:
```typescript
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
```

- [ ] **Step 2: Add LANDING_DIR constant**

Immediately after the imports block (before the first `function` declaration), add:
```typescript
// Landing page static directory (repo root /landing/)
const __landingDirname = dirname(fileURLToPath(import.meta.url))
const LANDING_DIR = join(__landingDirname, '..', '..', 'landing')
```

- [ ] **Step 3: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(T135): add LANDING_DIR constant to backend"
```

---

## Task 6 — Backend: /api/contact route

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add the route**

In `backend/src/index.ts`, find the leads routes section (search for the comment `// ── Leads routes`). Add the following block **immediately before** that section:

```typescript
    // ── Contact form route (T135 Landing Page) ───────────────────────────────

    // POST /api/contact — inbound lead from landing page (public, no auth required)
    if (url.pathname === '/api/contact' && req.method === 'POST') {
      void (async () => {
        try {
          const body = await readJsonBody(req)
          const payload = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
          const name = (typeof payload['name'] === 'string' ? payload['name'] : '').trim()
          const company = (typeof payload['company'] === 'string' ? payload['company'] : '').trim()
          const email = (typeof payload['email'] === 'string' ? payload['email'] : '').trim()
          const message = (typeof payload['message'] === 'string' ? payload['message'] : '').trim()

          if (!name || !email) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'name and email are required' }))
            return
          }

          const { saveLead } = await import('./services/leads.js')
          const lead = await saveLead({
            company_name: company || name,
            contact_name: name,
            contact_email: email,
            source: 'inbound',
            status: 'qualified',
            score: 50,
            outreach_subject: '',
            outreach_draft: '',
            notes: message,
          })

          // Notify founder on Telegram (non-fatal)
          await sendFounderNotification(
            `🔔 New inbound lead: ${name}${company ? ` from ${company}` : ''} — ${email}${message ? `\n"${message.slice(0, 200)}"` : ''}`,
          ).catch(() => {})

          // Auto-reply via Gmail MCP (non-fatal — may not be connected)
          callGoogleWorkspaceMcpTool('gmail_send_email', {
            to: email,
            subject: 'Thanks for reaching out to WAI',
            body: `Hi ${name},\n\nThanks for reaching out. We've received your message and will get back to you within 24 hours.\n\nBest,\nWAI Team`,
          }).catch(() => {})

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, leadId: lead.id }))
        } catch (err) {
          log.error({ err }, 'Contact: POST /api/contact error')
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Internal server error' }))
        }
      })()
      return
    }
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(T135): add POST /api/contact route"
```

---

## Task 7 — Backend: static landing page serving

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add static serving block**

In `backend/src/index.ts`, find the final 404 handler at the very bottom:
```typescript
    res.writeHead(404)
    res.end()
```
Add the following block **immediately before** it:

```typescript
    // ── Landing page static serving (T135) ───────────────────────────────────
    // Serves landing/ files for GET requests not matched by any API route.
    if (req.method === 'GET') {
      const LANDING_FILES: Record<string, { file: string; ct: string }> = {
        '/':            { file: 'index.html', ct: 'text/html; charset=utf-8' },
        '/index.html':  { file: 'index.html', ct: 'text/html; charset=utf-8' },
        '/styles.css':  { file: 'styles.css', ct: 'text/css; charset=utf-8' },
        '/main.js':     { file: 'main.js',    ct: 'application/javascript; charset=utf-8' },
      }
      const entry = LANDING_FILES[url.pathname]
      if (entry) {
        void (async () => {
          try {
            const content = await readFile(join(LANDING_DIR, entry.file), 'utf-8')
            res.writeHead(200, { 'Content-Type': entry.ct })
            res.end(content)
          } catch {
            res.writeHead(404)
            res.end()
          }
        })()
        return
      }
    }
```

- [ ] **Step 2: Typecheck**

```bash
cd backend && pnpm typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(T135): serve landing page static files from backend"
```

---

## Task 8 — Manual verification

- [ ] **Step 1: Start the backend**

```bash
cd backend && pnpm dev
```

- [ ] **Step 2: Test landing page loads**

Open `http://localhost:3001/` in a browser.
Expected: WAI landing page renders with dark background, lime CTA button, all 5 sections visible.

- [ ] **Step 3: Test CSS and JS load**

Expected: styles applied (dark theme), no console errors.

- [ ] **Step 4: Test contact form**

Fill in name + email + message → click "Send →".
Expected:
- Button shows "Sent ✓"
- Status shows "Sent. We'll be in touch within 24 hours."
- Telegram message: "🔔 New inbound lead: ..."
- Lead appears in dashboard LeadsView with source `inbound`, status `qualified`, score 50

- [ ] **Step 5: Test validation**

Submit form with empty name → browser required validation blocks submit.
Submit with name but no email → browser blocks.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat(T135): WAI landing page complete — static site + contact form + inbound lead pipeline"
```

---

## How to Test End-to-End

1. Backend running: `cd backend && pnpm dev`
2. `GET http://localhost:3001/` → landing page
3. Fill contact form → check Telegram + dashboard Leads tab
4. Dashboard Leads view → filter "All" → new lead with source `inbound` visible
