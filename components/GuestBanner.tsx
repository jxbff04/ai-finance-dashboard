'use client';

import { useState } from 'react';
import { Users, LogOut, Loader2 } from 'lucide-react';
import { useMode } from '@/lib/ModeContext';

export default function GuestBanner() {
  const { exitMode } = useMode();
  const [isExiting, setIsExiting] = useState(false);

  const handleExit = async () => {
    setIsExiting(true);
    await exitMode();
    // exitMode akan set mode ke 'none' → SplashScreen otomatis muncul lagi
  };

  return (
    <div className="bg-amber-500 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Users className="w-3.5 h-3.5 text-black shrink-0" />
        <p className="text-[10px] font-bold text-black uppercase tracking-wide">
          Guest Mode · Data akan dihapus saat keluar
        </p>
      </div>
      <button
        onClick={handleExit}
        disabled={isExiting}
        className="flex items-center gap-1 text-[10px] font-bold text-black uppercase hover:opacity-70 transition-opacity disabled:opacity-50 shrink-0"
      >
        {isExiting
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <LogOut className="w-3 h-3" />}
        {isExiting ? 'Menghapus...' : 'Keluar'}
      </button>
    </div>
  );
}
