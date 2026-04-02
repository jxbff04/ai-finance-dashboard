'use client';

import { useMode } from '@/lib/ModeContext';
import SplashScreen from '@/components/SplashScreen';
import GuestBanner from '@/components/GuestBanner';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { mode } = useMode();

  // Belum pilih mode → tampilkan splash screen
  if (mode === null) {
    return <SplashScreen />;
  }

  return (
    <div className="flex flex-col min-h-screen">
      {mode === 'guest' && <GuestBanner />}
      {children}
    </div>
  );
}
