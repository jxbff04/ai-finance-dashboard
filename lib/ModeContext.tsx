'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

export type AppMode = 'guest' | 'private';

interface ModeContextValue {
  mode: AppMode | null;
  sessionId: string | null;
  enterGuest: () => Promise<void>;
  enterPrivate: (pin: string) => boolean;
  changePin: (oldPin: string, newPin: string) => boolean;
  exitMode: () => Promise<void>;
}

const ModeContext = createContext<ModeContextValue>({
  mode: null,
  sessionId: null,
  enterGuest: async () => {},
  enterPrivate: () => false,
  changePin: () => false,
  exitMode: async () => {},
});

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AppMode | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const enterGuest = async () => {
    const newSessionId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Insert akun dummy
    const { data: dummyAccounts } = await supabase
      .from('guest_accounts')
      .insert([
        { session_id: newSessionId, name: 'BCA Utama', type: 'Bank Account', balance: 8500000 },
        { session_id: newSessionId, name: 'GoPay', type: 'E-Wallet', balance: 450000 },
        { session_id: newSessionId, name: 'Cash', type: 'Cash', balance: 300000 },
      ])
      .select();

    // Insert transaksi dummy
    if (dummyAccounts && dummyAccounts.length > 0) {
      const bcaId = dummyAccounts[0].id;
      const gopayId = dummyAccounts[1].id;
      const cashId = dummyAccounts[2].id;
      const today = new Date();
      const fmt = (d: Date) => d.toISOString().split('T')[0];
      const daysAgo = (n: number) => {
        const d = new Date(today);
        d.setDate(d.getDate() - n);
        return fmt(d);
      };

      await supabase.from('guest_transactions').insert([
        { session_id: newSessionId, account_id: bcaId, amount: 5000000, type: 'income', notes: 'Gaji Bulan Ini', category: 'Salary', transaction_date: daysAgo(10) },
        { session_id: newSessionId, account_id: gopayId, amount: 1500000, type: 'income', notes: 'Freelance Project', category: 'Freelance', transaction_date: daysAgo(8) },
        { session_id: newSessionId, account_id: gopayId, amount: -45000, type: 'expense', notes: 'Makan Siang', category: 'Food', transaction_date: daysAgo(7) },
        { session_id: newSessionId, account_id: gopayId, amount: -15000, type: 'expense', notes: 'Kopi Pagi', category: 'Food', transaction_date: daysAgo(6) },
        { session_id: newSessionId, account_id: bcaId, amount: -500000, type: 'expense', notes: 'Bayar Listrik', category: 'Bills', transaction_date: daysAgo(5) },
        { session_id: newSessionId, account_id: cashId, amount: -80000, type: 'expense', notes: 'Bensin Motor', category: 'Transport', transaction_date: daysAgo(4) },
        { session_id: newSessionId, account_id: gopayId, amount: -13000, type: 'expense', notes: 'Spotify Premium', category: 'Entertainment', transaction_date: daysAgo(3) },
        { session_id: newSessionId, account_id: bcaId, amount: -200000, type: 'expense', notes: 'Belanja Bulanan', category: 'Groceries', transaction_date: daysAgo(2) },
        { session_id: newSessionId, account_id: gopayId, amount: -25000, type: 'expense', notes: 'Grab ke Kantor', category: 'Transport', transaction_date: daysAgo(1) },
        { session_id: newSessionId, account_id: bcaId, amount: -79000, type: 'expense', notes: 'Netflix', category: 'Entertainment', transaction_date: fmt(today) },
      ]);
    }

    setSessionId(newSessionId);
    setMode('guest');
  };

  const getStoredPin = (): string => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('bj_pin') || '141201';
    }
    return '141201';
  };

  const enterPrivate = (pin: string): boolean => {
    const correctPin = getStoredPin();
    if (pin.trim() === correctPin) {
      setMode('private');
      return true;
    }
    return false;
  };

  const changePin = (oldPin: string, newPin: string): boolean => {
    const correctPin = getStoredPin();
    if (oldPin.trim() !== correctPin) return false;
    localStorage.setItem('bj_pin', newPin.trim());
    return true;
  };

  const exitMode = async () => {
    if (mode === 'guest' && sessionId) {
      try {
      await supabase.from('guest_transactions').delete().eq('session_id', sessionId);
      await supabase.from('guest_accounts').delete().eq('session_id', sessionId);
      await supabase.from('guest_budgets').delete().eq('session_id', sessionId);
      await supabase.from('guest_goals').delete().eq('session_id', sessionId);
      await supabase.from('guest_sessions').delete().eq('session_id', sessionId);
      } catch (e) {
        console.error('Failed to cleanup guest data:', e);
      }
    }
    setMode(null);
    setSessionId(null);
  };

  return (
    <ModeContext.Provider value={{ mode, sessionId, enterGuest, enterPrivate, changePin, exitMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  return useContext(ModeContext);
}
