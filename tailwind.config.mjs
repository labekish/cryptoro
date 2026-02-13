/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx,vue,svelte}',
    './public/**/*.html',
    './*.{html,js,ts,mjs,cjs}'
  ],
  safelist: [
    // JS-toggled classes in catalog filtering/reveal interactions
    'opacity-0',
    'opacity-100',
    'translate-y-0',
    'translate-y-5',
    'bg-zinc-900',
    'text-white',
    'text-zinc-600',
    'border-zinc-900',
    'border-zinc-300',
    // Core UI primitives used across legacy pages
    'hidden',
    'block',
    'flex',
    'grid',
    'inline-flex',
    'sticky',
    'fixed',
    'relative',
    'absolute',
    'z-40',
    'z-50',
    'top-0',
    'top-14',
    'bg-white',
    'bg-black',
    'text-black',
    'rounded-xl',
    'rounded-2xl',
    'rounded-full',
    'border',
    'shadow',
    'shadow-lg',
    'transition',
    'duration-300',
    // Brand accents and arbitrary utilities used in cards/buttons
    'bg-gradient-to-r',
    'bg-gradient-to-b',
    'from-zinc-900/95',
    'to-zinc-900/95',
    'from-zinc-200',
    'to-zinc-100',
    'bg-white/95',
    'bg-white/90',
    'text-white/80',
    'border-zinc-200/80',
    'border-zinc-300/70',
    'backdrop-blur',
    'backdrop-blur-xl',
    'hover:scale-[1.02]',
    'hover:scale-105',
    'hover:bg-zinc-800',
    'hover:bg-zinc-600',
    'hover:shadow-soft',
    'focus:ring-2',
    'ring-brand-500',
    'p-[1px]',
    'drop-shadow-[0_16px_28px_rgba(17,24,39,.18)]',
    'from-cryptoro-orange',
    'to-cryptoro-gold'
  ],
  theme: {
    extend: {
      colors: {
        cryptoro: {
          black: '#0a0a0a',
          surface: '#111111',
          orange: '#FF4500',
          gold: '#FFD700'
        },
        brand: {
          50: '#fff5eb',
          100: '#ffe7cc',
          200: '#ffce99',
          300: '#ffb066',
          400: '#ff8d33',
          500: '#FF4500',
          600: '#e03c00',
          700: '#b83000',
          800: '#8f2500',
          900: '#661a00'
        }
      },
      backgroundImage: {
        'cryptoro-gradient': 'linear-gradient(90deg, #FF4500 0%, #FFD700 100%)',
        'cryptoro-gradient-vertical': 'linear-gradient(180deg, #FF4500 0%, #FFD700 100%)'
      },
      boxShadow: {
        soft: '0 14px 34px rgba(16,24,40,.10)',
        glow: '0 12px 30px rgba(255,69,0,.28)'
      }
    }
  },
  plugins: []
};
