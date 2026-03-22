'use client';

import { Toaster as SonnerToaster } from 'sonner';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      theme="dark"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'border border-emerald-500/30 bg-[#1A1A1A] text-gray-100 shadow-xl',
          success: 'border-emerald-500/40',
        },
      }}
    />
  );
}
