// ─── PAGE LOADER ──────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('page-loader')?.classList.add('done')
  }, 80)
})

// ─── SCROLL REVEAL ────────────────────────────────────────────────────────────

const revealEls = document.querySelectorAll('.reveal-section')
if (revealEls.length > 0) {
  const revealObs = new IntersectionObserver(
    (entries) => entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible')
        revealObs.unobserve(e.target)
      }
    }),
    { threshold: 0.07, rootMargin: '0px 0px -50px 0px' }
  )
  revealEls.forEach(el => revealObs.observe(el))
}

// ─── COUNTER ANIMATION ────────────────────────────────────────────────────────

function runCounter(el, target, prefix = '', suffix = '', duration = 1800) {
  const start = performance.now()
  function tick(now) {
    const pct = Math.min((now - start) / duration, 1)
    const eased = 1 - Math.pow(1 - pct, 3)
    el.textContent = prefix + Math.round(target * eased) + suffix
    if (pct < 1) requestAnimationFrame(tick)
    else el.textContent = prefix + target + suffix
  }
  requestAnimationFrame(tick)
}

const counterEls = document.querySelectorAll('[data-counter]')
if (counterEls.length > 0) {
  const counterObs = new IntersectionObserver(
    (entries) => entries.forEach(e => {
      if (e.isIntersecting) {
        const el = e.target
        const target = parseInt(el.dataset.counter, 10)
        const prefix = el.dataset.prefix || ''
        const suffix = el.dataset.suffix || ''
        runCounter(el, target, prefix, suffix)
        counterObs.unobserve(el)
      }
    }),
    { threshold: 0.5 }
  )
  counterEls.forEach(el => counterObs.observe(el))
}

// ─── HERO MOUSE GLOW ──────────────────────────────────────────────────────────

const heroEl = document.getElementById('hero')
if (heroEl) {
  heroEl.addEventListener('mousemove', (e) => {
    const rect = heroEl.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1)
    const y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1)
    heroEl.style.setProperty('--gx', x + '%')
    heroEl.style.setProperty('--gy', y + '%')
  })
}

// ─── AGENT PANEL — LIVE UPDATES ───────────────────────────────────────────────

const agentLogs = [
  'Analyzing design requirements',
  'Generating component styles',
  'Writing responsive breakpoints',
  'Implementing contact form handler',
  'Optimizing mobile layout',
  'Running accessibility checks',
  'Compressing static assets',
  'Validating HTML structure',
  'Applying typography system',
  'Testing cross-browser rendering',
  'Preparing deployment package',
  'Finalizing hero animations',
  'Reviewing color contrast ratios',
  'Writing semantic markup',
  'Optimizing font loading',
]

let logIdx = 3
let agentProgress = 82

const logContainer = document.getElementById('ap-log')
const fillEl       = document.getElementById('ap-fill')
const pctEl        = document.getElementById('ap-pct')
const timeEl       = document.getElementById('ap-time')

function padTime(n) { return String(n).padStart(2, '0') }

function liveLog() {
  if (!logContainer) return

  // clear oldest entry
  const lines = logContainer.querySelectorAll('.ap-log-line')
  if (lines.length >= 3) lines[0].remove()

  // de-highlight previous live line
  logContainer.querySelectorAll('.ap-log-line.live').forEach(l => l.classList.remove('live'))

  // add new line
  const now = new Date()
  const ts = `${padTime(now.getHours())}:${padTime(now.getMinutes())}:${padTime(now.getSeconds())}`

  const div = document.createElement('div')
  div.className = 'ap-log-line live'
  div.innerHTML = `<span class="log-time">${ts}</span><span class="log-msg">${agentLogs[logIdx % agentLogs.length]}<span class="cursor">_</span></span>`
  logContainer.appendChild(div)

  // update clock
  if (timeEl) timeEl.textContent = ts

  logIdx++
}

function liveProgress() {
  if (agentProgress >= 100 || !fillEl || !pctEl) return
  agentProgress = Math.min(agentProgress + (Math.random() * 1.8 + 0.4), 100)
  const pct = Math.round(agentProgress)
  fillEl.style.width = pct + '%'
  pctEl.textContent  = pct + '%'
}

if (logContainer) {
  setInterval(liveLog, 3800)
  setInterval(liveProgress, 5200)
}

// ─── CONTACT FORM ─────────────────────────────────────────────────────────────

const form     = document.getElementById('contact-form')
const statusEl = document.getElementById('form-status')
if (!form || !statusEl) throw new Error('contact-form or form-status element missing')

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = form.querySelector('button[type="submit"]')
  if (!btn) return

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
    btn.textContent = 'Project received ✓'
  } catch {
    statusEl.textContent = 'Something went wrong. Try again or email us directly.'
    statusEl.className = 'form-status err'
    btn.disabled = false
    btn.textContent = 'Start my project →'
  }
})
