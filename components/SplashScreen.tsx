'use client';

import { useState, useRef, useEffect } from 'react';
import { Loader2, Delete } from 'lucide-react';
import { useMode } from '@/lib/ModeContext';
import { cn } from '@/lib/utils';

export default function SplashScreen() {
  const { enterGuest, enterPrivate } = useMode();
  const [screen, setScreen] = useState<'select' | 'pin'>('select');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (screen === 'pin') setTimeout(() => inputRef.current?.focus(), 150);
  }, [screen]);

  const handleGuestEnter = async () => {
    setIsLoading(true);
    try { await enterGuest(); }
    finally { setIsLoading(false); }
  };

  const handlePinSubmit = () => {
    if (pin.length < 4) return setError('Minimum 4 digits');
    const ok = enterPrivate(pin);
    if (!ok) { setError('Incorrect PIN'); setPin(''); }
  };

  const handleDigit = (d: string) => {
    if (d === 'del') { setPin(p => p.slice(0, -1)); setError(''); return; }
    if (pin.length >= 6) return;
    setPin(p => p + d);
    setError('');
  };

  const digits = ['1','2','3','4','5','6','7','8','9','','0','del'];

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ backgroundColor: '#0A0A0A' }}
    >
      {/* Subtle casino table line — horizontal center */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: '50%',
          height: '1px',
          background: 'rgba(255,255,255,0.03)',
          transform: 'translateY(-80px)',
        }}
      />

      <div
        className={cn(
          'w-full max-w-xs px-6 transition-all duration-700',
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
        )}
      >
        {/* ── BRAND ── */}
        <div className="mb-14 text-center">
          <h1
            style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: '52px',
              fontWeight: 300,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              color: '#EFEFEF',
            }}
          >
            Blackjack
          </h1>
          <div
            className="mx-auto mt-3 mb-0"
            style={{ height: '1px', width: '32px', background: 'rgba(198,198,198,0.25)' }}
          />
          <p
            className="mt-3"
            style={{
              fontSize: '9px',
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#4A4A4A',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Personal Finance Terminal
          </p>
        </div>

        {screen === 'select' ? (
          /* ── MODE SELECT ── */
          <div className="space-y-3">
            {/* Private */}
            <button
              onClick={() => setScreen('pin')}
              className="w-full text-left px-5 py-4 group transition-all duration-200"
              style={{
                background: '#111111',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(198,198,198,0.20)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
              }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#EFEFEF',
                    fontFamily: 'Inter, sans-serif',
                  }}>
                    Private
                  </p>
                  <p className="mt-1" style={{
                    fontSize: '11px',
                    color: '#4A4A4A',
                    fontFamily: 'Inter, sans-serif',
                    lineHeight: 1.4,
                  }}>
                    Full access · PIN protected
                  </p>
                </div>
                <span style={{ color: '#4A4A4A', fontSize: '16px', marginTop: '2px' }}>→</span>
              </div>
            </button>

            {/* Guest */}
            <button
              onClick={handleGuestEnter}
              disabled={isLoading}
              className="w-full text-left px-5 py-4 transition-all duration-200 disabled:opacity-40"
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
              onMouseEnter={e => {
                if (!isLoading) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.10)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.05)';
              }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#8A8A8A',
                    fontFamily: 'Inter, sans-serif',
                  }}>
                    {isLoading ? 'Preparing...' : 'Guest'}
                  </p>
                  <p className="mt-1" style={{
                    fontSize: '11px',
                    color: '#4A4A4A',
                    fontFamily: 'Inter, sans-serif',
                    lineHeight: 1.4,
                  }}>
                    Demo data · Cleared on exit
                  </p>
                </div>
                {isLoading
                  ? <Loader2 style={{ color: '#4A4A4A', width: 14, height: 14, marginTop: 4 }} className="animate-spin" />
                  : <span style={{ color: '#3A3A3A', fontSize: '16px', marginTop: '2px' }}>→</span>
                }
              </div>
            </button>

            <p className="text-center mt-8" style={{
              fontSize: '9px',
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: '#2A2A2A',
              fontFamily: 'Inter, sans-serif',
            }}>
              v2.0 · Luxury Noir
            </p>
          </div>
        ) : (
          /* ── PIN ENTRY ── */
          <div className="space-y-6">
            <div className="text-center">
              <button
                onClick={() => { setScreen('select'); setPin(''); setError(''); }}
                style={{
                  fontSize: '9px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#4A4A4A',
                  fontFamily: 'Inter, sans-serif',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  marginBottom: '20px',
                  display: 'block',
                  margin: '0 auto 20px',
                }}
              >
                ← Back
              </button>
              <p style={{
                fontSize: '9px',
                fontWeight: 600,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: '#4A4A4A',
                fontFamily: 'Inter, sans-serif',
              }}>
                Enter PIN
              </p>
            </div>

            {/* PIN dots */}
            <div className="flex justify-center gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    border: `1px solid ${i < pin.length ? '#C6C6C6' : 'rgba(255,255,255,0.15)'}`,
                    background: i < pin.length ? '#C6C6C6' : 'transparent',
                    transition: 'all 150ms ease-out',
                  }}
                />
              ))}
            </div>

            {/* Hidden input for physical keyboard */}
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
              className="sr-only"
            />

            {/* Error */}
            {error && (
              <p className="text-center" style={{
                fontSize: '11px',
                color: '#8F6F6F',
                fontFamily: 'Inter, sans-serif',
                letterSpacing: '0.04em',
              }}>
                {error}
              </p>
            )}

            {/* PIN pad */}
            <div className="grid grid-cols-3 gap-2">
              {digits.map((d, i) => (
                <button
                  key={i}
                  onClick={() => d !== '' && handleDigit(d)}
                  disabled={d === ''}
                  className="transition-all duration-150"
                  style={{
                    height: 52,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: d === '' ? 'transparent' : '#111111',
                    border: d === '' ? 'none' : '1px solid rgba(255,255,255,0.07)',
                    color: d === 'del' ? '#4A4A4A' : '#EFEFEF',
                    fontSize: d === 'del' ? 'inherit' : '16px',
                    fontWeight: 400,
                    fontFamily: 'Inter, sans-serif',
                    cursor: d === '' ? 'default' : 'pointer',
                  }}
                  onMouseEnter={e => {
                    if (d !== '') (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)';
                  }}
                  onMouseLeave={e => {
                    if (d !== '') (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)';
                  }}
                >
                  {d === 'del' ? <Delete style={{ width: 14, height: 14 }} /> : d}
                </button>
              ))}
            </div>

            {/* Unlock button */}
            <button
              onClick={handlePinSubmit}
              disabled={pin.length < 4}
              style={{
                width: '100%',
                padding: '12px',
                background: pin.length >= 4 ? '#C6C6C6' : '#1A1A1A',
                color: pin.length >= 4 ? '#0A0A0A' : '#3A3A3A',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontFamily: 'Inter, sans-serif',
                border: 'none',
                cursor: pin.length >= 4 ? 'pointer' : 'not-allowed',
                transition: 'all 200ms ease-out',
              }}
            >
              Unlock
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
