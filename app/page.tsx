'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  TrendingUp, TrendingDown, Plus, ArrowRightLeft, Building2, Banknote, Smartphone, Coins, Calendar as CalendarIcon, Download, Filter, Trash2, MessageSquare, AlertTriangle, Loader2, Moon, Sun
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea'; // TAMBAHAN IMPORT TEXTAREA
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

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';

interface Account { id: string; name: string; type: string; balance: string | number | null; currency?: string; }
interface Transaction { id: string; account_id: string; transaction_date: string; notes: string; category: string; amount: number | string; type: 'income' | 'expense' | 'transfer'; accounts: { name: string; }; }
interface Budget { id: string; category_name: string; amount: number; month: string; }
interface Goal { id: string; name: string; target_amount: number; current_amount: number; deadline: string; }
type TxFilter = { type: 'all' | 'income' | 'expense' | 'transfer'; accountId: 'all' | string; };

const PIE_COLORS = ['#000000', '#333333', '#666666', '#999999', '#cccccc', '#0f172a', '#334155'];

function renderBoldMarkdown(text: string, variant: 'user' | 'assistant'): ReactNode[] {
  const strongClass = 'font-bold';
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
  if (t.includes('BANK')) return Building2; if (t.includes('CASH')) return Banknote; if (t.includes('E-WALLET') || t.includes('WALLET')) return Smartphone; if (t.includes('GOLD')) return Coins; return Banknote;
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
  const date = new Date(dateString); if (Number.isNaN(date.getTime())) return 'INVALID';
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
};

export default function Dashboard() {
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [transactionDialogInitialType, setTransactionDialogInitialType] = useState<Transaction['type']>('expense');
  
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [newBudgetCategory, setNewBudgetCategory] = useState('');
  const [newBudgetAmount, setNewBudgetAmount] = useState('');
  
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState<Date>();

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; type: 'transaction' | 'budget' | 'goal' | null; id: string | null }>({ isOpen: false, type: null, id: null });
  const [isDeleting, setIsDeleting] = useState(false);

  const [input, setInput] = useState('');
  const [txFilter, setTxFilter] = useState<TxFilter>({ type: 'all', accountId: 'all' });
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentYearMonth);

  const monthOptions = useMemo(() => buildMonthSelectOptions(36), []);

  useEffect(() => {
    if (isDarkMode) { document.documentElement.classList.add('dark'); } 
    else { document.documentElement.classList.remove('dark'); }
  }, [isDarkMode]);

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
        category: t.type === 'transfer' ? 'Transfer' : categoriesById.get(String(t.category_id)) || 'Uncategorized', amount: t.amount, type: (t.type || 'expense') as Transaction['type'],
        accounts: { name: accountsById.get(String(t.account_id)) || '' },
      })));

      const budgetsRes = await supabase.from('budgets').select('*').eq('month', selectedMonth);
      if (budgetsRes.data) setBudgets(budgetsRes.data);

      const goalsRes = await supabase.from('goals').select('*').order('created_at', { ascending: false });
      if (goalsRes.data) setGoals(goalsRes.data);

    } catch (err) { console.error(err); toast.error('Failed to load data'); } finally { setLoading(false); }
  }, [selectedMonth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const confirmDelete = (type: 'transaction' | 'budget' | 'goal', id: string) => { setDeleteConfirm({ isOpen: true, type, id }); };
  const executeDelete = async () => {
    const { type, id } = deleteConfirm;
    if (!type || !id) return;
    setIsDeleting(true);
    try {
      let tableName = type === 'transaction' ? 'transactions' : type === 'budget' ? 'budgets' : 'goals';
      const { error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) throw error;
      toast.success('Data deleted successfully');
      fetchData();
    } catch (err) { toast.error('Failed to delete data'); } 
    finally { setIsDeleting(false); setDeleteConfirm({ isOpen: false, type: null, id: null }); }
  };

  const handleAddBudget = async () => {
    if (!newBudgetCategory || !newBudgetAmount) return toast.error('Fill all fields');
    try {
      const { error } = await supabase.from('budgets').insert({ category_name: newBudgetCategory, amount: Math.abs(Number(newBudgetAmount)), month: selectedMonth });
      if (error) throw error;
      toast.success('Budget added'); setBudgetDialogOpen(false); fetchData();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAddGoal = async () => {
    if (!newGoalName || !newGoalTarget) return toast.error('Name and target required');
    try {
      const { error } = await supabase.from('goals').insert({ name: newGoalName, target_amount: Math.abs(Number(newGoalTarget)), deadline: newGoalDeadline ? format(newGoalDeadline, 'yyyy-MM-dd') : null });
      if (error) throw error;
      toast.success('Goal created'); setGoalDialogOpen(false); setNewGoalDeadline(undefined); fetchData();
    } catch (err: any) { toast.error(err.message); }
  };

  const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'decimal', minimumFractionDigits: 0 }).format(amount);
  const totalNetWorth = accounts.reduce((sum, a) => sum + toNumber(a.balance), 0);

  const accountContextRef = useRef('');
  accountContextRef.current = [`Total balance: ${formatCurrency(totalNetWorth)}`, `Accounts: ${accounts.length}`, accounts.map(a => `- ${a.name}: ${formatCurrency(toNumber(a.balance))}`).join('\n')].join('\n');
  const chatTransport = useMemo(() => new DefaultChatTransport({ api: '/api/chat', body: () => ({ accountContext: accountContextRef.current }) }), []);
  const { messages: chatMessages, sendMessage, status: chatStatus, setMessages: setChatMessages } = useChat({ id: 'finance-chat', transport: chatTransport });
  const chatBusy = chatStatus === 'streaming' || chatStatus === 'submitted';
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const el = chatScrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [chatMessages, chatStatus]);
  useEffect(() => { if (showAIAssistant && chatMessages.length === 0) setChatMessages([{ id: 'w', role: 'assistant', parts: [{ type: 'text', text: 'Good day. I am ready to process your transaction records.' }] }]); }, [showAIAssistant, chatMessages.length, setChatMessages]);

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
      const cat = tx.category || 'Others';
      acc[cat] = (acc[cat] || 0) + Math.abs(toNumber(tx.amount));
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(grouped).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); 
  }, [transactionsInSelectedMonth]);

  if (loading) return <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center"><Loader2 className="h-6 w-6 text-black dark:text-white animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#f3f4f6] dark:bg-[#050505] flex justify-center text-black dark:text-gray-100 font-sans transition-colors duration-300 selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black">
      
      <div className="w-full max-w-md bg-white dark:bg-[#0a0a0a] min-h-screen relative flex flex-col border-x border-gray-300 dark:border-gray-800 overflow-x-hidden shadow-sm transition-colors duration-300">
        
        {/* HEADER */}
        <header className="sticky top-0 z-30 bg-black dark:bg-[#000000] flex flex-col transition-colors duration-300">
          <div className="px-5 pt-6 pb-4 flex items-center justify-between">
            <h1 className="text-3xl font-sans font-bold tracking-tighter text-white leading-none">
              Finance
            </h1>
            <div className="flex gap-2 items-center">
              <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-1.5 rounded-full text-white hover:bg-gray-800 transition-colors">
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <Button variant="outline" size="sm" onClick={() => downloadTransactionsCsv(filteredTransactions, selectedMonth)} className="h-7 bg-transparent border-white text-white text-[10px] font-bold rounded-none hover:bg-white hover:text-black uppercase transition-colors">
                <Download className="w-3 h-3 mr-1" /> CSV
              </Button>
              <Button size="sm" onClick={() => { setTransactionDialogInitialType('expense'); setTransactionDialogOpen(true); }} className="h-7 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-none border-0 uppercase transition-colors">
                + New Entry
              </Button>
            </div>
          </div>
          
          {/* TICKER TAPE BAR */}
          <div className="bg-white dark:bg-[#050505] border-b border-gray-300 dark:border-gray-800 px-5 py-2 flex items-center overflow-x-auto scrollbar-hide gap-3 shadow-sm transition-colors duration-300">
             <div className="flex gap-2 shrink-0 items-center">
               <span className="bg-black dark:bg-white dark:text-black text-white px-2 py-0.5 text-[10px] font-bold transition-colors duration-300">NET WORTH</span>
               <span className="text-[10px] font-bold text-black dark:text-white transition-colors duration-300">{formatCurrency(totalNetWorth)}</span>
             </div>
             <div className="flex gap-2 shrink-0 items-center ml-1">
               <span className="bg-green-600 text-white px-2 py-0.5 text-[10px] font-bold flex items-center">INFLOW <TrendingUp className="w-3 h-3 ml-1" /></span>
               <span className="text-[10px] font-bold text-black dark:text-white transition-colors duration-300">{formatCurrency(monthlyIncome)}</span>
             </div>
             <div className="flex gap-2 shrink-0 items-center ml-1">
               <span className="bg-[#cc0000] text-white px-2 py-0.5 text-[10px] font-bold flex items-center">OUTFLOW <TrendingDown className="w-3 h-3 ml-1" /></span>
               <span className="text-[10px] font-bold text-black dark:text-white transition-colors duration-300 pr-4">{formatCurrency(monthlyExpense)}</span>
             </div>
          </div>

          {/* SECONDARY NAV / FILTER */}
          <div className="bg-white dark:bg-[#050505] px-5 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-800 transition-colors duration-300">
            <div className="flex gap-4 text-xs font-medium text-gray-800 dark:text-gray-400">
              <span className="cursor-pointer hover:text-black dark:hover:text-white border-b border-black dark:border-white pb-1 transition-colors duration-300">Overview</span>
            </div>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="h-6 w-auto border-0 shadow-none bg-transparent text-xs font-bold text-black dark:text-white p-0 focus:ring-0 focus:ring-offset-0 transition-colors duration-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-gray-300 dark:border-gray-800 bg-white dark:bg-[#0a0a0a] text-black dark:text-white rounded-none">
                {monthOptions.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 pb-32 space-y-10">
          
          <div className="border-b border-black dark:border-gray-700 pb-2 animate-in fade-in slide-in-from-bottom-2 duration-500 transition-colors duration-300">
             <h2 className="text-4xl font-serif font-black tracking-tight text-black dark:text-white mb-1 transition-colors duration-300">Markets</h2>
             <div className="flex gap-4 text-xs font-medium text-gray-600 dark:text-gray-400 mt-4 transition-colors duration-300">
               <span className="text-black dark:text-white font-bold transition-colors duration-300">Portfolios</span>
               <span>Budgets</span>
               <span>Targets</span>
             </div>
          </div>

          {/* PORTFOLIOS */}
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
            <div className="grid grid-cols-2 gap-4">
              {accounts.map((acc) => {
                const isSelected = txFilter.accountId === acc.id;
                return (
                  <div key={acc.id} onClick={() => setTxFilter({ type: 'all', accountId: acc.id })} className={cn('cursor-pointer border-t border-b py-3 transition-all duration-300', isSelected ? 'border-black dark:border-white bg-gray-50 dark:bg-gray-900' : 'border-gray-200 dark:border-gray-800 hover:border-black dark:hover:border-gray-500')}>
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">{acc.type}</p>
                    <p className="text-sm font-serif font-bold text-black dark:text-white truncate leading-tight mb-2 transition-colors duration-300">{acc.name}</p>
                    <p className="text-xs font-bold text-black dark:text-gray-200 transition-colors duration-300">{formatCurrency(toNumber(acc.balance))}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* BUDGETING */}
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
            <div className="flex items-center justify-between mb-4 border-b border-black dark:border-gray-700 pb-1 transition-colors duration-300">
              <h3 className="text-lg font-serif font-bold text-black dark:text-white transition-colors duration-300">Spending Limits</h3>
              <button onClick={() => setBudgetDialogOpen(true)} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors duration-300">Add Limit</button>
            </div>
            <div className="space-y-4">
              {budgets.length > 0 ? budgets.map(budget => {
                const spent = expenseByCategory.find(e => e.name.toLowerCase() === budget.category_name.toLowerCase())?.value || 0;
                const percentage = Math.min((spent / budget.amount) * 100, 100);
                const isOver = spent > budget.amount;
                return (
                  <div key={budget.id} className="group relative border-b border-gray-200 dark:border-gray-800 pb-3 transition-colors duration-300">
                    <button onClick={() => confirmDelete('budget', budget.id)} className="absolute top-0 right-0 text-red-500/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-[#0a0a0a] pl-2"><Trash2 className="w-3.5 h-3.5" /></button>
                    <div className="flex justify-between items-end mb-2">
                      <p className="text-sm font-serif font-bold text-black dark:text-white capitalize transition-colors duration-300">{budget.category_name}</p>
                      <p className={`text-xs font-bold ${isOver ? 'text-[#cc0000] dark:text-red-400' : 'text-gray-800 dark:text-gray-300'} transition-colors duration-300`}>{formatCurrency(spent)} <span className="text-gray-400 dark:text-gray-500 font-normal">/ {formatCurrency(budget.amount)}</span></p>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 h-1.5 overflow-hidden transition-colors duration-300">
                      <div className={`h-full transition-all duration-1000 ${isOver ? 'bg-[#cc0000] dark:bg-red-500' : percentage > 80 ? 'bg-orange-500' : 'bg-green-600 dark:bg-green-500'}`} style={{ width: `${percentage}%` }}></div>
                    </div>
                  </div>
                )
              }) : (<p className="text-sm text-gray-500 italic">No spending limits set.</p>)}
            </div>
          </div>

          {/* GOALS */}
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
            <div className="flex items-center justify-between mb-4 border-b border-black dark:border-gray-700 pb-1 transition-colors duration-300">
              <h3 className="text-lg font-serif font-bold text-black dark:text-white transition-colors duration-300">Financial Targets</h3>
              <button onClick={() => setGoalDialogOpen(true)} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors duration-300">Add Target</button>
            </div>
            <div className="space-y-4">
              {goals.length > 0 ? goals.map(goal => {
                const percentage = Math.min((toNumber(goal.current_amount) / toNumber(goal.target_amount)) * 100, 100);
                return (
                  <div key={goal.id} className="group relative border-b border-gray-200 dark:border-gray-800 pb-3 transition-colors duration-300">
                    <button onClick={() => confirmDelete('goal', goal.id)} className="absolute top-0 right-0 text-red-500/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-[#0a0a0a] pl-2"><Trash2 className="w-3.5 h-3.5" /></button>
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-sm font-serif font-bold text-black dark:text-white capitalize pr-6 transition-colors duration-300">{goal.name}</p>
                      <p className="text-xs font-bold text-gray-800 dark:text-gray-300 transition-colors duration-300">{percentage.toFixed(0)}%</p>
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide transition-colors duration-300">{formatCurrency(toNumber(goal.current_amount))} of {formatCurrency(toNumber(goal.target_amount))}</p>
                    <div className="w-full bg-gray-100 dark:bg-gray-800 h-1.5 overflow-hidden transition-colors duration-300">
                      <div className="h-full bg-black dark:bg-white transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                    </div>
                  </div>
                )
              }) : (<p className="text-sm text-gray-500 italic">No targets set.</p>)}
            </div>
          </div>

          {/* TRANSACTION FEED */}
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
            <div className="flex items-center justify-between mb-4 border-b border-black dark:border-gray-700 pb-1 transition-colors duration-300">
              <h3 className="text-lg font-serif font-bold text-black dark:text-white transition-colors duration-300">Latest Transactions</h3>
              {isFilterActive && (<button className="text-[10px] font-bold text-gray-500 hover:text-black dark:hover:text-white uppercase transition-colors duration-300" onClick={() => setTxFilter({ type: 'all', accountId: 'all' })}>Clear Filter</button>)}
            </div>

            <div className="space-y-6">
              {groupedTransactions.map(([dateKey, txs]) => (
                <div key={dateKey}>
                  <h4 className="text-xs font-bold text-black dark:text-gray-300 mb-3 border-b border-gray-200 dark:border-gray-800 pb-1 transition-colors duration-300">{formatDateForGrouping(dateKey)}</h4>
                  <div className="space-y-3">
                    {txs.map((tx) => {
                      const amt = toNumber(tx.amount); const isInc = tx.type === 'income';
                      return (
                        <div key={tx.id} className="group flex items-start justify-between hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors -mx-2 px-2 py-1">
                          <div className="min-w-0 flex-1 pr-3">
                            <p className="text-sm font-serif font-bold text-black dark:text-white truncate transition-colors duration-300">{tx.notes || 'Unnamed Transaction'}</p>
                            <p className="text-[10px] font-medium text-gray-500 uppercase mt-0.5">{tx.category} • {tx.accounts?.name}</p>
                          </div>
                          <div className="flex flex-col items-end shrink-0">
                            <p className={`font-sans text-sm font-bold transition-colors duration-300 ${isInc ? 'text-green-600 dark:text-green-500' : 'text-black dark:text-white'}`}>{isInc ? '+' : ''}{formatCurrency(amt)}</p>
                            <button onClick={() => confirmDelete('transaction', tx.id)} className="text-[10px] font-bold text-[#cc0000] dark:text-red-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Remove</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {filteredTransactions.length === 0 && (<p className="text-sm text-gray-500 italic">No transactions found for this period.</p>)}
            </div>
          </div>
        </div>

        {/* BOTTOM FLOATING AI BUTTON */}
        <div className="fixed bottom-6 right-1/2 translate-x-32 sm:translate-x-44 z-40">
           <Button onClick={() => setShowAIAssistant(true)} className="h-14 w-14 rounded-full bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 shadow-2xl flex items-center justify-center border-2 border-white dark:border-gray-900 transition-colors duration-300">
             <MessageSquare className="h-6 w-6" />
           </Button>
        </div>

        {/* AI CHAT MODAL - DENGAN TEXTAREA MULTILINE */}
        {showAIAssistant && (
          <>
            <div className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" onClick={() => setShowAIAssistant(false)}></div>
            <div className="absolute bottom-0 left-0 right-0 h-[85vh] z-50 bg-white dark:bg-[#0a0a0a] border-t border-gray-300 dark:border-gray-800 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.3)] animate-in slide-in-from-bottom duration-300 transition-colors duration-300">
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-black transition-colors duration-300">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></div>
                  <h3 className="text-sm font-serif font-bold text-black dark:text-white transition-colors duration-300">Financial Assistant</h3>
                </div>
                <button onClick={() => setShowAIAssistant(false)} className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors duration-300">Close</button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-white dark:bg-[#0a0a0a] transition-colors duration-300" ref={chatScrollRef}>
                {chatMessages.map((m) => {
                  const text = getMessageText(m);
                  const mAny = m as any;
                  const hasTool = mAny.toolInvocations && mAny.toolInvocations.length > 0;
                  if (!text && !hasTool) return null;
                  return (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed transition-colors duration-300 ${m.role === 'user' ? 'bg-black dark:bg-white text-white dark:text-black rounded-l-lg rounded-tr-lg' : 'bg-gray-100 dark:bg-[#111] text-black dark:text-gray-200 border border-gray-200 dark:border-gray-800 rounded-r-lg rounded-tl-lg font-serif'}`}>
                        {text && <p className="whitespace-pre-wrap">{renderBoldMarkdown(text, m.role as 'user' | 'assistant')}</p>}
                        {hasTool && mAny.toolInvocations?.map((tool: any) => (
                          <div key={tool.toolCallId} className="mt-3 flex flex-col gap-1 border-t border-gray-300 dark:border-gray-700 pt-3 transition-colors duration-300">
                            {tool.state === 'result' ? (<span className="text-green-700 dark:text-green-500 font-bold text-xs flex items-center gap-1">✓ Saved to Database</span>) : (<span className="text-blue-600 dark:text-blue-400 font-bold text-xs flex items-center gap-2 animate-pulse"><Loader2 className="w-3 h-3 animate-spin"/> Processing Request...</span>)}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {chatStatus === 'submitted' && (
                  <div className="flex justify-start animate-in fade-in duration-300">
                    <div className="bg-gray-100 dark:bg-[#111] px-4 py-3 rounded-r-lg rounded-tl-lg border border-gray-200 dark:border-gray-800 flex items-center gap-2 transition-colors duration-300">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  </div>
                )}
              </div>
              <form className="p-3 bg-white dark:bg-[#0a0a0a] border-t border-gray-200 dark:border-gray-800 flex gap-2 items-end transition-colors duration-300" onSubmit={(e) => { e.preventDefault(); if (input.trim() && !chatBusy) { sendMessage({ text: input }); setInput(''); } }}>
                <Textarea 
                  value={input} 
                  onChange={(e) => setInput(e.target.value)} 
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (input.trim() && !chatBusy) { sendMessage({ text: input }); setInput(''); }
                    }
                  }}
                  disabled={chatBusy} 
                  className="min-h-[44px] max-h-[120px] py-3 bg-gray-50 dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white placeholder:text-gray-400 font-serif transition-colors duration-300 resize-none" 
                  placeholder="Ask a question or log data (Shift+Enter for new line)..." 
                />
                <Button type="submit" disabled={chatBusy || !input.trim()} className="h-11 px-5 bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black rounded-none font-bold shrink-0 transition-colors duration-300">Send</Button>
              </form>
            </div>
          </>
        )}

        {/* POP-UP KONFIRMASI HAPUS */}
        <Dialog open={deleteConfirm.isOpen} onOpenChange={(isOpen) => setDeleteConfirm(prev => ({ ...prev, isOpen }))}>
          <DialogContent className="sm:max-w-[350px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none p-6 shadow-xl transition-colors duration-300">
            <div className="space-y-4">
              <DialogHeader><DialogTitle className="text-xl font-serif font-black text-black dark:text-white border-b border-black dark:border-white pb-3 transition-colors duration-300">Confirm Delete</DialogTitle>
                <DialogDescription className="text-sm text-gray-600 dark:text-gray-400 pt-3 font-medium transition-colors duration-300">Are you sure you want to permanently delete this record? This action cannot be undone.</DialogDescription>
              </DialogHeader>
              <div className="flex gap-3 w-full pt-4">
                <Button variant="outline" className="flex-1 rounded-none border-gray-300 dark:border-gray-700 text-black dark:text-white font-bold hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors duration-300" onClick={() => setDeleteConfirm({ isOpen: false, type: null, id: null })}>Cancel</Button>
                <Button onClick={executeDelete} disabled={isDeleting} className="flex-1 rounded-none bg-[#cc0000] dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-700 text-white font-bold transition-colors duration-300">{isDeleting ? 'Deleting...' : 'Delete'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* MODAL TAMBAH BUDGET */}
        <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
          <DialogContent className="sm:max-w-[350px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none shadow-xl transition-colors duration-300">
            <DialogHeader><DialogTitle className="text-xl font-serif font-black border-b border-black dark:border-white pb-3 transition-colors duration-300">New Spending Limit</DialogTitle></DialogHeader>
            <div className="space-y-5 pt-3">
              <div className="space-y-1.5"><label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Category</label><Input value={newBudgetCategory} onChange={(e) => setNewBudgetCategory(e.target.value)} className="bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300" /></div>
              <div className="space-y-1.5"><label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Amount (IDR)</label><Input type="number" value={newBudgetAmount} onChange={(e) => setNewBudgetAmount(e.target.value)} className="bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300" /></div>
              <Button onClick={handleAddBudget} className="w-full rounded-none bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black font-bold mt-2 transition-colors duration-300">Save Limit</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* MODAL TAMBAH GOAL */}
        <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
          <DialogContent className="sm:max-w-[350px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none shadow-xl transition-colors duration-300">
            <DialogHeader><DialogTitle className="text-xl font-serif font-black border-b border-black dark:border-white pb-3 transition-colors duration-300">New Target</DialogTitle></DialogHeader>
            <div className="space-y-5 pt-3">
              <div className="space-y-1.5"><label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Target Name</label><Input value={newGoalName} onChange={(e) => setNewGoalName(e.target.value)} className="bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300" /></div>
              <div className="space-y-1.5"><label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Amount (IDR)</label><Input type="number" value={newGoalTarget} onChange={(e) => setNewGoalTarget(e.target.value)} className="bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300" /></div>
              <div className="space-y-1.5 flex flex-col">
                <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Deadline</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white rounded-none hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors duration-300", !newGoalDeadline && "text-gray-500 dark:text-gray-400")}>
                      <CalendarIcon className="mr-2 h-4 w-4 text-black dark:text-white" />
                      {newGoalDeadline ? <span className="text-sm font-medium text-black dark:text-white">{format(newGoalDeadline, "PPP", { locale: idLocale })}</span> : <span className="text-sm">Select Date</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 rounded-none shadow-xl transition-colors duration-300" align="start">
                    <Calendar mode="single" selected={newGoalDeadline} onSelect={setNewGoalDeadline} initialFocus className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white" />
                  </PopoverContent>
                </Popover>
              </div>
              <Button onClick={handleAddGoal} className="w-full rounded-none bg-blue-600 hover:bg-blue-700 text-white font-bold mt-2 transition-colors duration-300">Create Target</Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
      <TransactionDialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen} initialType={transactionDialogInitialType} accounts={accounts} onSubmitted={() => fetchData()} />
    </div>
  );
}