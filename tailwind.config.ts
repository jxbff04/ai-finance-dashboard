import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ─── BLACKJACK COLOR SYSTEM ──────────────────────────────────────────
      colors: {
        bj: {
          // Base layers
          base:     '#0A0A0A',
          surface:  '#111111',
          elevated: '#181818',
          overlay:  '#1F1F1F',

          // Accents
          silver:   '#C6C6C6',
          'silver-dim': '#7A7A7A',

          blue:     '#8FA3B8',
          'blue-dim': '#4A6070',

          emerald:  '#5C7F6E',
          'emerald-dim': '#3A5248',

          // Status
          profit:   '#6F8F7A',
          loss:     '#8F6F6F',
          warning:  '#8F7F5A',

          // Text
          'text-primary':   '#EFEFEF',
          'text-secondary': '#8A8A8A',
          'text-muted':     '#4A4A4A',
          'text-inverse':   '#0A0A0A',
        },
      },

      // ─── TYPOGRAPHY ──────────────────────────────────────────────────────
      fontFamily: {
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['SF Mono', 'Fira Code', 'Cascadia Code', 'Courier New', 'monospace'],
      },

      fontSize: {
        'bj-label': ['9px', { letterSpacing: '0.12em', lineHeight: '1.4' }],
        'bj-body':  ['13px', { lineHeight: '1.5' }],
        'bj-hero':  ['48px', { letterSpacing: '-0.03em', lineHeight: '0.9' }],
      },

      // ─── SPACING ─────────────────────────────────────────────────────────
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },

      // ─── BORDER RADIUS ───────────────────────────────────────────────────
      borderRadius: {
        'bj': '0px', // Blackjack uses zero radius — sharp edges
      },

      // ─── TRANSITIONS ─────────────────────────────────────────────────────
      transitionDuration: {
        'bj': '200ms',
        'bj-slow': '400ms',
      },

      transitionTimingFunction: {
        'bj': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },

      // ─── ANIMATIONS ──────────────────────────────────────────────────────
      keyframes: {
        'bj-deal': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'bj-emerge': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'bj-pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.3' },
        },
      },

      animation: {
        'bj-deal':   'bj-deal 300ms ease-out forwards',
        'bj-emerge': 'bj-emerge 400ms ease-out forwards',
        'bj-pulse':  'bj-pulse-slow 2s ease-in-out infinite',
      },

      // ─── BOX SHADOW ──────────────────────────────────────────────────────
      boxShadow: {
        'bj-sm':  '0 2px 8px rgba(0,0,0,0.4)',
        'bj-md':  '0 4px 20px rgba(0,0,0,0.6)',
        'bj-lg':  '0 8px 40px rgba(0,0,0,0.8)',
        'bj-glow-silver':  '0 0 20px rgba(198,198,198,0.08)',
        'bj-glow-emerald': '0 0 20px rgba(92,127,110,0.12)',
        'bj-glow-blue':    '0 0 20px rgba(143,163,184,0.10)',
      },

      // ─── BACKDROP BLUR ───────────────────────────────────────────────────
      backdropBlur: {
        'bj': '8px',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
