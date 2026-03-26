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
