/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wai: {
          bg:           '#05080F',
          surface:      '#0A1628',
          'surface-2':  '#0F2040',
          cyan:         '#00D4FF',
          'cyan-dim':   'rgba(0,212,255,0.08)',
          violet:       '#818CF8',
          'violet-dim': 'rgba(129,140,248,0.08)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-cyan':    '0 0 24px rgba(0,212,255,0.18)',
        'glow-emerald': '0 0 24px rgba(16,185,129,0.18)',
        'glow-rose':    '0 0 24px rgba(244,63,94,0.18)',
        'panel':        '0 4px 32px rgba(0,0,0,0.5)',
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
