'use client';

import { useState, useRef, useEffect } from 'react';
import { Loader2, Lock, Users, Delete } from 'lucide-react';
import { useMode } from '@/lib/ModeContext';
import { cn } from '@/lib/utils';

export default function SplashScreen() {
  const { enterGuest, enterPrivate } = useMode();
  const [screen, setScreen] = useState<'select' | 'pin'>('select');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (screen === 'pin') {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [screen]);

  const handleGuestEnter = async () => {
    setIsLoading(true);
    try {
      await enterGuest();
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinSubmit = () => {
    if (pin.length < 4) return setError('PIN minimal 4 digit');
    const success = enterPrivate(pin);
    if (!success) {
      setError('PIN salah. Coba lagi.');
      setPin('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePinSubmit();
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  const handleDigit = (d: string) => {
    if (d === 'del') {
      setPin(p => p.slice(0, -1));
      setError('');
      return;
    }
    if (pin.length >= 6) return;
    setPin(p => p + d);
    setError('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center px-6">

      {/* Logo */}
      <div className="mb-12 text-center">
        <h1 className="text-5xl font-serif font-black text-white tracking-tighter leading-none">
          Blackjack
        </h1>
        <p className="text-[11px] text-gray-500 uppercase tracking-widest mt-2 font-mono">
          Personal Finance Terminal
        </p>
      </div>

      {screen === 'select' ? (
        /* ── MODE SELECTION ── */
        <div className="w-full max-w-xs space-y-4">
          <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest text-center mb-6">
            Select Access Mode
          </p>

          {/* PRIVATE MODE */}
          <button
            onClick={() => setScreen('pin')}
            className="w-full border border-white p-5 flex items-start gap-4 hover:bg-white hover:text-black transition-all duration-200 group text-left"
          >
            <Lock className="w-5 h-5 text-white group-hover:text-black mt-0.5 shrink-0 transition-colors" />
            <div>
              <p className="text-sm font-bold text-white group-hover:text-black uppercase tracking-wide transition-colors">
                Private Mode
              </p>
              <p className="text-[11px] text-gray-400 group-hover:text-gray-700 mt-1 transition-colors">
                Akses penuh dengan PIN. Data tersimpan permanen.
              </p>
            </div>
          </button>

          {/* GUEST MODE */}
          <button
            onClick={handleGuestEnter}
            disabled={isLoading}
            className="w-full border border-gray-700 p-5 flex items-start gap-4 hover:border-gray-400 transition-all duration-200 group text-left disabled:opacity-50"
          >
            {isLoading
              ? <Loader2 className="w-5 h-5 text-gray-400 mt-0.5 shrink-0 animate-spin" />
              : <Users className="w-5 h-5 text-gray-400 group-hover:text-gray-200 mt-0.5 shrink-0 transition-colors" />
            }
            <div>
              <p className="text-sm font-bold text-gray-400 group-hover:text-gray-200 uppercase tracking-wide transition-colors">
                {isLoading ? 'Menyiapkan...' : 'Guest Mode'}
              </p>
              <p className="text-[11px] text-gray-600 group-hover:text-gray-500 mt-1 transition-colors">
                Coba tanpa akun. Semua data dihapus saat keluar.
              </p>
            </div>
          </button>

          <p className="text-[9px] text-gray-700 text-center mt-6 uppercase tracking-widest">
            Blackjack · Personal Finance
          </p>
        </div>
      ) : (
        /* ── PIN ENTRY ── */
        <div className="w-full max-w-xs space-y-6">
          <div className="text-center">
            <button
              onClick={() => { setScreen('select'); setPin(''); setError(''); }}
              className="text-[10px] text-gray-600 hover:text-gray-400 uppercase tracking-widest transition-colors mb-4"
            >
              ← Back
            </button>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
              Enter PIN
            </p>
          </div>

          {/* PIN Dots */}
          <div className="flex justify-center gap-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-3 h-3 rounded-full border-2 transition-all duration-150',
                  i < pin.length
                    ? 'bg-white border-white'
                    : 'bg-transparent border-gray-600'
                )}
              />
            ))}
          </div>

          {/* DEBUG — hapus setelah fix */}
          <p className="text-center text-yellow-400 font-mono text-xs">{pin} | env: {process.env.NEXT_PUBLIC_APP_PIN}</p>

          {/* Hidden input untuk keyboard fisik */}
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={e => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 6);
              setPin(val);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            className="sr-only"
          />

          {/* Error */}
          {error && (
            <p className="text-[11px] text-red-400 text-center font-mono animate-pulse">
              {error}
            </p>
          )}

          {/* PIN PAD */}
          <div className="grid grid-cols-3 gap-3">
            {digits.map((d, i) => (
              <button
                key={i}
                onClick={() => d !== '' && handleDigit(d)}
                disabled={d === ''}
                className={cn(
                  'h-14 flex items-center justify-center text-lg font-bold transition-all duration-150 border',
                  d === ''
                    ? 'border-transparent cursor-default'
                    : d === 'del'
                    ? 'border-gray-800 text-gray-400 hover:border-gray-600 hover:text-white active:bg-gray-800'
                    : 'border-gray-800 text-white hover:border-gray-500 hover:bg-gray-900 active:bg-gray-800'
                )}
              >
                {d === 'del' ? <Delete className="w-4 h-4" /> : d}
              </button>
            ))}
          </div>

          {/* Submit */}
          <button
            onClick={handlePinSubmit}
            disabled={pin.length < 4}
            className="w-full bg-white text-black py-3.5 font-bold uppercase text-sm tracking-wide hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Unlock
          </button>
        </div>
      )}
    </div>
  );
}
