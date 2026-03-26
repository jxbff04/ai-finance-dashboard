'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import {
  Wallet, TrendingUp, TrendingDown, Plus, ArrowRightLeft, Building2, Banknote, Smartphone, Coins, Calendar as CalendarIcon, Download, Filter, Trash2, LineChart, Lightbulb, PieChart as PieChartIcon, Target, Crosshair, AlertCircle, AlertTriangle
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import TransactionDialog from '@/components/transaction/TransactionDialog';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

interface Account { id: string; name: string; type: string; balance: string | number | null; currency?: string; }
interface Transaction { id: string; account_id: string; transaction_date: string; notes: string; category: string; amount: number | string; type: 'income' | 'expense' | 'transfer'; accounts: { name: string; }; }
interface Budget { id: string; category_name: string; amount: number; month: string; }
interface Goal { id: string; name: string; target_amount: number; current_amount: number; deadline: string; }
type TxFilter = { type: 'all' | 'income' | 'expense' | 'transfer'; accountId: 'all' | string; };

const PIE_COLORS = ['#06b6d4', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#ef4444', '#64748b'];

function renderBoldMarkdown(text: string, variant: 'user' | 'assistant'): ReactNode[] {
  const strongClass = variant === 'user' ? 'font-semibold text-emerald-50' : 'font-semibold text-white';
  const re = /\*\*([\s\S]+?)\*\*/g;
  const nodes: ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={`t-${k++}`}>{text.slice(last, m.index)}</span>);
    nodes.push(<strong key={`b-${k++}`} className={strongClass}>{m[1]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<span key={`t-${k++}`}>{text.slice(last)}</span>);
  return nodes.length > 0 ? nodes : [<span key="plain">{text}</span>];
}

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') { const n = Number(value); return Number.isFinite(n) ? n : 0; }
  return 0;
};

const withTimeout = async <T,>(promise: any, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`Request timeout after ${ms}ms`)), ms); });
    return await Promise.race([Promise.resolve(promise) as Promise<T>, timeoutPromise]);
  } finally { if (timer) clearTimeout(timer); }
};

const getAccountIcon = (type: string) => {
  const t = type.toUpperCase();
  if (t.includes('BANK')) return Building2; if (t.includes('CASH')) return Banknote; if (t.includes('E-WALLET') || t.includes('WALLET')) return Smartphone; if (t.includes('GOLD')) return Coins; return Wallet;
};
const getAccountColor = (type: string) => {
  const t = type.toUpperCase();
  if (t.includes('BANK')) return 'text-blue-400'; if (t.includes('CASH')) return 'text-emerald-400'; if (t.includes('E-WALLET') || t.includes('WALLET')) return 'text-cyan-400'; if (t.includes('GOLD')) return 'text-amber-400'; return 'text-gray-400';
};

const getMessageText = (message: any) => {
  let text = '';
  if (message.parts && message.parts.length > 0) { text = message.parts.filter((part: any) => part.type === 'text').map((part: any) => part.text).join(''); }
  if (!text && message.content) { text = message.content; }
  return text;
};

function getCurrentYearMonth(): string { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`; }
function parseTransactionDate(t: Transaction): Date | null { const d = new Date(t.transaction_date); return Number.isNaN(d.getTime()) ? null : d; }
function transactionInYearMonth(t: Transaction, yearMonth: string): boolean {
  const d = parseTransactionDate(t); if (!d) return false;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === yearMonth;
}
function buildMonthSelectOptions(monthsBack = 36) {
  const out = []; const n = new Date();
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(n.getFullYear(), n.getMonth() - i, 1);
    out.push({ value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) });
  }
  return out;
}
function formatYearMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number); if (!y || !m) return yearMonth;
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}
function escapeCsvField(value: string): string { const s = String(value ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadTransactionsCsv(rows: Transaction[], periodLabel: string) {
  const lines = [['tanggal', 'tipe', 'catatan', 'kategori', 'akun', 'nominal'].join(',')];
  for (const t of rows) lines.push([escapeCsvField(t.transaction_date), escapeCsvField(t.type), escapeCsvField(t.notes), escapeCsvField(t.category), escapeCsvField(t.accounts?.name ?? ''), escapeCsvField(String(toNumber(t.amount)))].join(','));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `transaksi_${periodLabel.replace(/[^\w\-]+/g, '_')}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

const isToday = (d: Date) => { const today = new Date(); return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear(); };
const isYesterday = (d: Date) => { const y = new Date(); y.setDate(y.getDate() - 1); return d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear(); };

const formatDateForGrouping = (dateString: string): string => {
  const date = new Date(dateString); if (Number.isNaN(date.getTime())) return 'Tanggal Tidak Valid';
  if (isToday(date)) return 'HARI INI';
  if (isYesterday(date)) return 'KEMARIN';
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
};

export default function Dashboard() {
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [transactionDialogInitialType, setTransactionDialogInitialType] = useState<Transaction['type']>('income');
  
  // States untuk Form Budget & Goals
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [newBudgetCategory, setNewBudgetCategory] = useState('');
  const [newBudgetAmount, setNewBudgetAmount] = useState('');
  
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState<Date>();

  // State untuk Delete Confirmation Modal
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; type: 'transaction' | 'budget' | 'goal' | null; id: string | null }>({ isOpen: false, type: null, id: null });
  const [isDeleting, setIsDeleting] = useState(false);

  const [input, setInput] = useState('');
  const [txFilter, setTxFilter] = useState<TxFilter>({ type: 'all', accountId: 'all' });
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentYearMonth);

  const monthOptions = useMemo(() => buildMonthSelectOptions(36), []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let accountsById = new Map<string, string>();
      const accountsRes = await withTimeout<any>(supabase.from('accounts').select('*').order('name', { ascending: true }), 15000);
      if (accountsRes.error) throw accountsRes.error;
      setAccounts(accountsRes.data || []);
      accountsById = new Map((accountsRes.data || []).map((a: any) => [String(a.id), String(a.name)]));

      let categoriesById = new Map<string, string>();
      const catRes = await withTimeout<any>(supabase.from('categories').select('id, name'), 15000);
      if (!catRes.error) categoriesById = new Map((catRes.data || []).map((c: any) => [String(c.id), String(c.name)]));

      const txRes = await withTimeout<any>(supabase.from('transactions').select('*').order('transaction_date', { ascending: false }), 15000);
      if (txRes.error) throw txRes.error;
      setTransactions((txRes.data || []).map((t: any) => ({
        id: String(t.id), account_id: String(t.account_id), transaction_date: String(t.transaction_date || ''), notes: String(t.notes || ''),
        category: t.type === 'transfer' ? 'Transfer' : categoriesById.get(String(t.category_id)) || 'Lain-lain', amount: t.amount, type: (t.type || 'expense') as Transaction['type'],
        accounts: { name: accountsById.get(String(t.account_id)) || '' },
      })));

      const budgetsRes = await supabase.from('budgets').select('*').eq('month', selectedMonth);
      if (budgetsRes.data) setBudgets(budgetsRes.data);

      const goalsRes = await supabase.from('goals').select('*').order('created_at', { ascending: false });
      if (goalsRes.data) setGoals(goalsRes.data);

    } catch (err) { console.error(err); toast.error('Gagal mengambil data'); } finally { setLoading(false); }
  }, [selectedMonth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // FUNGSI INISIASI HAPUS (Membuka Modal)
  const confirmDelete = (type: 'transaction' | 'budget' | 'goal', id: string) => {
    setDeleteConfirm({ isOpen: true, type, id });
  };

  // FUNGSI EKSEKUSI HAPUS PERMANEN
  const executeDelete = async () => {
    const { type, id } = deleteConfirm;
    if (!type || !id) return;
    
    setIsDeleting(true);
    try {
      let tableName = type === 'transaction' ? 'transactions' : type === 'budget' ? 'budgets' : 'goals';
      const { error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) throw error;
      
      toast.success(type === 'transaction' ? 'Transaksi dihapus' : type === 'budget' ? 'Anggaran dihapus' : 'Target dihapus');
      fetchData();
    } catch (err) {
      toast.error('Gagal menghapus data');
    } finally {
      setIsDeleting(false);
      setDeleteConfirm({ isOpen: false, type: null, id: null });
    }
  };

  const handleAddBudget = async () => {
    if (!newBudgetCategory || !newBudgetAmount) return toast.error('Isi semua kolom');
    try {
      const { error } = await supabase.from('budgets').insert({ category_name: newBudgetCategory, amount: Math.abs(Number(newBudgetAmount)), month: selectedMonth });
      if (error) throw error;
      toast.success('Budget berhasil ditambahkan'); setBudgetDialogOpen(false); fetchData();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAddGoal = async () => {
    if (!newGoalName || !newGoalTarget) return toast.error('Nama dan target wajib diisi');
    try {
      const { error } = await supabase.from('goals').insert({ 
        name: newGoalName, 
        target_amount: Math.abs(Number(newGoalTarget)), 
        deadline: newGoalDeadline ? format(newGoalDeadline, 'yyyy-MM-dd') : null 
      });
      if (error) throw error;
      toast.success('Target tabungan berhasil dibuat'); 
      setGoalDialogOpen(false); 
      setNewGoalDeadline(undefined);
      fetchData();
    } catch (err: any) { toast.error(err.message); }
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
  const totalNetWorth = accounts.reduce((sum, a) => sum + toNumber(a.balance), 0);

  const accountContextRef = useRef('');
  accountContextRef.current = [`Total saldo: ${formatCurrency(totalNetWorth)}`, `Akun: ${accounts.length}`, accounts.map(a => `- ${a.name}: ${formatCurrency(toNumber(a.balance))}`).join('\n')].join('\n');
  const chatTransport = useMemo(() => new DefaultChatTransport({ api: '/api/chat', body: () => ({ accountContext: accountContextRef.current }) }), []);
  const { messages: chatMessages, sendMessage, status: chatStatus, setMessages: setChatMessages } = useChat({ id: 'finance-chat', transport: chatTransport });
  const chatBusy = chatStatus === 'streaming' || chatStatus === 'submitted';
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const el = chatScrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [chatMessages, chatStatus]);
  useEffect(() => { if (showAIAssistant && chatMessages.length === 0) setChatMessages([{ id: 'w', role: 'assistant', parts: [{ type: 'text', text: '✨ Halo! Saya Asisten Keuangan Anda.' }] }]); }, [showAIAssistant, chatMessages.length, setChatMessages]);

  const transactionsInSelectedMonth = useMemo(() => transactions.filter(t => transactionInYearMonth(t, selectedMonth)), [transactions, selectedMonth]);
  const monthlyIncome = useMemo(() => transactionsInSelectedMonth.filter(t => t.type === 'income').reduce((s, t) => s + toNumber(t.amount), 0), [transactionsInSelectedMonth]);
  const monthlyExpense = useMemo(() => transactionsInSelectedMonth.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(toNumber(t.amount)), 0), [transactionsInSelectedMonth]);

  const filteredTransactions = useMemo(() => transactionsInSelectedMonth.filter(t => (txFilter.type === 'all' || t.type === txFilter.type) && (txFilter.accountId === 'all' || t.account_id === txFilter.accountId)), [transactionsInSelectedMonth, txFilter]);
  const isFilterActive = txFilter.type !== 'all' || txFilter.accountId !== 'all';

  const groupedTransactions = useMemo(() => {
    const groups: { [key: string]: Transaction[] } = {};
    for (const tx of filteredTransactions) {
      const d = new Date(tx.transaction_date);
      const dateKey = !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'invalid';
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(tx);
    }
    return Object.entries(groups).sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime());
  }, [filteredTransactions]);

  const expenseByCategory = useMemo(() => {
    const expenses = transactionsInSelectedMonth.filter(t => t.type === 'expense');
    const grouped = expenses.reduce((acc, tx) => {
      const cat = tx.category || 'Lain-lain';
      acc[cat] = (acc[cat] || 0) + Math.abs(toNumber(tx.amount));
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(grouped).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); 
  }, [transactionsInSelectedMonth]);

  const topExpenseCategory = expenseByCategory.length > 0 ? expenseByCategory[0] : null;

  if (loading) return <div className="min-h-screen bg-[#050505] flex items-center justify-center"><Wallet className="h-12 w-12 text-emerald-400 animate-pulse" /></div>;

  return (
    <div className="min-h-screen bg-black flex justify-center text-gray-100 font-sans selection:bg-cyan-500/30">
      
      <div className="w-full max-w-md bg-[#0A0A0A] min-h-screen relative flex flex-col shadow-2xl overflow-x-hidden border-x border-gray-900/50">
        
        <header className="sticky top-0 z-30 px-5 pt-8 pb-4 bg-[#0A0A0A]/95 backdrop-blur-md border-b border-gray-900 flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-500">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Finance</h1>
            <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">App Dashboard</p>
          </div>
          <div className="flex gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="h-9 w-[130px] border-gray-800 bg-[#141414] text-xs text-gray-200 rounded-xl transition-all hover:bg-gray-900">
                <CalendarIcon className="mr-2 h-3.5 w-3.5 text-cyan-500" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-gray-800 bg-[#141414] text-gray-100 rounded-xl">
                {monthOptions.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-9 w-9 border-gray-800 bg-[#141414] text-gray-400 rounded-xl transition-all hover:bg-gray-900 hover:text-cyan-400" onClick={() => downloadTransactionsCsv(filteredTransactions, selectedMonth)}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 pb-32 space-y-8">
          
          {/* KARTU SALDO */}
          <div className="bg-gradient-to-br from-[#1c1c1c] to-[#0f0f0f] border border-gray-800 rounded-3xl p-6 shadow-lg relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
            <div className="absolute top-0 right-0 p-6 opacity-10 transition-transform duration-700 hover:rotate-12 hover:scale-110"><Wallet className="w-24 h-24 text-white" /></div>
            <p className="text-xs font-medium uppercase tracking-widest text-gray-400 mb-1">Total Saldo</p>
            <h2 className="text-3xl font-bold tracking-tight text-white mb-6">{formatCurrency(totalNetWorth)}</h2>
            
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-800/50">
              <div 
                role="button" onClick={() => setTxFilter({ type: 'income', accountId: 'all' })}
                className={cn("transition-all duration-300 p-2 rounded-xl hover:-translate-y-1 hover:bg-[#2a2a2a]", txFilter.type === 'income' ? "bg-emerald-500/10 ring-1 ring-emerald-500/30" : "")}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="bg-emerald-500/20 p-1 rounded-md"><TrendingUp className="h-3 w-3 text-emerald-400" /></div>
                  <p className="text-[10px] text-gray-400 uppercase">Pemasukan</p>
                </div>
                <p className="text-sm font-bold text-white">{formatCurrency(monthlyIncome)}</p>
              </div>
              <div 
                role="button" onClick={() => setTxFilter({ type: 'expense', accountId: 'all' })}
                className={cn("transition-all duration-300 p-2 rounded-xl hover:-translate-y-1 hover:bg-[#2a2a2a]", txFilter.type === 'expense' ? "bg-red-500/10 ring-1 ring-red-500/30" : "")}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className="bg-red-500/20 p-1 rounded-md"><TrendingDown className="h-3 w-3 text-red-400" /></div>
                  <p className="text-[10px] text-gray-400 uppercase">Pengeluaran</p>
                </div>
                <p className="text-sm font-bold text-white">{formatCurrency(monthlyExpense)}</p>
              </div>
            </div>
          </div>

          {/* BUDGETING */}
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100 fill-mode-both">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400" /> Batas Anggaran
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setBudgetDialogOpen(true)} className="h-6 px-2 text-[10px] text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/30 rounded-full transition-colors">
                <Plus className="w-3 h-3 mr-1" /> Tambah
              </Button>
            </div>
            
            <div className="space-y-3">
              {budgets.length > 0 ? budgets.map(budget => {
                const spent = expenseByCategory.find(e => e.name.toLowerCase() === budget.category_name.toLowerCase())?.value || 0;
                const percentage = Math.min((spent / budget.amount) * 100, 100);
                const isOver = spent > budget.amount;
                
                return (
                  <div key={budget.id} className="group relative bg-[#141414] border border-gray-800 rounded-2xl p-4 shadow-sm transition-all hover:bg-[#1c1c1c] overflow-hidden">
                    <button onClick={() => confirmDelete('budget', budget.id)} className="absolute top-2 right-2 p-1.5 bg-red-500/10 text-red-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/20 z-10 translate-x-2 group-hover:translate-x-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex justify-between items-end mb-2 relative z-0">
                      <div>
                        <p className="text-xs font-semibold text-gray-300">{budget.category_name}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">Sisa: {formatCurrency(budget.amount - spent)}</p>
                      </div>
                      <p className={`text-sm font-bold ${isOver ? 'text-red-400' : 'text-emerald-400'} group-hover:mr-8 transition-all`}>
                        {formatCurrency(spent)} <span className="text-[10px] text-gray-500 font-normal">/ {formatCurrency(budget.amount)}</span>
                      </p>
                    </div>
                    <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden relative z-0">
                      <div className={`h-full rounded-full transition-all duration-1000 ${isOver ? 'bg-red-500' : percentage > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${percentage}%` }}></div>
                    </div>
                  </div>
                )
              }) : (
                <div className="p-4 border border-dashed border-gray-800 rounded-2xl text-center"><p className="text-xs text-gray-500">Belum ada anggaran bulan ini.</p></div>
              )}
            </div>
          </div>

          {/* GOALS */}
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150 fill-mode-both">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-400" /> Target Pencapaian
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setGoalDialogOpen(true)} className="h-6 px-2 text-[10px] text-cyan-400 hover:text-cyan-300 hover:bg-cyan-900/30 rounded-full transition-colors">
                <Plus className="w-3 h-3 mr-1" /> Tambah
              </Button>
            </div>
            
            <div className="flex overflow-x-auto gap-3 pb-4 snap-x scrollbar-hide -mx-5 px-5">
              {goals.length > 0 ? goals.map(goal => {
                const percentage = Math.min((toNumber(goal.current_amount) / toNumber(goal.target_amount)) * 100, 100);
                return (
                  <div key={goal.id} className="group relative shrink-0 w-[200px] snap-center bg-[#141414] border border-gray-800 rounded-2xl p-4 transition-all hover:bg-[#1c1c1c] hover:-translate-y-1">
                    <button onClick={() => confirmDelete('goal', goal.id)} className="absolute top-2 right-2 p-1.5 bg-red-500/10 text-red-400 rounded-lg opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500/20 translate-y-[-5px] group-hover:translate-y-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <p className="text-xs font-semibold text-white truncate mb-1 pr-6">{goal.name}</p>
                    <p className="text-[10px] text-gray-500 mb-3">{formatCurrency(toNumber(goal.current_amount))} / {formatCurrency(toNumber(goal.target_amount))}</p>
                    <div className="w-full bg-gray-800 h-1.5 rounded-full overflow-hidden mb-2">
                      <div className="h-full bg-amber-400 rounded-full transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                    </div>
                    <p className="text-[10px] font-bold text-right text-amber-400">{percentage.toFixed(0)}%</p>
                  </div>
                )
              }) : (
                <div className="w-full p-4 border border-dashed border-gray-800 rounded-2xl text-center"><p className="text-xs text-gray-500">Belum ada target tabungan.</p></div>
              )}
            </div>
          </div>

          {/* INSIGHT & GRAFIK */}
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200 fill-mode-both">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><PieChartIcon className="w-4 h-4 text-cyan-400" /> Analisis Pengeluaran</h3>
            </div>
            <div className="bg-[#141414] border border-gray-800 rounded-2xl p-4 shadow-sm">
              {expenseByCategory.length > 0 ? (
                <>
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={expenseByCategory} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                          {expenseByCategory.map((entry, index) => <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                        </Pie>
                        <RechartsTooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ backgroundColor: '#0A0A0A', borderColor: '#333', borderRadius: '12px', color: '#fff', fontSize: '12px' }} itemStyle={{ color: '#06b6d4' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {topExpenseCategory && (
                    <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex gap-3 items-start animate-in zoom-in duration-500">
                      <Lightbulb className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-100/80 leading-relaxed">Pengeluaran terbesarmu bulan ini ada di kategori <strong className="text-amber-400">{topExpenseCategory.name}</strong> sebesar <strong className="text-white">{formatCurrency(topExpenseCategory.value)}</strong>.</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="h-[100px] flex items-center justify-center text-xs text-gray-500">Belum ada data pengeluaran bulan ini.</div>
              )}
            </div>
          </div>

          {/* DAFTAR AKUN */}
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300 fill-mode-both">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">Daftar Akun</h3>
              <p className="text-[10px] text-gray-500">{accounts.length} Akun Aktif</p>
            </div>
            <div className="flex overflow-x-auto gap-3 pb-2 snap-x scrollbar-hide -mx-5 px-5">
              {accounts.map((acc) => {
                const Icon = getAccountIcon(acc.type); const color = getAccountColor(acc.type); const isSelected = txFilter.accountId === acc.id;
                return (
                  <div key={acc.id} onClick={() => setTxFilter({ type: 'all', accountId: acc.id })} className={cn('shrink-0 w-[140px] snap-center cursor-pointer rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-1', isSelected ? 'bg-[#1c1c1c] border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.15)]' : 'bg-[#141414] border-gray-800')}>
                    <div className="flex items-center gap-2 mb-3"><div className="p-2 rounded-lg bg-[#0A0A0A] border border-gray-800"><Icon className={`h-4 w-4 ${color}`} /></div><p className="text-[10px] text-gray-500 uppercase truncate">{acc.type}</p></div>
                    <p className="text-sm font-semibold text-white truncate mb-1">{acc.name}</p>
                    <p className="text-xs font-mono text-emerald-400">{formatCurrency(toNumber(acc.balance))}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* HISTORI TRANSAKSI */}
          <div className="animate-in fade-in slide-in-from-bottom-6 duration-700 delay-500 fill-mode-both">
            <div className="flex items-center justify-between mb-4 mt-2">
              <h3 className="text-sm font-bold text-white">Histori Transaksi</h3>
              {isFilterActive && (<Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-red-400 bg-red-400/10 rounded-full hover:bg-red-400/20 transition-colors" onClick={() => setTxFilter({ type: 'all', accountId: 'all' })}><Filter className="w-3 h-3 mr-1" /> Reset Filter</Button>)}
            </div>

            <div className="space-y-5">
              {groupedTransactions.map(([dateKey, txs]) => (
                <div key={dateKey} className="relative">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span>
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{formatDateForGrouping(dateKey)}</h4>
                  </div>
                  
                  <div className="space-y-3">
                    {txs.map((tx, index) => {
                      const amt = toNumber(tx.amount); const isInc = tx.type === 'income'; const isTrf = tx.type === 'transfer';
                      return (
                        <div key={tx.id} className="group flex items-center justify-between p-4 bg-[#141414] border border-gray-800/60 rounded-2xl transition-all duration-300 hover:bg-[#1c1c1c] hover:border-gray-700 hover:shadow-lg animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${index * 50}ms` }}>
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-110 ${isInc ? 'bg-emerald-400/10' : isTrf ? 'bg-blue-400/10' : 'bg-red-400/10'}`}>
                              {isInc ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : isTrf ? <ArrowRightLeft className="h-4 w-4 text-blue-400" /> : <TrendingDown className="h-4 w-4 text-red-400" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-100 truncate pr-2">{tx.notes || 'Transaksi'}</p>
                              <div className="mt-0.5 flex items-center gap-1"><span className="text-[10px] text-gray-500 truncate">{tx.category} • {tx.accounts?.name}</span></div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0 pl-2">
                            <p className={`font-mono text-sm font-bold whitespace-nowrap ${amt >= 0 ? 'text-emerald-400' : 'text-gray-100'}`}>{amt >= 0 ? '+' : ''}{formatCurrency(amt)}</p>
                            <button onClick={() => confirmDelete('transaction', tx.id)} className="text-gray-600 hover:text-red-400 p-1 -mr-1 transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {filteredTransactions.length === 0 && (<div className="py-10 text-center border border-dashed border-gray-800 rounded-2xl animate-in fade-in duration-500"><p className="text-xs text-gray-500">Belum ada transaksi di periode ini.</p></div>)}
            </div>
          </div>
        </div>

        {/* BOTTOM NAVIGATION */}
        <div className="absolute bottom-0 w-full bg-gradient-to-t from-[#050505] via-[#0A0A0A] to-transparent pt-12 pb-6 px-5 z-40 flex gap-3 animate-in slide-in-from-bottom-8 duration-500 delay-300 fill-mode-both">
          <Button onClick={() => setShowAIAssistant(true)} className="h-14 w-14 rounded-2xl bg-[#1c1c1c] border border-gray-800 text-cyan-400 shadow-xl shrink-0 transition-transform hover:scale-105 hover:bg-[#252525]"><LineChart className="h-6 w-6" /></Button>
          <Button className="h-14 flex-1 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-[0_8px_30px_rgba(5,150,105,0.3)] transition-all hover:shadow-[0_8px_40px_rgba(5,150,105,0.5)] hover:scale-[1.02]" onClick={() => { setTransactionDialogInitialType('expense'); setTransactionDialogOpen(true); }}>
            <Plus className="mr-2 h-5 w-5" /> Catat Transaksi
          </Button>
        </div>

        {/* AI CHAT MODAL */}
        {showAIAssistant && (
          <div className="absolute inset-0 z-50 bg-[#0A0A0A] flex flex-col animate-in fade-in slide-in-from-bottom-12 duration-300">
            <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-[#141414]">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span> AI Assistant</h3>
              <button onClick={() => setShowAIAssistant(false)} className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-gray-800 transition-colors">✕</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatScrollRef}>
              {chatMessages.map((m) => {
                const text = getMessageText(m);
                const mAny = m as any;
                const hasTool = mAny.toolInvocations && mAny.toolInvocations.length > 0;
                if (!text && !hasTool) return null;
                return (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-emerald-600 text-white rounded-br-sm' : 'bg-[#1c1c1c] text-gray-200 border border-gray-800 rounded-bl-sm shadow-md'}`}>
                      {text && <p className="whitespace-pre-wrap leading-relaxed">{renderBoldMarkdown(text, m.role as 'user' | 'assistant')}</p>}
                      {hasTool && mAny.toolInvocations?.map((tool: any) => (
                        <div key={tool.toolCallId} className="mt-1 flex flex-col gap-1">
                          {tool.state === 'result' ? (<span className="text-emerald-400 font-mono text-xs border-t border-gray-700 pt-2 mt-2 block animate-in fade-in">✅ {tool.result}</span>) : (<span className="text-cyan-400 font-mono text-xs animate-pulse border-t border-gray-700 pt-2 mt-2 block">⚙️ Mengeksekusi database...</span>)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <form className="p-4 bg-[#141414] border-t border-gray-800 flex gap-2 pb-8" onSubmit={(e) => { e.preventDefault(); if (input.trim() && !chatBusy) { sendMessage({ text: input }); setInput(''); } }}>
              <Input value={input} onChange={(e) => setInput(e.target.value)} disabled={chatBusy} className="h-12 bg-[#0A0A0A] border-gray-800 text-sm rounded-xl focus-visible:ring-cyan-500" placeholder="Ketik pesan..." />
              <Button type="submit" disabled={chatBusy || !input.trim()} className="h-12 w-12 bg-cyan-600 hover:bg-cyan-500 rounded-xl shrink-0 transition-colors"><ArrowRightLeft className="h-5 w-5" /></Button>
            </form>
          </div>
        )}

        {/* POP-UP KONFIRMASI HAPUS (NEW) */}
        <Dialog open={deleteConfirm.isOpen} onOpenChange={(isOpen) => setDeleteConfirm(prev => ({ ...prev, isOpen }))}>
          <DialogContent className="sm:max-w-[400px] bg-[#0A0A0A] border-gray-800 text-white shadow-2xl rounded-2xl p-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center animate-in zoom-in duration-300">
                <AlertTriangle className="h-6 w-6 text-red-500" />
              </div>
              <DialogHeader className="space-y-2">
                <DialogTitle className="text-lg font-bold text-white text-center">Konfirmasi Hapus Data</DialogTitle>
                <DialogDescription className="text-sm text-gray-400 text-center">
                  {deleteConfirm.type === 'transaction' && "Apakah Anda yakin ingin menghapus riwayat transaksi ini? Saldo dompet Anda akan dikalkulasi ulang."}
                  {deleteConfirm.type === 'budget' && "Apakah Anda yakin ingin menghapus batas anggaran ini? Riwayat pengeluaran yang telah terjadi akan tetap tersimpan."}
                  {deleteConfirm.type === 'goal' && "Apakah Anda yakin ingin menghapus target pencapaian tabungan ini?"}
                  <br /><br />
                  <span className="font-medium text-red-400/80">Tindakan ini permanen dan tidak dapat dibatalkan.</span>
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-3 w-full pt-2">
                <Button variant="ghost" className="flex-1 bg-[#141414] border border-gray-800 text-gray-300 hover:bg-[#1c1c1c] hover:text-white" onClick={() => setDeleteConfirm({ isOpen: false, type: null, id: null })}>
                  Batal
                </Button>
                <Button onClick={executeDelete} disabled={isDeleting} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors">
                  {isDeleting ? 'Menghapus...' : 'Hapus Permanen'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* MODAL TAMBAH BUDGET */}
        <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
          <DialogContent className="sm:max-w-[425px] bg-[#0A0A0A] border-gray-800 text-white">
            <DialogHeader><DialogTitle>Tambah Batas Anggaran</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Nama Kategori (Misal: Makanan)</label>
                <Input value={newBudgetCategory} onChange={(e) => setNewBudgetCategory(e.target.value)} className="bg-[#141414] border-gray-700 text-white focus-visible:ring-cyan-500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Batas Maksimal (Rp)</label>
                <Input type="number" value={newBudgetAmount} onChange={(e) => setNewBudgetAmount(e.target.value)} className="bg-[#141414] border-gray-700 text-white focus-visible:ring-cyan-500" />
              </div>
              <Button onClick={handleAddBudget} className="w-full bg-cyan-600 hover:bg-cyan-500">Simpan Anggaran</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* MODAL TAMBAH GOAL */}
        <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
          <DialogContent className="sm:max-w-[425px] bg-[#0A0A0A] border-gray-800 text-white">
            <DialogHeader><DialogTitle>Buat Target Tabungan Baru</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Nama Target (Misal: Beli Laptop)</label>
                <Input value={newGoalName} onChange={(e) => setNewGoalName(e.target.value)} className="bg-[#141414] border-gray-700 text-white focus-visible:ring-cyan-500" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Target Uang (Rp)</label>
                <Input type="number" value={newGoalTarget} onChange={(e) => setNewGoalTarget(e.target.value)} className="bg-[#141414] border-gray-700 text-white focus-visible:ring-cyan-500" />
              </div>
              <div className="space-y-1 flex flex-col">
                <label className="text-xs font-semibold text-gray-400 mb-1">Tenggat Waktu (Opsional)</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal bg-[#141414] border-gray-700 hover:bg-[#1c1c1c] hover:text-white transition-all", !newGoalDeadline && "text-gray-500")}>
                      <CalendarIcon className="mr-2 h-4 w-4 text-cyan-500" />
                      {newGoalDeadline ? format(newGoalDeadline, "PPP", { locale: idLocale }) : <span>Pilih tanggal tenggat...</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-[#0A0A0A] border-gray-800 text-white shadow-2xl" align="start">
                    <Calendar mode="single" selected={newGoalDeadline} onSelect={setNewGoalDeadline} initialFocus className="bg-[#0A0A0A] text-white rounded-lg border border-gray-800" />
                  </PopoverContent>
                </Popover>
              </div>
              <Button onClick={handleAddGoal} className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold">Buat Target</Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
      <TransactionDialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen} initialType={transactionDialogInitialType} accounts={accounts} onSubmitted={() => fetchData()} />
    </div>
  );
}