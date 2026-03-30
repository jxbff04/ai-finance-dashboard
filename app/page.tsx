'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  TrendingUp, TrendingDown, Trash2, MessageSquare, Loader2, Moon, Sun, Pencil, RefreshCw, PlusCircle, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
interface InvestmentAsset { id: string; symbol: string; units: number; }

type TxFilter = { type: 'all' | 'income' | 'expense' | 'transfer'; accountId: 'all' | string; };
type ActiveTab = 'Portfolios' | 'Budgets' | 'Targets' | 'Assets';

const PIE_COLORS = ['#333333', '#666666', '#999999', '#cccccc', '#f5f5f5', '#1a1a1a'];

// CSS Hack class untuk menghilangkan panah input number
const NO_SPINNER_CLASS = "[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]";

function renderBoldMarkdown(text: string): ReactNode[] {
  const re = /\*\*([\s\S]+?)\*\*/g; const nodes: ReactNode[] = []; let last = 0; let m; let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<span key={`t-${k++}`}>{text.slice(last, m.index)}</span>);
    nodes.push(<strong key={`b-${k++}`} className="font-bold">{m[1]}</strong>);
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
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('Portfolios');
  
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // States untuk Assets
  const [myAssets, setMyAssets] = useState<InvestmentAsset[]>([]);
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const [editAssetOpen, setEditAssetOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<InvestmentAsset | null>(null);
  const [assetSymbol, setAssetSymbol] = useState('');
  const [assetUnits, setAssetUnits] = useState('');
  
  const [transactionDialogOpen, setTransactionDialogOpen] = useState(false);
  const [transactionDialogInitialType, setTransactionDialogInitialType] = useState<Transaction['type']>('expense');
  
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [newBudgetCategory, setNewBudgetCategory] = useState('');
  const [newBudgetAmount, setNewBudgetAmount] = useState('');
  
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [newGoalName, setNewGoalName] = useState('');
  const [newGoalTarget, setNewGoalTarget] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState<Date>();

  const [editBalanceOpen, setEditBalanceOpen] = useState(false);
  const [fundGoalOpen, setFundGoalOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [inputValue, setInputValue] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; type: 'transaction' | 'budget' | 'goal' | 'asset' | null; id: string | null }>({ isOpen: false, type: null, id: null });
  const [isDeleting, setIsDeleting] = useState(false);

  const [input, setInput] = useState('');
  const [txFilter, setTxFilter] = useState<TxFilter>({ type: 'all', accountId: 'all' });
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentYearMonth);

  const monthOptions = useMemo(() => buildMonthSelectOptions(36), []);

  useEffect(() => {
    if (isDarkMode) { document.documentElement.classList.add('dark'); } 
    else { document.documentElement.classList.remove('dark'); }
  }, [isDarkMode]);

  // Load Assets dari Local Storage
  useEffect(() => {
    const savedAssets = localStorage.getItem('blackjack_assets');
    if (savedAssets) setMyAssets(JSON.parse(savedAssets));
  }, []);

  // Polling Harga API
  const fetchPrices = useCallback(async () => {
    if (myAssets.length === 0) return;
    try {
      const symbols = myAssets.map(a => a.symbol).join(',');
      const res = await fetch(`/api/prices?symbols=${symbols}`);
      const data = await res.json();
      setAssetPrices(data);
    } catch (e) { console.error('Failed to fetch prices'); }
  }, [myAssets]);

  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 15000); // Sinkronisasi setiap 15 detik
    return () => clearInterval(interval);
  }, [fetchPrices]);

  const fetchData = useCallback(async (showSpin = true) => {
    if(showSpin) setLoading(true);
    setIsRefreshing(true);
    fetchPrices();
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

    } catch (err) { console.error(err); toast.error('Failed to load data'); } 
    finally { setLoading(false); setTimeout(() => setIsRefreshing(false), 500); }
  }, [selectedMonth, fetchPrices]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // LOGIC ACTIONS
  const handleUpdateBalance = async () => {
    if (!selectedAccount || inputValue === '') return toast.error('Amount is required');
    try {
      const { error } = await supabase.from('accounts').update({ balance: Number(inputValue) }).eq('id', selectedAccount.id);
      if (error) throw error;
      toast.success(`Balance updated`); setEditBalanceOpen(false); fetchData(false);
    } catch (err) { toast.error('Failed to update balance'); }
  };

  const handleFundGoal = async () => {
    if (!selectedGoal || inputValue === '') return toast.error('Amount is required');
    try {
      const newAmt = Number(selectedGoal.current_amount) + Number(inputValue);
      const { error } = await supabase.from('goals').update({ current_amount: newAmt }).eq('id', selectedGoal.id);
      if (error) throw error;
      toast.success('Funds added successfully'); setFundGoalOpen(false); fetchData(false);
    } catch (err) { toast.error('Failed to add funds'); }
  };

  const handleAddAsset = () => {
    if (!assetSymbol || !assetUnits) return toast.error('Fill all fields');
    const newAsset = { id: Date.now().toString(), symbol: assetSymbol.toUpperCase(), units: Number(assetUnits) };
    const updatedAssets = [...myAssets, newAsset];
    setMyAssets(updatedAssets);
    localStorage.setItem('blackjack_assets', JSON.stringify(updatedAssets));
    setAssetDialogOpen(false); setAssetSymbol(''); setAssetUnits(''); toast.success('Asset tracked!');
    fetchPrices();
  };

  const handleEditAsset = () => {
    if (!selectedAsset || !assetUnits) return toast.error('Units are required');
    const updatedAssets = myAssets.map(a => a.id === selectedAsset.id ? { ...a, symbol: assetSymbol.toUpperCase(), units: Number(assetUnits) } : a);
    setMyAssets(updatedAssets);
    localStorage.setItem('blackjack_assets', JSON.stringify(updatedAssets));
    setEditAssetOpen(false); setSelectedAsset(null); toast.success('Asset updated!');
    fetchPrices();
  };

  const confirmDelete = (type: 'transaction' | 'budget' | 'goal' | 'asset', id: string) => { setDeleteConfirm({ isOpen: true, type, id }); };
  
  const executeDelete = async () => {
    const { type, id } = deleteConfirm;
    if (!type || !id) return;
    setIsDeleting(true);
    try {
      if (type === 'asset') {
        const updated = myAssets.filter(a => a.id !== id);
        setMyAssets(updated); localStorage.setItem('blackjack_assets', JSON.stringify(updated));
      } else {
        const { error } = await supabase.from(type === 'transaction' ? 'transactions' : type === 'budget' ? 'budgets' : 'goals').delete().eq('id', id);
        if (error) throw error;
      }
      toast.success('Data deleted'); fetchData(false);
    } catch (err) { toast.error('Deletion failed'); } 
    finally { setIsDeleting(false); setDeleteConfirm({ isOpen: false, type: null, id: null }); }
  };

  const handleAddBudget = async () => {
    if (!newBudgetCategory || !newBudgetAmount) return toast.error('Fill all fields');
    try {
      const { error } = await supabase.from('budgets').insert({ category_name: newBudgetCategory, amount: Math.abs(Number(newBudgetAmount)), month: selectedMonth });
      if (error) throw error;
      toast.success('Budget added'); setBudgetDialogOpen(false); fetchData(false);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAddGoal = async () => {
    if (!newGoalName || !newGoalTarget) return toast.error('Name and target required');
    try {
      const { error } = await supabase.from('goals').insert({ name: newGoalName, target_amount: Math.abs(Number(newGoalTarget)), deadline: newGoalDeadline ? format(newGoalDeadline, 'yyyy-MM-dd') : null });
      if (error) throw error;
      toast.success('Goal created'); setGoalDialogOpen(false); setNewGoalDeadline(undefined); fetchData(false);
    } catch (err: any) { toast.error(err.message); }
  };

  // CALCULATIONS
  const formatCurrency = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'decimal', minimumFractionDigits: 0 }).format(amount);
  
  const totalLiquidNetWorth = accounts.reduce((sum, a) => sum + toNumber(a.balance), 0);
  const totalInvestments = myAssets.reduce((sum, a) => sum + (a.units * (assetPrices[a.symbol] || 0)), 0);
  const grandTotalAssets = totalLiquidNetWorth + totalInvestments;

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

  const assetChartData = useMemo(() => {
    return myAssets.map(a => ({ name: a.symbol, value: a.units * (assetPrices[a.symbol] || 0) })).filter(a => a.value > 0).sort((a, b) => b.value - a.value);
  }, [myAssets, assetPrices]);

  const chatTransport = useMemo(() => new DefaultChatTransport({ api: '/api/chat', body: () => ({ accountContext: `Liquid Balance: ${totalLiquidNetWorth}, Investments: ${totalInvestments}` }) }), [totalLiquidNetWorth, totalInvestments]);
  const { messages: chatMessages, sendMessage, status: chatStatus, setMessages: setChatMessages } = useChat({ id: 'finance-chat', transport: chatTransport });
  const chatBusy = chatStatus === 'streaming' || chatStatus === 'submitted';
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatScrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages, chatStatus, showAIAssistant]);
  
  if (loading) return <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center"><Loader2 className="h-6 w-6 text-black dark:text-white animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#f3f4f6] dark:bg-[#050505] flex justify-center text-black dark:text-gray-100 font-sans transition-colors duration-300 selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black">
      
      <div className="w-full max-w-md bg-white dark:bg-[#0a0a0a] min-h-screen relative flex flex-col border-x border-gray-300 dark:border-gray-800 overflow-x-hidden shadow-sm transition-colors duration-300">
        
        {/* HEADER */}
        <header className="sticky top-0 z-30 bg-black dark:bg-[#000000] flex flex-col transition-colors duration-300">
          <div className="px-5 pt-6 pb-4 flex items-center justify-between">
            <h1 className="text-3xl font-sans font-bold tracking-tighter text-white leading-none">
              Blackjack
            </h1>
            <div className="flex gap-3 items-center">
              <button onClick={() => fetchData(false)} className={cn("p-1.5 rounded-full text-white hover:bg-gray-800 transition-all", isRefreshing && "animate-spin")}>
                <RefreshCw className="w-4 h-4" />
              </button>
              <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-1.5 rounded-full text-white hover:bg-gray-800 transition-colors">
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <Button size="sm" onClick={() => { setTransactionDialogInitialType('expense'); setTransactionDialogOpen(true); }} className="h-7 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-none border-0 uppercase transition-colors">
                + New Entry
              </Button>
            </div>
          </div>
          
          {/* TICKER TAPE BAR - TOTAL ASSETS */}
          <div className="bg-white dark:bg-[#050505] border-b border-gray-300 dark:border-gray-800 px-5 py-2 flex items-center overflow-x-auto scrollbar-hide gap-3 shadow-sm transition-colors duration-300">
             <div className="flex gap-2 shrink-0 items-center">
               <span className="bg-black dark:bg-white dark:text-black text-white px-2 py-0.5 text-[10px] font-bold transition-colors duration-300">TOTAL ASSETS</span>
               <span className="text-[10px] font-bold text-black dark:text-white transition-colors duration-300">{formatCurrency(grandTotalAssets)}</span>
             </div>
             <div className="flex gap-2 shrink-0 items-center ml-1">
               <span className="bg-blue-600 text-white px-2 py-0.5 text-[10px] font-bold transition-colors duration-300">INVESTMENTS</span>
               <span className="text-[10px] font-bold text-black dark:text-white transition-colors duration-300">{formatCurrency(totalInvestments)}</span>
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

          <div className="bg-white dark:bg-[#050505] px-5 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-800 transition-colors duration-300">
            <div className="flex gap-4 text-xs font-medium text-gray-800 dark:text-gray-400 uppercase tracking-wider">
              Terminal Overview
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
             <div className="flex gap-5 text-xs font-medium text-gray-600 dark:text-gray-400 mt-4 transition-colors duration-300 overflow-x-auto pb-1">
               {['Portfolios', 'Budgets', 'Targets', 'Assets'].map((tab) => (
                 <span key={tab} onClick={() => setActiveTab(tab as ActiveTab)} className={cn("cursor-pointer pb-1 border-b-2 whitespace-nowrap uppercase transition-all duration-300", activeTab === tab ? "border-black dark:border-white text-black dark:text-white font-bold" : "border-transparent hover:text-black dark:hover:text-white")}>{tab}</span>
               ))}
             </div>
          </div>

          {/* TAB 1: PORTFOLIOS */}
          {activeTab === 'Portfolios' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
              <div className="grid grid-cols-2 gap-4">
                {accounts.map((acc) => {
                  const isSelected = txFilter.accountId === acc.id;
                  return (
                    <div key={acc.id} onClick={() => setTxFilter({ type: 'all', accountId: acc.id })} className={cn('cursor-pointer border-t border-b py-3 transition-all duration-300 relative group', isSelected ? 'border-black dark:border-white bg-gray-50 dark:bg-gray-900' : 'border-gray-200 dark:border-gray-800 hover:border-black dark:hover:border-gray-500')}>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">{acc.type}</p>
                      <p className="text-sm font-serif font-bold text-black dark:text-white truncate leading-tight mb-2 transition-colors duration-300">{acc.name}</p>
                      <div className="flex justify-between items-center">
                        <p className="text-xs font-bold text-black dark:text-gray-200 transition-colors duration-300">{formatCurrency(toNumber(acc.balance))}</p>
                        <button onClick={(e) => { e.stopPropagation(); setSelectedAccount(acc); setInputValue(String(toNumber(acc.balance))); setEditBalanceOpen(true); }} className="text-gray-400 hover:text-blue-600 transition-colors">
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: BUDGETS */}
          {activeTab === 'Budgets' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150">
              <div className="flex items-center justify-between mb-4 border-b border-black dark:border-gray-700 pb-1 transition-colors duration-300">
                <h3 className="text-lg font-serif font-bold text-black dark:text-white transition-colors duration-300">Spending Limits</h3>
                <button onClick={() => setBudgetDialogOpen(true)} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors duration-300 uppercase">+ Add Limit</button>
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
          )}

          {/* TAB 3: TARGETS */}
          {activeTab === 'Targets' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200">
              <div className="flex items-center justify-between mb-4 border-b border-black dark:border-gray-700 pb-1 transition-colors duration-300">
                <h3 className="text-lg font-serif font-bold text-black dark:text-white transition-colors duration-300">Financial Targets</h3>
                <button onClick={() => setGoalDialogOpen(true)} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors duration-300 uppercase">+ New Target</button>
              </div>
              <div className="space-y-4">
                {goals.length > 0 ? goals.map(goal => {
                  const percentage = Math.min((toNumber(goal.current_amount) / toNumber(goal.target_amount)) * 100, 100);
                  return (
                    <div key={goal.id} className="group relative border border-gray-200 dark:border-gray-800 p-3 transition-colors duration-300">
                      <div className="flex justify-between items-center mb-2 border-b border-gray-100 dark:border-gray-800 pb-2">
                        <p className="text-sm font-serif font-bold text-black dark:text-white capitalize pr-6 transition-colors duration-300">{goal.name}</p>
                        <div className="flex items-center gap-3">
                          <button onClick={() => { setSelectedGoal(goal); setInputValue(''); setFundGoalOpen(true); }} className="text-gray-500 hover:text-blue-600 flex items-center gap-1 text-[10px] font-bold uppercase transition-colors"><PlusCircle className="w-3 h-3"/> Fund</button>
                          <button onClick={() => confirmDelete('goal', goal.id)} className="text-red-500/50 hover:text-red-500 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                      <div className="flex justify-between items-end mb-1">
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide transition-colors duration-300">{formatCurrency(toNumber(goal.current_amount))} of {formatCurrency(toNumber(goal.target_amount))}</p>
                        <p className="text-xs font-bold text-gray-800 dark:text-gray-300 transition-colors duration-300">{percentage.toFixed(0)}%</p>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 h-1.5 overflow-hidden transition-colors duration-300">
                        <div className="h-full bg-black dark:bg-white transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                      </div>
                    </div>
                  )
                }) : (<p className="text-sm text-gray-500 italic">No targets set.</p>)}
              </div>
            </div>
          )}

          {/* TAB 4: ASSETS (Pie Chart + Real Time Tracking) */}
          {activeTab === 'Assets' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100">
              <div className="flex items-center justify-between mb-4 border-b border-black dark:border-gray-700 pb-1 transition-colors duration-300">
                <h3 className="text-lg font-serif font-bold text-black dark:text-white transition-colors duration-300">Investment Assets</h3>
                <button onClick={() => setAssetDialogOpen(true)} className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors duration-300 uppercase">+ Add Asset</button>
              </div>

              {assetChartData.length > 0 ? (
                <>
                  <div className="h-[250px] w-full bg-white dark:bg-[#111] border border-gray-200 dark:border-gray-800 p-4 mb-6 transition-colors duration-300">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={assetChartData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value" stroke="none">
                          {assetChartData.map((entry, index) => <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                        </Pie>
                        <RechartsTooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ backgroundColor: isDarkMode ? '#0a0a0a' : '#fff', borderColor: isDarkMode ? '#333' : '#eee', borderRadius: '0', color: isDarkMode ? '#fff' : '#000', fontSize: '12px' }} />
                        <Legend iconType="square" wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="space-y-3">
                    {myAssets.map(asset => {
                      const price = assetPrices[asset.symbol] || 0;
                      const value = asset.units * price;
                      return (
                        <div key={asset.id} className="group flex justify-between items-center p-4 border border-gray-200 dark:border-gray-800 hover:border-black dark:hover:border-gray-500 transition-colors duration-300">
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-2">
                               <button onClick={() => { setSelectedAsset(asset); setAssetSymbol(asset.symbol); setAssetUnits(String(asset.units)); setEditAssetOpen(true); }} className="text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="w-3.5 h-3.5" /></button>
                               <button onClick={() => confirmDelete('asset', asset.id)} className="text-red-500/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                            <div>
                              <p className="text-sm font-bold text-black dark:text-white uppercase transition-colors duration-300">{asset.symbol}</p>
                              <p className="text-[10px] text-gray-500 uppercase">{asset.units} Units @ {formatCurrency(price)}/unit</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-mono font-bold text-black dark:text-white transition-colors duration-300">{formatCurrency(value)}</p>
                          </div>
                        </div>
                      )
                    })}
                    <p className="text-[9px] text-gray-500 text-center mt-4 uppercase tracking-widest">Pricing data sourced from Yahoo Finance API (Auto-Converted to IDR)</p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500 italic text-center py-10">No assets tracked. Add your global stocks, crypto, or gold (e.g. BBCA.JK, AAPL, BTC-USD, GC=F) to monitor real-time values.</p>
              )}
            </div>
          )}

          {/* TRANSACTION FEED (Sembunyikan saat di tab Assets agar fokus) */}
          {activeTab !== 'Assets' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300">
              <div className="flex items-center justify-between mb-4 border-b border-black dark:border-gray-700 pb-1 transition-colors duration-300 mt-10">
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
                              <button onClick={() => confirmDelete('transaction', tx.id)} className="text-[10px] font-bold text-[#cc0000] dark:text-red-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity uppercase">Delete</button>
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
          )}
        </div>

        {/* FLOATING AI BUTTON */}
        <div className="fixed bottom-6 right-6 sm:right-auto sm:translate-x-44 z-40">
           <Button onClick={() => setShowAIAssistant(true)} className="h-14 w-14 rounded-none bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 shadow-2xl border border-gray-700 dark:border-gray-200 transition-colors duration-300">
             <MessageSquare className="h-6 w-6" />
           </Button>
        </div>

        {/* AI CHAT MODAL - FIXED FOCUS & AUTO-SCROLL (Masalah #2) */}
        {showAIAssistant && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm sm:p-4">
            <div className="w-full max-w-md mx-auto h-[90dvh] sm:h-[85dvh] bg-white dark:bg-[#0a0a0a] border border-gray-300 dark:border-gray-800 flex flex-col shadow-2xl transition-colors duration-300">
              
              {/* Header Chat */}
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center shrink-0 bg-gray-50 dark:bg-black transition-colors duration-300">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-600 animate-pulse"></div>
                  <h3 className="text-sm font-serif font-bold text-black dark:text-white transition-colors duration-300 uppercase">BLACKJACK AI</h3>
                </div>
                <button onClick={() => setShowAIAssistant(false)} className="text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors duration-300 uppercase">Close</button>
              </div>
              
              {/* Area Pesan Chat */}
              <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-white dark:bg-[#0a0a0a] transition-colors duration-300">
                {chatMessages.map((m) => {
                  const text = getMessageText(m);
                  const mAny = m as any;
                  const hasTool = mAny.toolInvocations && mAny.toolInvocations.length > 0;
                  if (!text && !hasTool) return null;
                  return (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed transition-colors duration-300 ${m.role === 'user' ? 'bg-black dark:bg-white text-white dark:text-black rounded-none' : 'bg-gray-100 dark:bg-[#111] text-black dark:text-gray-200 border border-gray-200 dark:border-gray-800 rounded-none font-serif'}`}>
                        {text && <p className="whitespace-pre-wrap">{renderBoldMarkdown(text, m.role as 'user' | 'assistant')}</p>}
                        {hasTool && mAny.toolInvocations?.map((tool: any) => (
                          <div key={tool.toolCallId} className="mt-3 flex flex-col gap-1 border-t border-gray-300 dark:border-gray-700 pt-3 transition-colors duration-300">
                            {tool.state === 'result' ? (<span className="text-green-700 dark:text-green-500 font-bold text-[10px] uppercase flex items-center gap-1">✓ Database Synced</span>) : (<span className="text-blue-600 dark:text-blue-400 font-bold text-[10px] uppercase flex items-center gap-2 animate-pulse"><Loader2 className="w-3 h-3 animate-spin"/> Executing...</span>)}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {chatStatus === 'submitted' && (
                  <div className="flex justify-start animate-in fade-in duration-300">
                    <div className="bg-gray-100 dark:bg-[#111] px-4 py-3 rounded-none border border-gray-200 dark:border-gray-800 flex items-center gap-2 transition-colors duration-300">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  </div>
                )}
                {/* Penanda Akhir Scroll */}
                <div ref={chatScrollRef} className="h-1"></div>
              </div>
              
              {/* Form Input Chat */}
              <form className="p-3 bg-white dark:bg-[#0a0a0a] border-t border-gray-200 dark:border-gray-800 flex gap-2 shrink-0 transition-colors duration-300" onSubmit={(e) => { e.preventDefault(); if (input.trim() && !chatBusy) { sendMessage({ text: input }); setInput(''); } }}>
                <Textarea 
                  autoFocus
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
                  placeholder="Enter command (Shift+Enter for new line)..." 
                />
                <Button type="submit" disabled={chatBusy || !input.trim()} className="h-11 px-6 bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black rounded-none font-bold uppercase shrink-0 transition-colors duration-300">Send</Button>
              </form>
            </div>
          </div>
        )}

        {/* MODAL INPUT ANGKA (Edit Balance / Fund Target) dengan Spinner Dihilangkan */}
        <Dialog open={editBalanceOpen || fundGoalOpen} onOpenChange={(isOpen) => { setEditBalanceOpen(isOpen); setFundGoalOpen(isOpen); }}>
          <DialogContent className="sm:max-w-[350px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none p-6 shadow-xl transition-colors duration-300">
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="text-xl font-serif font-black text-black dark:text-white border-b border-black dark:border-white pb-3 transition-colors duration-300 uppercase">
                  {editBalanceOpen ? 'Update Balance' : 'Add Funds'}
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-600 dark:text-gray-400 pt-3 font-medium transition-colors duration-300">
                  {editBalanceOpen ? `Set exact balance for ${selectedAccount?.name}` : `Top up progress for ${selectedGoal?.name}`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Amount (IDR)</label>
                {/* CSS hack disematkan ke className */}
                <Input type="number" autoFocus value={inputValue} onChange={(e) => setInputValue(e.target.value)} className={cn("bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300", NO_SPINNER_CLASS)} />
              </div>
              <div className="flex gap-3 w-full pt-4">
                <Button variant="outline" className="flex-1 rounded-none border-gray-300 dark:border-gray-700 text-black dark:text-white font-bold hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors duration-300" onClick={() => { setEditBalanceOpen(false); setFundGoalOpen(false); }}>Cancel</Button>
                <Button onClick={editBalanceOpen ? handleUpdateBalance : handleFundGoal} className="flex-1 rounded-none bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors duration-300 uppercase">{editBalanceOpen ? 'Update' : 'Add'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal Tambah & Edit Aset Investasi */}
        <Dialog open={assetDialogOpen || editAssetOpen} onOpenChange={(isOpen) => { setAssetDialogOpen(isOpen); setEditAssetOpen(isOpen); }}>
          <DialogContent className="sm:max-w-[350px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none p-6 shadow-xl transition-colors duration-300">
            <DialogHeader>
              <DialogTitle className="text-xl font-serif font-black text-black dark:text-white border-b border-black dark:border-white pb-3 transition-colors duration-300 uppercase">
                {editAssetOpen ? 'Update Asset' : 'Track Asset'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Ticker Symbol (Yahoo Finance)</label>
                <Input placeholder="e.g., BBCA.JK, AAPL, BTC-USD" value={assetSymbol} onChange={(e) => setAssetSymbol(e.target.value)} className="bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white uppercase" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Number of Units Owned</label>
                <Input type="number" placeholder="e.g., 100 or 0.5" value={assetUnits} onChange={(e) => setAssetUnits(e.target.value)} className={cn("bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white", NO_SPINNER_CLASS)} />
              </div>
              <div className="flex gap-3 w-full pt-4">
                <Button variant="outline" className="flex-1 rounded-none border-gray-300 dark:border-gray-700 text-black dark:text-white font-bold hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors duration-300" onClick={() => { setAssetDialogOpen(false); setEditAssetOpen(false); }}>Cancel</Button>
                <Button onClick={editAssetOpen ? handleEditAsset : handleAddAsset} className="flex-1 rounded-none bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase">{editAssetOpen ? 'Update' : 'Track'}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* POP-UP KONFIRMASI HAPUS */}
        <Dialog open={deleteConfirm.isOpen} onOpenChange={(isOpen) => setDeleteConfirm(prev => ({ ...prev, isOpen }))}>
          <DialogContent className="sm:max-w-[350px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none p-6 shadow-xl transition-colors duration-300">
            <div className="space-y-4">
              <DialogHeader><DialogTitle className="text-xl font-serif font-black text-black dark:text-white border-b border-black dark:border-white pb-3 transition-colors duration-300 uppercase">Confirm</DialogTitle></DialogHeader>
              <div className="flex gap-3 w-full pt-4">
                <Button variant="outline" className="flex-1 rounded-none border-gray-300 dark:border-gray-700 text-black dark:text-white font-bold hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors duration-300" onClick={() => setDeleteConfirm({ isOpen: false, type: null, id: null })}>Cancel</Button>
                <Button onClick={executeDelete} disabled={isDeleting} className="flex-1 rounded-none bg-[#cc0000] dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-700 text-white font-bold transition-colors duration-300 uppercase">Delete</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* MODAL TAMBAH BUDGET */}
        <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
          <DialogContent className="sm:max-w-[350px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none shadow-xl transition-colors duration-300">
            <DialogHeader><DialogTitle className="text-xl font-serif font-black border-b border-black dark:border-white pb-3 transition-colors duration-300 uppercase">New Limit</DialogTitle></DialogHeader>
            <div className="space-y-5 pt-3">
              <div className="space-y-1.5"><label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Category</label><Input value={newBudgetCategory} onChange={(e) => setNewBudgetCategory(e.target.value)} className="bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300" /></div>
              <div className="space-y-1.5"><label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Amount (IDR)</label><Input type="number" value={newBudgetAmount} onChange={(e) => setNewBudgetAmount(e.target.value)} className={cn("bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300", NO_SPINNER_CLASS)} /></div>
              <Button onClick={handleAddBudget} className="w-full rounded-none bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black font-bold mt-2 transition-colors duration-300 uppercase">Save</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* MODAL TAMBAH GOAL */}
        <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
          <DialogContent className="sm:max-w-[350px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none shadow-xl transition-colors duration-300">
            <DialogHeader><DialogTitle className="text-xl font-serif font-black border-b border-black dark:border-white pb-3 transition-colors duration-300 uppercase">New Target</DialogTitle></DialogHeader>
            <div className="space-y-5 pt-3">
              <div className="space-y-1.5"><label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Target Name</label><Input value={newGoalName} onChange={(e) => setNewGoalName(e.target.value)} className="bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300" /></div>
              <div className="space-y-1.5"><label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide transition-colors duration-300">Target Amount (IDR)</label><Input type="number" value={newGoalTarget} onChange={(e) => setNewGoalTarget(e.target.value)} className={cn("bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white text-sm rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white transition-colors duration-300", NO_SPINNER_CLASS)} /></div>
              <Button onClick={handleAddGoal} className="w-full rounded-none bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black font-bold mt-2 transition-colors duration-300 uppercase">Save</Button>
            </div>
          </DialogContent>
        </Dialog>

      </div>
      <TransactionDialog open={transactionDialogOpen} onOpenChange={setTransactionDialogOpen} initialType={transactionDialogInitialType} accounts={accounts} onSubmitted={() => fetchData(false)} />
    </div>
  );
}