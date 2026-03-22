'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Plus,
  ArrowRightLeft,
  Building2,
  Banknote,
  Smartphone,
  Coins,
  Calendar,
  Download,
  Filter,
  Terminal,
  LineChart,
  Activity,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ResponsiveContainer,
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import TransactionDialog from '@/components/transaction/TransactionDialog';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: string | number | null;
  currency?: string;
}

interface Transaction {
  id: string;
  account_id: string;
  transaction_date: string;
  notes: string;
  category: string;
  amount: number | string;
  type: 'income' | 'expense' | 'transfer';
  accounts: {
    name: string;
  };
}

type TxFilter = {
  type: 'all' | 'income' | 'expense' | 'transfer';
  accountId: 'all' | string;
};

function renderBoldMarkdown(text: string, variant: 'user' | 'assistant'): ReactNode[] {
  const strongClass =
    variant === 'user' ? 'font-semibold text-emerald-50' : 'font-semibold text-white';
  const re = /\*\*([\s\S]+?)\*\*/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(<span key={`t-${k++}`}>{text.slice(last, m.index)}</span>);
    }
    nodes.push(
      <strong key={`b-${k++}`} className={strongClass}>
        {m[1]}
      </strong>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(<span key={`t-${k++}`}>{text.slice(last)}</span>);
  }
  return nodes.length > 0 ? nodes : [<span key="plain">{text}</span>];
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const withTimeout = async <T,>(promise: any, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Request timeout after ${ms}ms`)), ms);
    });

    return await Promise.race([Promise.resolve(promise) as Promise<T>, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const getAccountIcon = (type: string) => {
  const typeUpper = type.toUpperCase();
  if (typeUpper.includes('BANK')) return Building2;
  if (typeUpper.includes('CASH')) return Banknote;
  if (typeUpper.includes('E-WALLET') || typeUpper.includes('WALLET')) return Smartphone;
  if (typeUpper.includes('GOLD')) return Coins;
  return Wallet;
};

const getAccountColor = (type: string) => {
  const typeUpper = type.toUpperCase();
  if (typeUpper.includes('BANK')) return 'text-blue-400';
  if (typeUpper.includes('CASH')) return 'text-emerald-400';
  if (typeUpper.includes('E-WALLET') || typeUpper.includes('WALLET')) return 'text-cyan-400';
  if (typeUpper.includes('GOLD')) return 'text-amber-400';
  return 'text-gray-400';
};

const getMessageText = (message: UIMessage) =>
  message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');

function getCurrentYearMonth(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function parseTransactionDate(t: Transaction): Date | null {
  const d = new Date(t.transaction_date);
  return Number.isNaN(d.getTime()) ? null : d;
}

function transactionInYearMonth(t: Transaction, yearMonth: string): boolean {
  const d = parseTransactionDate(t);
  if (!d) return false;
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return ym === yearMonth;
}

function buildMonthSelectOptions(monthsBack = 36): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const n = new Date();
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(n.getFullYear(), n.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    out.push({ value, label });
  }
  return out;
}

function formatYearMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return yearMonth;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}

function escapeCsvField(value: string): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadTransactionsCsv(rows: Transaction[], periodLabel: string) {
  const headers = ['tanggal', 'tipe', 'catatan', 'kategori', 'akun', 'nominal'];
  const lines = [headers.join(',')];
  for (const t of rows) {
    const amount = toNumber(t.amount);
    lines.push(
      [
        escapeCsvField(t.transaction_date),
        escapeCsvField(t.type),
        escapeCsvField(t.notes),
        escapeCsvField(t.category),
        escapeCsvField(t.accounts?.name ?? ''),
        escapeCsvField(String(amount)),
      ].join(',')
    );
  }
  const safePeriod = periodLabel.replace(/[^\w\-]+/g, '_');
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transaksi_${safePeriod}.csv`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [transactionDialogInitialType, setTransactionDialogInitialType] = useState<
    Transaction['type']
  >('income');

  const [input, setInput] = useState('');
  const [txFilter, setTxFilter] = useState<TxFilter>({ type: 'all', accountId: 'all' });
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentYearMonth);

  const monthOptions = useMemo(() => buildMonthSelectOptions(36), []);
  const selectedMonthLabel = useMemo(() => formatYearMonthLabel(selectedMonth), [selectedMonth]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    let accountsById = new Map<string, string>();

    try {
      try {
        const accountsWithOrder = await withTimeout<any>(
          supabase.from('accounts').select('*').order('name', { ascending: true }),
          15000
        );

        if (accountsWithOrder.error) throw accountsWithOrder.error;

        const accountsData: any[] = accountsWithOrder.data || [];
        setAccounts(accountsData);

        accountsById = new Map<string, string>(
          accountsData.map((a) => [String(a.id), String(a.name)])
        );
      } catch (accountsErr) {
        console.error(accountsErr);
        setAccounts([]);
        setErrorMessage('Gagal mengambil daftar akun dari Supabase.');
      }

      void (async () => {
        try {
          let categoriesById = new Map<string, string>();
          try {
            const categoriesRes = await withTimeout<any>(
              supabase
                .from('categories')
                .select('id, name')
                .order('name', { ascending: true }),
              15000
            );

            if (!categoriesRes?.error) {
              const categoriesData: Array<{ id: string; name: string }> = (categoriesRes?.data ||
                []) as any;
              categoriesById = new Map<string, string>(
                categoriesData.map((c) => [String(c.id), String(c.name)])
              );
            } else {
              console.error(categoriesRes?.error);
            }
          } catch (categoriesErr) {
            console.error(categoriesErr);
          }

          const transactionsRes = await withTimeout<any>(
            supabase
              .from('transactions')
              .select('*')
              .order('transaction_date', { ascending: false }),
            15000
          );

          if (transactionsRes?.error) throw transactionsRes.error;

          const txRows = transactionsRes?.data || [];

          const mapped: Transaction[] = txRows.map((t: any) => {
            const accountName = accountsById.get(String(t?.account_id)) || '';
            const categoryLabel =
              t?.type === 'transfer'
                ? 'Transfer'
                : categoriesById.get(String(t?.category_id)) || '';

            const rawDate = t?.transaction_date;
            const safeDate = rawDate ? String(rawDate) : '';

            return {
              id: String(t?.id ?? ''),
              account_id: String(t?.account_id ?? ''),
              transaction_date: safeDate,
              notes: String(t?.notes ?? ''),
              category: categoryLabel,
              amount: t?.amount,
              type: (t?.type ?? 'expense') as Transaction['type'],
              accounts: { name: accountName },
            };
          });

          setTransactions(mapped);
        } catch (transactionsErr) {
          console.error(transactionsErr);
          setTransactions([]);
        }
      })();
    } catch (error) {
      console.error(error);
      setErrorMessage('Gagal mengambil data dari Supabase.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fungsi hapus transaksi yang men-trigger Supabase dan refresh data
  const handleDeleteTransaction = async (id: string) => {
    if (!window.confirm('Hapus transaksi ini? Saldo Anda akan dikembalikan secara otomatis.')) return;
    try {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) throw error;
      toast.success('Transaksi berhasil dihapus');
      fetchData();
    } catch (err) {
      console.error('Error deleting transaction:', err);
      toast.error('Gagal menghapus transaksi');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const totalNetWorth = accounts.reduce((sum, account) => sum + toNumber(account.balance), 0);

  // Injeksi kepintaran AI agar tahu rincian setiap akun
  const accountContextRef = useRef('');
  const accountDetails = accounts.map(a => `- ${a.name} (${a.type}): ${formatCurrency(toNumber(a.balance))}`).join('\n');
  accountContextRef.current = [
    `Total saldo user saat ini: ${formatCurrency(totalNetWorth)}`,
    `Jumlah akun: ${accounts.length}`,
    `Rincian saldo per akun:`,
    accountDetails
  ].join('\n');

  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({
          accountContext: accountContextRef.current,
        }),
      }),
    []
  );

  const {
    messages: chatMessages,
    sendMessage,
    status: chatStatus,
    error: chatError,
    setMessages: setChatMessages,
  } = useChat({
    id: 'finance-dashboard-chat',
    transport: chatTransport,
    experimental_throttle: 50,
  });

  const chatBusy = chatStatus === 'streaming' || chatStatus === 'submitted';
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, chatStatus]);

  const transactionsInSelectedMonth = useMemo(
    () => transactions.filter((t) => transactionInYearMonth(t, selectedMonth)),
    [transactions, selectedMonth]
  );

  const monthlyIncome = useMemo(
    () =>
      transactionsInSelectedMonth
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + toNumber(t.amount), 0),
    [transactionsInSelectedMonth]
  );

  const monthlyExpense = useMemo(
    () =>
      transactionsInSelectedMonth
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + Math.abs(toNumber(t.amount)), 0),
    [transactionsInSelectedMonth]
  );

  const expenseChartLast6Months = useMemo(() => {
    const anchor = new Date();
    const buckets: { key: string; name: string; pengeluaran: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const name = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
      buckets.push({ key, name, pengeluaran: 0 });
    }
    const keySet = new Set(buckets.map((b) => b.key));
    for (const t of transactions) {
      if (t.type !== 'expense') continue;
      const td = parseTransactionDate(t);
      if (!td) continue;
      const key = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}`;
      if (!keySet.has(key)) continue;
      const b = buckets.find((x) => x.key === key);
      if (b) b.pengeluaran += Math.abs(toNumber(t.amount));
    }
    return buckets.map(({ name, pengeluaran }) => ({ name, pengeluaran }));
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactionsInSelectedMonth.filter((t) => {
      if (txFilter.type !== 'all' && t.type !== txFilter.type) return false;
      if (txFilter.accountId !== 'all' && t.account_id !== txFilter.accountId) return false;
      return true;
    });
  }, [transactionsInSelectedMonth, txFilter]);

  const isFilterActive = txFilter.type !== 'all' || txFilter.accountId !== 'all';

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '—';

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '—';

    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  };

  useEffect(() => {
    if (!showAIAssistant) return;
    if (chatMessages.length > 0) return;

    setChatMessages([
      {
        id: 'welcome',
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: '✨ Halo! Saya Asisten Keuangan Anda. Ada yang bisa saya bantu hari ini?',
          },
        ],
      },
    ]);
  }, [showAIAssistant, chatMessages.length, setChatMessages]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4">
            <Wallet className="h-12 w-12 text-emerald-400 mx-auto animate-pulse" />
          </div>
          <p className="text-xl font-semibold text-white mb-2">Loading...</p>
          <p className="text-sm text-gray-400">Mengambil data keuangan Anda</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-gray-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Personal Finance
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Ringkasan & transaksi mengikuti periode:{' '}
              <span className="font-mono text-cyan-400/90">{selectedMonthLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger
                className="h-9 w-[min(100vw-2rem,240px)] border-gray-700 bg-[#1A1A1A] text-left text-sm text-gray-200 hover:bg-[#252525]"
                aria-label="Pilih bulan laporan"
              >
                <Calendar className="mr-2 h-4 w-4 shrink-0 text-cyan-500/90" />
                <SelectValue placeholder="Bulan" />
              </SelectTrigger>
              <SelectContent className="max-h-[min(320px,70vh)] border-gray-800 bg-[#141414] text-gray-100">
                {monthOptions.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="focus:bg-white/10 focus:text-white"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-gray-700 bg-[#1A1A1A] text-gray-200 hover:bg-[#252525] hover:text-white"
              onClick={() =>
                downloadTransactionsCsv(
                  filteredTransactions,
                  `${selectedMonth}_${txFilter.type}_${txFilter.accountId}`
                )
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </header>

        <div className="mb-8">
          <Card className="border-gray-800 bg-gradient-to-br from-[#1A1A1A] to-[#0F0F0F]">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium uppercase tracking-wider text-gray-500">
                    Total Net Worth
                  </p>
                  <h2 className="mt-2 font-mono text-4xl font-bold tabular-nums tracking-tight text-white">
                    {errorMessage ? (
                      '—'
                    ) : accounts.length > 0 ? (
                      formatCurrency(totalNetWorth)
                    ) : (
                      'Belum ada data akun'
                    )}
                  </h2>
                  <p className="mt-2 text-xs text-gray-500">
                    Total bersih akun (real-time) · tidak tergantung periode di header
                  </p>
                </div>
                <div className="hidden sm:block">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-400/10">
                    <Wallet className="h-12 w-12 text-emerald-400" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            role="button"
            tabIndex={0}
            onClick={() => setTxFilter({ type: 'income', accountId: 'all' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTxFilter({ type: 'income', accountId: 'all' });
              }
            }}
            className={cn(
              'cursor-pointer border-gray-800 bg-[#1A1A1A] transition-all hover:border-emerald-500/35 hover:bg-[#1f1f1f]',
              txFilter.type === 'income' && txFilter.accountId === 'all' &&
                'border-emerald-500/50 ring-1 ring-emerald-500/30'
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-400/10">
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                </div>
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">
                Pemasukan
              </p>
              <p className="mt-0.5 text-[11px] text-gray-600">{selectedMonthLabel}</p>
              <p className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                {formatCurrency(monthlyIncome)}
              </p>
            </CardContent>
          </Card>

          <Card
            role="button"
            tabIndex={0}
            onClick={() => setTxFilter({ type: 'expense', accountId: 'all' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTxFilter({ type: 'expense', accountId: 'all' });
              }
            }}
            className={cn(
              'cursor-pointer border-gray-800 bg-[#1A1A1A] transition-all hover:border-red-500/35 hover:bg-[#1f1f1f]',
              txFilter.type === 'expense' && txFilter.accountId === 'all' &&
                'border-red-500/45 ring-1 ring-red-500/25'
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/20 bg-red-400/10">
                  <TrendingDown className="h-5 w-5 text-red-400" />
                </div>
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">
                Pengeluaran
              </p>
              <p className="mt-0.5 text-[11px] text-gray-600">{selectedMonthLabel}</p>
              <p className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                {formatCurrency(monthlyExpense)}
              </p>
            </CardContent>
          </Card>

          <Card
            role="button"
            tabIndex={0}
            onClick={() => setTxFilter({ type: 'all', accountId: 'all' })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTxFilter({ type: 'all', accountId: 'all' });
              }
            }}
            className={cn(
              'cursor-pointer border-gray-800 bg-[#1A1A1A] transition-all hover:border-cyan-500/35 hover:bg-[#1f1f1f]',
              !isFilterActive && 'border-cyan-500/30 ring-1 ring-cyan-500/20'
            )}
          >
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/20 bg-blue-400/10">
                  <Wallet className="h-5 w-5 text-cyan-400" />
                </div>
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">Total Akun</p>
              <p className="mt-1 font-mono text-xl font-bold tabular-nums text-white">{accounts.length} Akun</p>
            </CardContent>
          </Card>

          <Card className="border border-amber-500/15 bg-[#1A1A1A]">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-400/10">
                  <TrendingUp className="h-5 w-5 text-amber-400" />
                </div>
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">
                Saldo Bersih
              </p>
              <p className="mt-0.5 text-[11px] text-gray-600">{selectedMonthLabel}</p>
              <p className="mt-1 font-mono text-xl font-bold tabular-nums text-white">
                {formatCurrency(monthlyIncome - monthlyExpense)}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="mb-8">
          <Card className="border border-orange-500/25 bg-[#0f0f0f] shadow-[inset_0_1px_0_0_rgba(251,146,60,0.12)]">
            <CardHeader className="border-b border-white/[0.06] pb-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                    Tren pengeluaran
                  </CardTitle>
                  <p className="mt-1 text-xs text-gray-500">
                    Enam bulan terakhir · kumulatif pengeluaran (expense)
                  </p>
                </div>
                <span className="font-mono text-[11px] text-orange-400/80">IDR</span>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="h-[280px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart
                    data={expenseChartLast6Months}
                    margin={{ top: 12, right: 12, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="4 4" stroke="#27272a" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: '#a1a1aa', fontSize: 11 }}
                      axisLine={{ stroke: '#3f3f46' }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#a1a1aa', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => {
                        const n = Number(v);
                        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
                        if (n >= 1_000) return `${Math.round(n / 1_000)}rb`;
                        return String(n);
                      }}
                    />
                    <Tooltip
                      cursor={{ stroke: '#fb923c', strokeWidth: 1, strokeDasharray: '4 4' }}
                      contentStyle={{
                        backgroundColor: '#141414',
                        border: '1px solid rgba(251, 146, 60, 0.35)',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: '#e5e5e5' }}
                      formatter={(value) => {
                        const n = typeof value === 'number' ? value : Number(value);
                        return [formatCurrency(Number.isFinite(n) ? n : 0), 'Pengeluaran'];
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pengeluaran"
                      stroke="#fb923c"
                      strokeWidth={3}
                      dot={{ r: 4, fill: '#fb923c', stroke: '#0a0a0a', strokeWidth: 2 }}
                      activeDot={{ r: 6, fill: '#fdba74', stroke: '#0a0a0a', strokeWidth: 2 }}
                    />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mb-8 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card className="border-gray-800 bg-[#1A1A1A]">
              <CardHeader className="border-b border-gray-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-cyan-500/80" aria-hidden />
                      <CardTitle className="text-lg font-semibold tracking-tight text-white">
                        Transaksi
                      </CardTitle>
                    </div>
                    <span className="font-mono text-xs text-gray-500">{selectedMonthLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isFilterActive && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-red-400/90 hover:bg-red-950/40 hover:text-red-300"
                        onClick={() => setTxFilter({ type: 'all', accountId: 'all' })}
                      >
                        Reset filter
                      </Button>
                    )}
                    <span className="hidden text-xs text-gray-500 sm:inline">
                      <Filter className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                      Klik kartu ringkasan atau akun untuk menyaring
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-800">
                  {filteredTransactions.map((transaction) => {
                    const amount = toNumber(transaction.amount);
                    return (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between p-4 transition-colors hover:bg-[#252525]"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                              transaction.type === 'income'
                                ? 'bg-emerald-400/10'
                                : transaction.type === 'expense'
                                ? 'bg-red-400/10'
                                : 'bg-blue-400/10'
                            }`}
                          >
                            {transaction.type === 'income' ? (
                              <TrendingUp className="h-5 w-5 text-emerald-400" />
                            ) : transaction.type === 'expense' ? (
                              <TrendingDown className="h-5 w-5 text-red-400" />
                            ) : (
                              <ArrowRightLeft className="h-5 w-5 text-blue-400" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-white">{transaction?.notes ?? ''}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="border-gray-700 bg-[#0F0F0F] text-xs text-gray-400"
                              >
                                {transaction?.category ?? ''}
                              </Badge>
                              <span className="text-xs text-gray-500">{transaction.accounts?.name}</span>
                              <span className="text-xs text-gray-600">•</span>
                              <span className="text-xs text-gray-500">
                                {formatDate(transaction?.transaction_date)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right flex items-center gap-4">
                          <p
                            className={`font-mono text-lg font-semibold tabular-nums ${
                              amount >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {amount >= 0 ? '+' : ''}
                            {formatCurrency(amount)}
                          </p>
                          <button
                            onClick={() => handleDeleteTransaction(transaction.id)}
                            className="rounded-md p-2 text-gray-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                            title="Hapus transaksi"
                            aria-label="Hapus transaksi"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {filteredTransactions.length === 0 && (
                    <div className="px-4 py-10 text-center text-sm text-gray-500">
                      Tidak ada transaksi untuk filter ini.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card className="border-gray-800 bg-[#1A1A1A]">
              <CardHeader className="border-b border-gray-800">
                <CardTitle className="text-lg font-semibold text-white">Akun Saya</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {accounts.map((account) => {
                    const Icon = getAccountIcon(account.type);
                    const color = getAccountColor(account.type);
                    const accountSelected = txFilter.accountId === account.id;
                    return (
                      <div
                        key={account.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setTxFilter({ type: 'all', accountId: account.id })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setTxFilter({ type: 'all', accountId: account.id });
                          }
                        }}
                        className={cn(
                          'flex cursor-pointer items-center justify-between rounded-lg border bg-[#0F0F0F] p-4 transition-colors hover:bg-[#1A1A1A]',
                          accountSelected
                            ? 'border-cyan-500/45 ring-1 ring-cyan-500/25'
                            : 'border-gray-800 hover:border-gray-700'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-800">
                            <Icon className={`h-5 w-5 ${color}`} />
                          </div>
                          <div>
                            <p className="font-medium text-white">{account.name}</p>
                            <p className="text-xs text-gray-500">{account.type}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-semibold tabular-nums text-white">
                            {formatCurrency(toNumber(account.balance))}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 space-y-3">
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => {
                      setTransactionDialogInitialType('income');
                      setTransactionDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Tambah Transaksi Manual
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full border-gray-700 bg-[#0F0F0F] hover:bg-[#1A1A1A]"
                    onClick={() => {
                      setTransactionDialogInitialType('transfer');
                      setTransactionDialogOpen(true);
                    }}
                  >
                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                    Transfer Antar Akun
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowAIAssistant(!showAIAssistant)}
        className="group fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-cyan-500/30 bg-[#111] shadow-[0_0_0_1px_rgba(6,182,212,0.15)] shadow-lg shadow-black/60 transition-transform hover:scale-105 hover:border-cyan-400/50 hover:shadow-cyan-500/20"
        aria-label="Buka analitik AI"
      >
        <LineChart className="h-7 w-7 text-cyan-400 transition-colors group-hover:text-cyan-300" strokeWidth={2.25} />
      </button>

      {showAIAssistant && (
        <div className="fixed bottom-24 right-6 z-50 w-[min(100vw-3rem,26rem)] overflow-hidden rounded-2xl border border-cyan-500/20 bg-[#0d0d0d] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)] ring-1 ring-white/5">
          <div className="relative border-b border-white/[0.06] bg-gradient-to-r from-[#141414] via-[#101010] to-[#141414] px-4 py-3">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/35 bg-[#1a1a1a] shadow-inner">
                  <Terminal className="h-5 w-5 text-cyan-400" strokeWidth={2.25} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-white">
                    Terminal analitik
                  </h3>
                  <p className="text-[11px] text-gray-500">Gemini · stream</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAIAssistant(false)}
                className="h-8 w-8 shrink-0 rounded-lg p-0 text-gray-400 hover:bg-white/5 hover:text-white"
                aria-label="Tutup chat"
              >
                ✕
              </Button>
            </div>
          </div>

          <div className="flex h-[min(26rem,70vh)] flex-col p-4">
            <div
              ref={chatScrollRef}
              className="flex-1 space-y-4 overflow-y-auto pr-1"
            >
              {chatMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-2 text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl border border-cyan-500/25 bg-[#1a1a1a]">
                    <Activity className="h-7 w-7 text-cyan-400" strokeWidth={2} />
                  </div>
                  <p className="text-sm text-gray-300">Menghubungkan terminal…</p>
                  <p className="mt-1 text-xs text-gray-500">Query saldo, alokasi, dan arus kas.</p>
                </div>
              ) : (
                chatMessages.map((m, i) => {
                  const text = getMessageText(m);
                  const isUser = m.role === 'user';
                  const isLast = i === chatMessages.length - 1;
                  const showTypingCursor =
                    !isUser && isLast && chatBusy && chatStatus === 'streaming';

                  if (isUser) {
                    return (
                      <div key={m.id} className="flex justify-end">
                        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-gradient-to-br from-emerald-600/95 via-emerald-600/85 to-emerald-800/90 px-4 py-2.5 text-sm leading-relaxed text-white shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-400/20">
                          <p className="whitespace-pre-wrap">{renderBoldMarkdown(text, 'user')}</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={m.id} className="flex justify-start gap-2.5">
                      <div
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-500/20 bg-[#1f1f1f]"
                        aria-hidden
                      >
                        <LineChart className="h-4 w-4 text-cyan-400" strokeWidth={2.25} />
                      </div>
                      <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-[#2A2A2A] px-4 py-2.5 text-sm leading-relaxed text-gray-100 shadow-inner ring-1 ring-white/[0.06]">
                        <p className="whitespace-pre-wrap">
                          {renderBoldMarkdown(text, 'assistant')}
                          {showTypingCursor && (
                            <span
                              className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse rounded-sm bg-cyan-400 align-middle"
                              aria-hidden
                            />
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              {chatError && (
                <div className="rounded-xl border border-red-500/35 bg-red-950/50 px-3 py-2 text-xs text-red-100">
                  {chatError.message}
                </div>
              )}
            </div>

            <form
              className="mt-4 flex gap-2 border-t border-white/[0.06] pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = input.trim();
                if (!trimmed || chatBusy) return;
                setInput('');
                void sendMessage({ text: trimmed });
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Tulis pertanyaan…"
                disabled={chatBusy}
                className="flex-1 rounded-xl border-gray-700/80 bg-[#0c0c0c] text-gray-100 placeholder:text-gray-500 focus-visible:ring-emerald-500/30"
              />
              <Button
                type="submit"
                disabled={chatBusy || !input.trim()}
                className="shrink-0 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 px-5 text-white shadow-lg shadow-emerald-900/30 hover:from-emerald-500 hover:to-emerald-600"
              >
                {chatBusy ? '…' : 'Kirim'}
              </Button>
            </form>
          </div>
        </div>
      )}

      <TransactionDialog
        open={transactionDialogOpen}
        onOpenChange={setTransactionDialogOpen}
        initialType={transactionDialogInitialType}
        accounts={accounts}
        onSubmitted={() => fetchData()}
      />
    </div>
  );
}