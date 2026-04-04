'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  TrendingUp, TrendingDown, Trash2, MessageSquare, Loader2, Moon, Sun, Pencil, RefreshCw, ShieldCheck, PlusCircle, Download
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
import SwipeableTransaction from '@/components/transaction/SwipeableTransaction';
import { type TransactionToEdit } from '@/components/transaction/TransactionDialog';
import { useMode } from '@/lib/ModeContext';
import ChangePinDialog from '@/components/ChangePinDialog';
import RecurringPanel from '@/components/recurring/RecurringPanel';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import SplashScreen from '@/components/SplashScreen';
import GuestBanner from '@/components/GuestBanner';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';

interface Account { id: string; name: string; type: string; balance: string | number | null; currency?: string; }
interface Transaction { id: string; account_id: string; transaction_date: string; notes: string; category: string; amount: number | string; type: 'income' | 'expense' | 'transfer'; accounts: { name: string; }; }
interface Budget { id: string; category_name: string; amount: number; month: string; }
interface Goal { id: string; name: string; target_amount: number; current_amount: number; deadline: string; }
interface InvestmentAsset { id: string; symbol: string; units: number; }

type TxFilter = { type: 'all' | 'income' | 'expense' | 'transfer'; accountId: 'all' | string; };
type ActiveTab = 'Overview' | 'Portfolios' | 'Budgets' | 'Targets' | 'Assets' | 'Recurring';

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
async function downloadMonthlyPDF(
  transactions: Transaction[],
  accounts: { id: string; name: string; type: string; balance: string | number | null }[],
  budgets: Budget[],
  goals: Goal[],
  monthLabel: string,
  monthlyIncome: number,
  monthlyExpense: number,
  grandTotalAssets: number,
  expenseByCategory: { name: string; value: number }[]
) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
 
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const fmt = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(Math.abs(n)));
 
  // ── HELPER ─────────────────────────────────────────────
  const setColor = (r: number, g: number, b: number) => doc.setTextColor(r, g, b);
  const setSize = (s: number) => doc.setFontSize(s);
 
  // ── PAGE 1 BACKGROUND ──────────────────────────────────
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, W, 297, 'F');
 
  // ── HEADER STRIP ───────────────────────────────────────
  // Header base
  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, W, 36, 'F');

  // Brand text — simple white
  setSize(22); setColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.text('BLACKJACK', 14, 20);
 
  setSize(7); setColor(120, 120, 120);
  doc.setFont('helvetica', 'normal');
  doc.text('PERSONAL FINANCE TERMINAL', 14, 26);
  doc.text(`MONTHLY REPORT  ·  ${monthLabel}`, W - 14, 26, { align: 'right' });
 
  // ── SUMMARY STRIP ──────────────────────────────────────
  doc.setFillColor(245, 245, 245);
  doc.rect(0, 36, W, 22, 'F');
 
  const cols = [
    { label: 'TOTAL ASSETS', value: fmt(grandTotalAssets), color: [15, 15, 15] as [number, number, number] },
    { label: 'INCOME', value: fmt(monthlyIncome), color: [46, 139, 87] as [number, number, number] },
    { label: 'EXPENSE', value: fmt(monthlyExpense), color: [180, 60, 60] as [number, number, number] },
    { label: 'NET', value: (monthlyIncome - monthlyExpense >= 0 ? '+' : '-') + fmt(monthlyIncome - monthlyExpense), color: monthlyIncome - monthlyExpense >= 0 ? [46, 139, 87] as [number, number, number] : [180, 60, 60] as [number, number, number] },
  ];
 
  const colW = W / 4;
  cols.forEach((col, i) => {
    const x = i * colW + 10;
    setSize(6.5); setColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text(col.label, x, 44);
    setSize(9); doc.setTextColor(...col.color);
    doc.setFont('helvetica', 'bold');
    doc.text(col.value, x, 52);
  });
 
  // ── WALLET BALANCES ────────────────────────────────────
  let y = 68;
  setSize(7); setColor(100, 100, 100);
  doc.setFont('helvetica', 'bold');
  doc.text('WALLET BALANCES', 14, y);
 
  autoTable(doc, {
    startY: y + 3,
    head: [['Account', 'Type', 'Balance']],
    body: accounts.map(a => [
      a.name,
      a.type,
      fmt(Number(a.balance || 0)),
    ]),
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      textColor: [30, 30, 30],
      cellPadding: 3,
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [30, 30, 30],
      textColor: [240, 240, 240],
      fontSize: 7.5,
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 40 },
      2: { halign: 'right' },
    },
      margin: { left: 14, right: 14 },
  });
 
  // ── TRANSACTIONS ───────────────────────────────────────
  y = (doc as any).lastAutoTable.finalY + 10;
  setSize(7); setColor(100, 100, 100);
  doc.setFont('helvetica', 'bold');
  doc.text('TRANSACTIONS', 14, y);
 
  autoTable(doc, {
    startY: y + 3,
    head: [['Date', 'Notes', 'Category', 'Account', 'Amount']],
    body: transactions.map(t => [
      t.transaction_date.split('T')[0],
      t.notes || '-',
      t.category || '-',
      t.accounts?.name || '-',
      (Number(t.amount) >= 0 ? '+' : '-') + fmt(Number(t.amount)),
    ]),
    theme: 'grid',
    styles: {
      fontSize: 7.5,
      textColor: [30, 30, 30],
      cellPadding: 2.5,
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [30, 30, 30],
      textColor: [240, 240, 240],
      fontSize: 7,
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 65 },
      2: { cellWidth: 35 },
      3: { cellWidth: 35 },
      4: { halign: 'right', cellWidth: 27 },
    },

    margin: { left: 14, right: 14, bottom: 8 },
    didParseCell: (data: any) => {
      if (data.column.index === 4 && data.section === 'body') {
        const val = String(data.cell.raw);
        if (val.startsWith('+')) data.cell.styles.textColor = [46, 139, 87];
        else if (val.startsWith('-')) data.cell.styles.textColor = [180, 60, 60];
      }
    },
    didDrawPage: (data: any) => {
      if (data.pageNumber > 1) {
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, W, 297, 'F');
        doc.setFillColor(20, 20, 20);
        doc.rect(0, 0, W, 10, 'F');
        setSize(6); setColor(160, 160, 160);
        doc.setFont('helvetica', 'normal');
        doc.text(`BLACKJACK  ·  ${monthLabel}`, 14, 7);
        doc.text(`Page ${data.pageNumber}`, W - 14, 7, { align: 'right' });
      }
    },
  });
 
  // ── TOP SPENDING ───────────────────────────────────────
  if (expenseByCategory.length > 0) {
    y = (doc as any).lastAutoTable.finalY + 4;
 
    setSize(7); setColor(100, 100, 100);
    doc.setFont('helvetica', 'bold');
    doc.text('TOP SPENDING BY CATEGORY', 14, y);
 
    autoTable(doc, {
      startY: y + 3,
      head: [['Category', 'Amount', '% of Expense']],
      body: expenseByCategory.slice(0, 10).map(c => [
        c.name,
        fmt(c.value),
        `${monthlyExpense > 0 ? ((c.value / monthlyExpense) * 100).toFixed(1) : 0}%`,
      ]),
      theme: 'grid',
      styles: {
        fontSize: 8.5,
        textColor: [30, 30, 30],
        cellPadding: 3,
        lineColor: [220, 220, 220],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [30, 30, 30],
        textColor: [240, 240, 240],
        fontSize: 7.5,
        fontStyle: 'bold',
      },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right', cellWidth: 30 },
      },
     margin: { left: 14, right: 14, top: 14 },
    });
  }
 
  // ── FOOTER LAST PAGE ───────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages();
  doc.setPage(pageCount);
  setSize(7); setColor(160, 160, 160);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Blackjack Finance Terminal  ·  Generated ${new Date().toLocaleDateString('id-ID')}  ·  Page ${pageCount} of ${pageCount}`,
    W / 2, 287, { align: 'center' }
  );
 
  // ── SAVE ───────────────────────────────────────────────
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  doc.save(`Blackjack_Report_${monthLabel}_${stamp}.pdf`);
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
  const [changePinOpen, setChangePinOpen] = useState(false);
  const { mode, sessionId } = useMode();
  const isGuest = mode === 'guest';
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('Overview');
  
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
  const [editingTransaction, setEditingTransaction] = useState<TransactionToEdit | null>(null);

  const [input, setInput] = useState('');
  const [txFilter, setTxFilter] = useState<TxFilter>({ type: 'all', accountId: 'all' });
  const [txSearch, setTxSearch] = useState('');
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
      if (isGuest && sessionId) {
        // ── GUEST MODE: baca dari tabel guest_* ──────────────────────────
        const guestAccRes = await supabase.from('guest_accounts').select('*').eq('session_id', sessionId).order('created_at', { ascending: true });
        const guestAccounts = (guestAccRes.data || []).map((a: any) => ({ id: String(a.id), name: a.name, type: a.type, balance: a.balance }));
        setAccounts(guestAccounts);
        accountsById = new Map(guestAccounts.map((a: any) => [String(a.id), String(a.name)]));

        const guestTxRes = await supabase.from('guest_transactions').select('*').eq('session_id', sessionId).order('transaction_date', { ascending: false });
        setTransactions((guestTxRes.data || []).map((t: any) => ({
          id: String(t.id), account_id: String(t.account_id), transaction_date: String(t.transaction_date || ''), notes: String(t.notes || ''),
          category: t.category || 'General', amount: t.amount, type: (t.type || 'expense') as Transaction['type'],
          accounts: { name: accountsById.get(String(t.account_id)) || '' },
        })));

      // Guest punya budget dan goal sendiri di tabel terpisah
        const guestBudgetsRes = await supabase.from('guest_budgets').select('*').eq('session_id', sessionId).eq('month', selectedMonth);
        if (guestBudgetsRes.data) setBudgets(guestBudgetsRes.data);

        const guestGoalsRes = await supabase.from('guest_goals').select('*').eq('session_id', sessionId).order('created_at', { ascending: false });
        if (guestGoalsRes.data) setGoals(guestGoalsRes.data);

      } else {
        // ── PRIVATE MODE: baca dari tabel normal ─────────────────────────
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
      }

    } catch (err) { console.error(err); toast.error('Failed to load data'); } 
    finally { setLoading(false); setTimeout(() => setIsRefreshing(false), 500); }
  }, [selectedMonth, fetchPrices, isGuest, sessionId]);

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
      const table = isGuest ? 'guest_goals' : 'goals';
      const { error } = await supabase.from(table).update({ current_amount: newAmt }).eq('id', selectedGoal.id);
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
        // Asset disimpan di localStorage, tidak ada saldo yang perlu di-rollback
        const updated = myAssets.filter(a => a.id !== id);
        setMyAssets(updated);
        localStorage.setItem('blackjack_assets', JSON.stringify(updated));

      } else if (type === 'transaction') {
        // 1. Ambil data transaksi sebelum dihapus
        const { data: txData, error: fetchErr } = await supabase
          .from('transactions')
          .select('id, account_id, category_id, amount, type, notes, transaction_date')
          .eq('id', id)
          .single();
        if (fetchErr || !txData) throw new Error('Transaction not found');

        const amountToReverse = Number(txData.amount);

        if (txData.type === 'transfer') {
          // Transfer: cari transaksi pasangannya (notes sama, tanggal sama, account berbeda)
          const { data: paired } = await supabase
            .from('transactions')
            .select('id, account_id, amount')
            .eq('notes', txData.notes)
            .eq('transaction_date', txData.transaction_date)
            .eq('type', 'transfer')
            .neq('id', id);

          // Rollback saldo akun sumber (transaksi ini)
          const { data: srcAcc } = await supabase
            .from('accounts').select('balance').eq('id', txData.account_id).single();
          if (srcAcc) {
            await supabase.from('accounts')
              .update({ balance: Number(srcAcc.balance) - amountToReverse })
              .eq('id', txData.account_id);
          }

          // Rollback saldo akun tujuan (transaksi pasangan) + hapus transaksi pasangan
          if (paired && paired.length > 0) {
            const partner = paired[0];
            const { data: dstAcc } = await supabase
              .from('accounts').select('balance').eq('id', partner.account_id).single();
            if (dstAcc) {
              await supabase.from('accounts')
                .update({ balance: Number(dstAcc.balance) - Number(partner.amount) })
                .eq('id', partner.account_id);
            }
            // Hapus transaksi pasangan juga
            await supabase.from('transactions').delete().eq('id', partner.id);
          }

        } else {
          // Income / Expense biasa: balik saldo (kurangi apa yang pernah ditambah)
          const { data: acc } = await supabase
            .from('accounts').select('balance').eq('id', txData.account_id).single();
          if (acc) {
            await supabase.from('accounts')
              .update({ balance: Number(acc.balance) - amountToReverse })
              .eq('id', txData.account_id);
          }
        }

        // 2. Simpan category_id sebelum dihapus
        const orphanCategoryId = txData.category_id;

        // 3. Hapus transaksi utama
        const { error: delErr } = await supabase.from('transactions').delete().eq('id', id);
        if (delErr) throw delErr;

        // 4. Hapus kategori jika tidak dipakai transaksi lain
        if (orphanCategoryId) {
          const { count } = await supabase
            .from('transactions')
            .select('id', { count: 'exact', head: true })
            .eq('category_id', orphanCategoryId);
          
          if (count === 0) {
            await supabase.from('categories').delete().eq('id', orphanCategoryId);
          }
        }

      } else {
        // Budget / Goal: hapus langsung, tidak ada efek ke saldo
        let table = type === 'budget' ? 'budgets' : 'goals';
        if (isGuest) table = type === 'budget' ? 'guest_budgets' : 'guest_goals';
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) throw error;
      }

      toast.success('Deleted & balance restored');
      fetchData(false);
    } catch (err: any) {
      toast.error(err.message || 'Deletion failed');
    } finally {
      setIsDeleting(false);
      setDeleteConfirm({ isOpen: false, type: null, id: null });
    }
  };

  const handleAddBudget = async () => {
    if (!newBudgetCategory || !newBudgetAmount) return toast.error('Fill all fields');
    try {
      const table = isGuest ? 'guest_budgets' : 'budgets';
      const payload = isGuest
        ? { session_id: sessionId, category_name: newBudgetCategory, amount: Math.abs(Number(newBudgetAmount)), month: selectedMonth }
        : { category_name: newBudgetCategory, amount: Math.abs(Number(newBudgetAmount)), month: selectedMonth };
      const { error } = await supabase.from(table).insert(payload);
      if (error) throw error;
      toast.success('Budget added'); setBudgetDialogOpen(false); fetchData(false);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAddGoal = async () => {
    if (!newGoalName || !newGoalTarget) return toast.error('Name and target required');
    try {
      const table = isGuest ? 'guest_goals' : 'goals';
      const payload = isGuest
        ? { session_id: sessionId, name: newGoalName, target_amount: Math.abs(Number(newGoalTarget)), current_amount: 0, deadline: newGoalDeadline ? format(newGoalDeadline, 'yyyy-MM-dd') : null }
        : { name: newGoalName, target_amount: Math.abs(Number(newGoalTarget)), deadline: newGoalDeadline ? format(newGoalDeadline, 'yyyy-MM-dd') : null };
      const { error } = await supabase.from(table).insert(payload);
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

  const filteredTransactions = useMemo(() => transactionsInSelectedMonth.filter(t => {
    const matchFilter = (txFilter.type === 'all' || t.type === txFilter.type) && (txFilter.accountId === 'all' || t.account_id === txFilter.accountId);
    if (!txSearch.trim()) return matchFilter;
    const q = txSearch.toLowerCase();
    const matchSearch = t.notes?.toLowerCase().includes(q) || t.category?.toLowerCase().includes(q) || t.accounts?.name?.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  }), [transactionsInSelectedMonth, txFilter, txSearch]);
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

  const monthlyTrendData = useMemo(() => {
    const results = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
      const monthTxs = transactions.filter(t => transactionInYearMonth(t, ym));
      const income = monthTxs.filter(t => t.type === 'income').reduce((s, t) => s + toNumber(t.amount), 0);
      const expense = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(toNumber(t.amount)), 0);
      results.push({ label, income, expense, net: income - expense });
    }
    return results;
  }, [transactions]);

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
  
   if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0A0A0A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
      <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '32px', fontWeight: 300, color: '#F5F5F5', letterSpacing: '-0.01em' }}>Blackjack</p>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#4DA3E8', animation: 'bj-pulse-slow 1.4s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex justify-center" style={{ background: '#0A0A0A' }}>
      <div className="w-full max-w-md min-h-screen relative flex flex-col overflow-x-hidden" style={{ background: '#0A0A0A', borderLeft: '1px solid transparent', borderRight: '1px solid transparent' }}>
        
        {/* HEADER — Luxury Noir */}
        <header className="sticky top-0 z-30 flex flex-col" style={{ background: '#0A0A0A', borderBottom: '1px solid transparent' }}>

          {/* Top bar — brand + actions */}
          <div className="px-5 pt-5 pb-4 flex items-center justify-between">
            <h1 style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: '28px',
              fontWeight: 300,
              letterSpacing: '-0.01em',
              color: '#EFEFEF',
              lineHeight: 1,
            }}>
              Blackjack
            </h1>
            <div className="flex gap-2 items-center">
              {mode === 'private' && (
                <button onClick={() => setChangePinOpen(true)}
                  className="transition-colors duration-200"
                  style={{ padding: '6px', color: '#4A4A4A', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#8A8A8A'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4A4A4A'; }}
                >
                  <ShieldCheck className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => fetchData(false)}
                style={{ padding: '6px', color: '#4A4A4A', background: 'none', border: 'none', cursor: 'pointer', transition: 'color 200ms ease-out' }}
                className={cn(isRefreshing && 'animate-spin')}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#8A8A8A'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#4A4A4A'; }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => { setTransactionDialogInitialType('expense'); setTransactionDialogOpen(true); }}
                style={{
                  padding: '6px 14px',
                  background: '#4DA3E8  ',
                  color: '#FFFFFF',
                  fontSize: '9px',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase', 
                  fontFamily: 'Inter, sans-serif',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 200ms ease-out',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#6DB8F0'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#4DA3E8'; }}
              >
                + Entry
              </button>
            </div>
          </div>

          {/* Data strip — key metrics in one line */}
          <div
            className="px-5 py-2 flex items-center gap-5 overflow-x-auto scrollbar-hide"
            style={{ borderTop: '1px solid transparent' }}
          >
            <div className="flex flex-col shrink-0">
              <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4A4A4A', fontFamily: 'Inter, sans-serif' }}>Assets</span>
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#EFEFEF', fontFamily: "'SF Mono', monospace", letterSpacing: '0.01em' }}>{formatCurrency(grandTotalAssets)}</span>
            </div>
            <div style={{ width: '1px', height: '24px', background: 'transparent', flexShrink: 0 }} />
            <div className="flex flex-col shrink-0">
              <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4A4A4A', fontFamily: 'Inter, sans-serif' }}>Invest</span>
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#4DA3E8', fontFamily: "'SF Mono', monospace", letterSpacing: '0.01em' }}>{formatCurrency(totalInvestments)}</span>
            </div>
            <div style={{ width: '1px', height: '24px', background: 'transparent', flexShrink: 0 }} />
            <div className="flex flex-col shrink-0">
              <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4A4A4A', fontFamily: 'Inter, sans-serif' }}>In</span>
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#4CAF85', fontFamily: "'SF Mono', monospace", letterSpacing: '0.01em' }}>+{formatCurrency(monthlyIncome)}</span>
            </div>
            <div style={{ width: '1px', height: '24px', background: 'transparent', flexShrink: 0 }} />
            <div className="flex flex-col shrink-0">
              <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4A4A4A', fontFamily: 'Inter, sans-serif' }}>Out</span>
              <span style={{ fontSize: '12px', fontWeight: 500, color: '#E05C5C', fontFamily: "'SF Mono', monospace", letterSpacing: '0.01em' }}>-{formatCurrency(monthlyExpense)}</span>
            </div>
            <div style={{ width: '1px', height: '24px', background: 'transparent', flexShrink: 0 }} />
            <div className="flex flex-col shrink-0 ml-auto">
              <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4A4A4A', fontFamily: 'Inter, sans-serif' }}>Period</span>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="h-auto border-0 shadow-none bg-transparent p-0 focus:ring-0 focus:ring-offset-0" style={{ fontSize: '12px', fontWeight: 500, color: '#8A8A8A', fontFamily: "'SF Mono', monospace" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ background: '#111111', border: 'none', borderRadius: 0 }}>
                  {monthOptions.map(o => <SelectItem key={o.value} value={o.value} style={{ fontSize: '11px' }}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-6 pb-32 space-y-10">
          
          {/* PAGE HEADER + TABS */}
          <div className="bj-deal bj-deal-1" style={{ borderBottom: '1px solid transparent', paddingBottom: '16px' }}>
            <h2 style={{
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: '42px',
              fontWeight: 300,
              letterSpacing: '-0.02em',
              color: '#EFEFEF',
              lineHeight: 1,
              marginBottom: '20px',
            }}>
              Markets
            </h2>

            {/* Tab navigation */}
            <div className="flex gap-6 overflow-x-auto scrollbar-hide" style={{ paddingBottom: '1px' }}>
              {(['Overview', 'Portfolios', 'Budgets', 'Targets', 'Assets', ...(isGuest ? [] : ['Recurring'])] as string[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab as ActiveTab)}
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    fontFamily: 'Inter, sans-serif',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === tab ? '1px solid #4DA3E8' : '1px solid transparent',
                    color: activeTab === tab ? '#F5F5F5' : '#606060',
                    paddingBottom: '8px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 200ms ease-out',
                  }}
                  onMouseEnter={e => {
                    if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = '#8A8A8A';
                  }}
                  onMouseLeave={e => {
                    if (activeTab !== tab) (e.currentTarget as HTMLElement).style.color = '#4A4A4A';
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* TAB 0: OVERVIEW */}
          {activeTab === 'Overview' && (
            <div className="bj-deal space-y-5">

              {/* EXPORT PDF BUTTON */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                <button
                  onClick={() => downloadMonthlyPDF(
                    transactionsInSelectedMonth,
                    accounts,
                    budgets,
                    goals,
                    selectedMonth,
                    monthlyIncome,
                    monthlyExpense,
                    grandTotalAssets,
                    expenseByCategory
                  )}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.10)', color: '#A0A0A0', fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer', transition: 'all 200ms' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#4DA3E8'; (e.currentTarget as HTMLElement).style.color = '#4DA3E8'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.10)'; (e.currentTarget as HTMLElement).style.color = '#A0A0A0'; }}
                >
                  <Download className="w-3 h-3" />
                  Export PDF
                </button>
              </div>

              {/* NET WORTH — Hero */}

              {/* NET WORTH — Hero */}
              <div className="bj-deal-1 bj-panel" style={{ padding: '20px 0', background: 'linear-gradient(145deg, transparent 0%, rgba(255,255,255,0.01) 100%)', border: 'none', backdropFilter: 'blur(8px)' }}>
                <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', marginBottom: '8px' }}>Total Net Worth</p>
                <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '52px', fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1, color: '#F5F5F5' }}>
                  {formatCurrency(grandTotalAssets)}
                </p>
                <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', margin: '16px 0' }} />
                <div style={{ display: 'flex', gap: '24px' }}>
                  <div>
                    <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif' }}>Liquid</p>
                    <p style={{ fontSize: '13px', fontWeight: 500, color: '#F5F5F5', fontFamily: "'SF Mono', monospace", marginTop: '3px' }}>{formatCurrency(totalLiquidNetWorth)}</p>
                  </div>
                  <div style={{ width: '1px', background: 'rgba(255,255,255,0.07)' }} />
                  <div>
                    <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif' }}>Investments</p>
                    <p style={{ fontSize: '13px', fontWeight: 500, color: '#4DA3E8', fontFamily: "'SF Mono', monospace", marginTop: '3px' }}>{formatCurrency(totalInvestments)}</p>
                  </div>
                  <div style={{ width: '1px', background: 'rgba(255,255,255,0.07)' }} />
                  <div>
                    <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif' }}>Invest %</p>
                    <p style={{ fontSize: '13px', fontWeight: 500, color: '#F5F5F5', fontFamily: "'SF Mono', monospace", marginTop: '3px' }}>
                      {grandTotalAssets > 0 ? ((totalInvestments / grandTotalAssets) * 100).toFixed(1) : '0'}%
                    </p>
                  </div>
                </div>
              </div>

              {/* MONTHLY CASHFLOW */}
              <div className="bj-deal-2 bj-panel" style={{ padding: '20px 0', background: 'linear-gradient(145deg, transparent 0%, rgba(255,255,255,0.01) 100%)', border: 'none', backdropFilter: 'blur(8px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif' }}>Monthly Cashflow</p>
                  <p style={{ fontSize: '9px', color: '#606060', fontFamily: "'SF Mono', monospace" }}>{selectedMonth}</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  <div>
                    <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif' }}>Income</p>
                    <p style={{ fontSize: '18px', fontWeight: 500, color: '#4CAF85', fontFamily: "'Cormorant Garamond', serif", marginTop: '4px' }}>{formatCurrency(monthlyIncome)}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif' }}>Expense</p>
                    <p style={{ fontSize: '18px', fontWeight: 500, color: '#E05C5C', fontFamily: "'Cormorant Garamond', serif", marginTop: '4px' }}>{formatCurrency(monthlyExpense)}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif' }}>Net</p>
                    <p style={{ fontSize: '18px', fontWeight: 500, color: monthlyIncome - monthlyExpense >= 0 ? '#4CAF85' : '#E05C5C', fontFamily: "'Cormorant Garamond', serif", marginTop: '4px' }}>
                      {monthlyIncome - monthlyExpense >= 0 ? '+' : ''}{formatCurrency(monthlyIncome - monthlyExpense)}
                    </p>
                  </div>
                </div>
                {monthlyIncome > 0 && (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif' }}>Savings Rate</p>
                      <p style={{ fontSize: '11px', fontWeight: 600, color: '#A0A0A0', fontFamily: "'SF Mono', monospace" }}>
                        {Math.max(0, ((monthlyIncome - monthlyExpense) / monthlyIncome) * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div style={{ height: '3px', background: 'rgba(255,255,255,0.07)', width: '100%', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, ((monthlyIncome - monthlyExpense) / monthlyIncome) * 100))}%`,
                        background: ((monthlyIncome - monthlyExpense) / monthlyIncome) >= 0.2 ? '#4CAF85' : '#D4943A',
                        transition: 'width 600ms ease-out',
                      }} />
                    </div>
                    <p style={{ fontSize: '9px', color: '#606060', fontFamily: 'Inter, sans-serif', marginTop: '6px' }}>
                      {((monthlyIncome - monthlyExpense) / monthlyIncome) >= 0.2 ? '↑ On track — above 20% target' : '↓ Below 20% savings target'}
                    </p>
                  </div>
                )}
              </div>

              {/* WALLET BREAKDOWN */}
              <div className="bj-deal-3 bj-panel">
                <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', marginBottom: '14px' }}>Wallet Breakdown</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {accounts.map(acc => {
                    const bal = toNumber(acc.balance);
                    const pct = totalLiquidNetWorth > 0 ? (bal / totalLiquidNetWorth) * 100 : 0;
                    return (
                      <div key={acc.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '72px', flexShrink: 0 }}>
                          <p style={{ fontSize: '12px', fontWeight: 500, color: '#F5F5F5', fontFamily: 'Inter, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</p>
                          <p style={{ fontSize: '9px', color: '#606060', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Inter, sans-serif' }}>{acc.type}</p>
                        </div>
                        <div style={{ flex: 1, height: '2px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(0, pct)}%`, background: '#4DA3E8', transition: 'width 600ms ease-out' }} />
                        </div>
                        <div style={{ width: '80px', textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ fontSize: '11px', fontWeight: 500, color: '#F5F5F5', fontFamily: "'SF Mono', monospace" }}>{formatCurrency(bal)}</p>
                          <p style={{ fontSize: '9px', color: '#606060', fontFamily: 'Inter, sans-serif' }}>{pct.toFixed(1)}%</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* TOP SPENDING */}
              {expenseByCategory.length > 0 && (
                <div className="bj-deal-4 bj-panel">
                  <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', marginBottom: '14px' }}>Top Spending</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {expenseByCategory.slice(0, 5).map((cat, i) => {
                      const pct = monthlyExpense > 0 ? (cat.value / monthlyExpense) * 100 : 0;
                      return (
                        <div key={cat.name}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '9px', color: '#606060', fontFamily: "'SF Mono', monospace", width: '12px' }}>{i + 1}</span>
                              <p style={{ fontSize: '12px', fontWeight: 500, color: '#F5F5F5', fontFamily: 'Inter, sans-serif', textTransform: 'capitalize' }}>{cat.name}</p>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <p style={{ fontSize: '11px', fontWeight: 500, color: '#A0A0A0', fontFamily: "'SF Mono', monospace" }}>{formatCurrency(cat.value)}</p>
                              <p style={{ fontSize: '9px', color: '#606060', fontFamily: 'Inter, sans-serif', width: '28px', textAlign: 'right' }}>{pct.toFixed(0)}%</p>
                            </div>
                          </div>
                          <div style={{ height: '2px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: '#E05C5C', opacity: 0.6 + (i * 0.08), transition: 'width 600ms ease-out' }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* BUDGET HEALTH */}
              {budgets.length > 0 && (
                <div className="bj-deal-5 bj-panel" style={{ padding: '20px 0', background: 'transparent', border: 'none' }}>
                  <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', marginBottom: '14px' }}>Budget Health</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {budgets.map(budget => {
                      const spent = expenseByCategory.find(e => e.name.toLowerCase() === budget.category_name.toLowerCase())?.value || 0;
                      const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
                      const isOver = spent > budget.amount;
                      const isWarn = !isOver && pct > 80;
                      return (
                        <div key={budget.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <p style={{ fontSize: '11px', color: '#A0A0A0', fontFamily: 'Inter, sans-serif', width: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0, textTransform: 'capitalize' }}>{budget.category_name}</p>
                          <div style={{ flex: 1, height: '2px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: isOver ? '#E05C5C' : isWarn ? '#D4943A' : '#4CAF85', transition: 'width 600ms ease-out' }} />
                          </div>
                          <span style={{ fontSize: '9px', color: isOver ? '#E05C5C' : isWarn ? '#D4943A' : '#606060', fontFamily: "'SF Mono', monospace", width: '16px', flexShrink: 0 }}>
                            {isOver ? '!' : isWarn ? '~' : '✓'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* MONTHLY TREND CHART */}
              {monthlyTrendData.some(d => d.income > 0 || d.expense > 0) && (
                <div className="bj-deal-5">
                  <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', marginBottom: '16px' }}>
                    6-Month Trend
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={monthlyTrendData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 9, fill: '#606060', fontFamily: 'Inter, sans-serif' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: '#606060', fontFamily: 'Inter, sans-serif' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)}
                      />
                      <RechartsTooltip
                        contentStyle={{ background: '#111111', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 0, fontSize: '11px', fontFamily: 'Inter, sans-serif' }}
                        labelStyle={{ color: '#606060', marginBottom: '4px' }}
                        itemStyle={{ color: '#F5F5F5' }}
                        formatter={(value: number) => new Intl.NumberFormat('id-ID').format(value)}
                      />
                      <Line
                        type="monotone"
                        dataKey="income"
                        stroke="#4CAF85"
                        strokeWidth={1.5}
                        dot={{ r: 3, fill: '#4CAF85', strokeWidth: 0 }}
                        activeDot={{ r: 4, fill: '#4CAF85' }}
                        name="Income"
                      />
                      <Line
                        type="monotone"
                        dataKey="expense"
                        stroke="#E05C5C"
                        strokeWidth={1.5}
                        dot={{ r: 3, fill: '#E05C5C', strokeWidth: 0 }}
                        activeDot={{ r: 4, fill: '#E05C5C' }}
                        name="Expense"
                      />
                      <Line
                        type="monotone"
                        dataKey="net"
                        stroke="#4DA3E8"
                        strokeWidth={1}
                        strokeDasharray="4 2"
                        dot={false}
                        name="Net"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px' }}>
                    {[{ color: '#4CAF85', label: 'Income' }, { color: '#E05C5C', label: 'Expense' }, { color: '#4DA3E8', label: 'Net', dashed: true }].map(item => (
                      <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <div style={{ width: 16, height: 1.5, background: item.color, opacity: item.dashed ? 0.7 : 1 }} />
                        <span style={{ fontSize: '9px', color: '#606060', fontFamily: 'Inter, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: RECURRING */}
          {activeTab === 'Recurring' && (
            <RecurringPanel accounts={accounts} onTransactionLogged={() => fetchData(false)} />
          )}

          {/* TAB 1: PORTFOLIOS */}
          {activeTab === 'Portfolios' && (
            <div className="bj-deal space-y-3">
              {accounts.map((acc, i) => {
                const isSelected = txFilter.accountId === acc.id;
                return (
                  <div
                    key={acc.id}
                    onClick={() => setTxFilter({ type: 'all', accountId: acc.id })}
                    className={`bj-deal-${Math.min(i + 1, 5)}`}
                    style={{
                      padding: '16px',
                      background: isSelected ? 'transparent' : 'transparent',
                      border: `1px solid ${isSelected ? '#4DA3E8' : 'rgba(255,255,255,0.08)'}`,
                      cursor: 'pointer',
                      transition: 'all 200ms ease-out',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: isSelected ? '#4DA3E8' : '#606060', fontFamily: 'Inter, sans-serif', marginBottom: '4px' }}>{acc.type}</p>
                        <p style={{ fontSize: '16px', fontWeight: 400, color: '#F5F5F5', fontFamily: "'Cormorant Garamond', Georgia, serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                        <p style={{ fontSize: '14px', fontWeight: 500, color: '#F5F5F5', fontFamily: "'SF Mono', monospace" }}>{formatCurrency(toNumber(acc.balance))}</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedAccount(acc); setInputValue(String(toNumber(acc.balance))); setEditBalanceOpen(true); }}
                          style={{ color: '#606060', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', transition: 'color 200ms ease-out' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#4DA3E8'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#606060'; }}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: BUDGETS */}
          {activeTab === 'Budgets' && (
            <div className="bj-deal">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '22px', fontWeight: 400, color: '#F5F5F5' }}>Spending Limits</p>
                <button onClick={() => setBudgetDialogOpen(true)} style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4DA3E8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>+ Add</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {budgets.length > 0 ? budgets.map((budget, i) => {
                  const spent = expenseByCategory.find(e => e.name.toLowerCase() === budget.category_name.toLowerCase())?.value || 0;
                  const percentage = Math.min((spent / budget.amount) * 100, 100);
                  const isOver = spent > budget.amount;
                  const isWarn = !isOver && percentage > 80;
                  return (
                    <div key={budget.id} className={`bj-deal-${Math.min(i + 1, 5)} group`} style={{ paddingBottom: '16px', borderBottom: '1px solid transparent', position: 'relative' }}>
                      <button
                        onClick={() => confirmDelete('budget', budget.id)}
                        style={{ position: 'absolute', top: 0, right: 0, color: '#606060', background: 'none', border: 'none', cursor: 'pointer', opacity: 0, transition: 'all 200ms', padding: '2px' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#E05C5C'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#606060'; }}
                        className="group-hover:opacity-100"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
                        <p style={{ fontSize: '14px', fontWeight: 400, color: '#F5F5F5', fontFamily: "'Cormorant Garamond', Georgia, serif", textTransform: 'capitalize' }}>{budget.category_name}</p>
                        <p style={{ fontSize: '11px', fontFamily: "'SF Mono', monospace", color: isOver ? '#E05C5C' : '#A0A0A0' }}>
                          {formatCurrency(spent)} <span style={{ color: '#606060' }}>/ {formatCurrency(budget.amount)}</span>
                        </p>
                      </div>
                      <div style={{ height: '2px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${percentage}%`, background: isOver ? '#E05C5C' : isWarn ? '#D4943A' : '#4CAF85', transition: 'width 600ms ease-out' }} />
                      </div>
                    </div>
                  );
                }) : (
                  <p style={{ fontSize: '12px', color: '#606060', fontFamily: 'Inter, sans-serif', fontStyle: 'italic' }}>No spending limits set.</p>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: TARGETS */}
          {activeTab === 'Targets' && (
            <div className="bj-deal">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '22px', fontWeight: 400, color: '#F5F5F5' }}>Financial Targets</p>
                <button onClick={() => setGoalDialogOpen(true)} style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#4DA3E8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>+ New</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {goals.length > 0 ? goals.map((goal, i) => {
                  const percentage = Math.min((toNumber(goal.current_amount) / toNumber(goal.target_amount)) * 100, 100);
                  const isDone = percentage >= 100;
                  return (
                    <div key={goal.id} className={`bj-deal-${Math.min(i + 1, 5)}`} style={{ padding: '16px', background: 'transparent', border: `1px solid ${isDone ? 'rgba(76,175,133,0.3)' : 'rgba(255,255,255,0.08)'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <p style={{ fontSize: '16px', fontWeight: 400, color: '#F5F5F5', fontFamily: "'Cormorant Garamond', Georgia, serif", textTransform: 'capitalize', flex: 1, paddingRight: '12px' }}>{goal.name}</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                          <button
                            onClick={() => { setSelectedGoal(goal); setInputValue(''); setFundGoalOpen(true); }}
                            style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4DA3E8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <PlusCircle className="w-3 h-3" /> Fund
                          </button>
                          <button
                            onClick={() => confirmDelete('goal', goal.id)}
                            style={{ color: '#606060', background: 'none', border: 'none', cursor: 'pointer', transition: 'color 200ms' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#E05C5C'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#606060'; }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <p style={{ fontSize: '11px', color: '#606060', fontFamily: "'SF Mono', monospace" }}>{formatCurrency(toNumber(goal.current_amount))} <span style={{ color: '#404040' }}>of</span> {formatCurrency(toNumber(goal.target_amount))}</p>
                        <p style={{ fontSize: '12px', fontWeight: 600, color: isDone ? '#4CAF85' : '#A0A0A0', fontFamily: "'SF Mono', monospace" }}>{percentage.toFixed(0)}%</p>
                      </div>
                      <div style={{ height: '3px', background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${percentage}%`, background: isDone ? '#4CAF85' : '#4DA3E8', transition: 'width 800ms ease-out' }} />
                      </div>
                    </div>
                  );
                }) : (
                  <p style={{ fontSize: '12px', color: '#606060', fontFamily: 'Inter, sans-serif', fontStyle: 'italic' }}>No targets set.</p>
                )}
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

          {/* TRANSACTION FEED */}
          {activeTab !== 'Assets' && activeTab !== 'Overview' && (
            <div className="bj-deal" style={{ marginTop: '32px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '22px', fontWeight: 400, color: '#F5F5F5' }}>Transactions</p>
                {isFilterActive && (
                  <button
                    onClick={() => setTxFilter({ type: 'all', accountId: 'all' })}
                    style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              {/* SEARCH BAR */}
              <div style={{ position: 'relative', marginBottom: '4px' }}>
                <input
                  type="text"
                  placeholder="Search notes, category, account..."
                  value={txSearch}
                  onChange={e => setTxSearch(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.10)',
                    color: '#F5F5F5',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '12px',
                    padding: '8px 28px 8px 0',
                    outline: 'none',
                    transition: 'border-color 200ms ease-out',
                  }}
                  onFocus={e => { e.currentTarget.style.borderBottomColor = '#4DA3E8'; }}
                  onBlur={e => { e.currentTarget.style.borderBottomColor = 'rgba(255,255,255,0.10)'; }}
                />
                {txSearch && (
                  <button
                    onClick={() => setTxSearch('')}
                    style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#606060', cursor: 'pointer', fontSize: '12px', padding: '4px' }}
                  >
                    ✕
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {groupedTransactions.map(([dateKey, txs]) => (
                  <div key={dateKey}>
                    <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', paddingBottom: '8px', borderBottom: '1px solid transparent', marginBottom: '8px' }}>
                      {formatDateForGrouping(dateKey)}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {txs.map((tx) => {
                        const amt = toNumber(tx.amount);
                        const isInc = tx.type === 'income';
                        const isTransfer = tx.type === 'transfer';
                        return (
                          <SwipeableTransaction
                            key={tx.id}
                            onEdit={() => {
                              setEditingTransaction({
                                id: tx.id,
                                account_id: tx.account_id,
                                amount: tx.amount,
                                type: tx.type,
                                notes: tx.notes,
                                category: tx.category,
                                transaction_date: tx.transaction_date,
                              });
                              setTransactionDialogOpen(true);
                            }}
                            onDelete={() => confirmDelete('transaction', tx.id)}
                          >
                            <div className="bj-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 8px', margin: '0 -8px' }}>
                              <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                                <p style={{ fontSize: '13px', fontWeight: 400, color: '#F5F5F5', fontFamily: "'Cormorant Garamond', Georgia, serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {tx.notes || 'Unnamed'}
                                </p>
                                <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', marginTop: '2px' }}>
                                  {tx.category} · {tx.accounts?.name}
                                </p>
                              </div>
                              <p style={{
                                fontSize: '13px',
                                fontWeight: 500,
                                color: isInc ? '#4CAF85' : isTransfer ? '#4DA3E8' : '#F5F5F5',
                                fontFamily: "'SF Mono', monospace",
                                flexShrink: 0,
                              }}>
                                {isInc ? '+' : isTransfer ? '↔' : '-'}{formatCurrency(Math.abs(amt))}
                              </p>
                            </div>
                          </SwipeableTransaction>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {filteredTransactions.length === 0 && (
                  <p style={{ fontSize: '12px', color: '#606060', fontFamily: 'Inter, sans-serif', fontStyle: 'italic' }}>No transactions found.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* FLOATING AI BUTTON */}
        <div className="fixed bottom-6 right-6 sm:right-auto sm:translate-x-44 z-40">
          <button
            onClick={() => setShowAIAssistant(true)}
            style={{ width: 52, height: 52, background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#4DA3E8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', transition: 'all 200ms ease-out' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#4DA3E8'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <MessageSquare className="w-5 h-5" />
          </button>
        </div>

        {/* AI CHAT MODAL */}
        {showAIAssistant && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
            <div className="w-full max-w-md mx-auto flex flex-col shadow-2xl" style={{ height: '88dvh', background: '#0A0A0A', borderTop: '1px solid rgba(255,255,255,0.10)', borderLeft: '1px solid transparent', borderRight: '1px solid transparent' }}>

              {/* Chat Header */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#111111' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: chatBusy ? '#D4943A' : '#4CAF85' }} className={chatBusy ? 'bj-pulse' : ''} />
                  <div>
                    <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '18px', fontWeight: 400, color: '#F5F5F5', lineHeight: 1 }}>Blackjack AI</p>
                    <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', marginTop: '2px' }}>
                      {chatBusy ? 'Processing...' : 'Finance Assistant'}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={() => setChatMessages([])}
                    style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#606060', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'color 200ms' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#A0A0A0'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#606060'; }}
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setShowAIAssistant(false)}
                    style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#606060', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'color 200ms' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#F5F5F5'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#606060'; }}
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="scrollbar-hide" style={{ flex: 1, overflowY: 'auto', padding: '20px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {chatMessages.length === 0 && (
                  <div style={{ textAlign: 'center', paddingTop: '40px' }}>
                    <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '28px', fontWeight: 300, color: '#2A2A2A', marginBottom: '8px' }}>How can I help?</p>
                    <p style={{ fontSize: '11px', color: '#404040', fontFamily: 'Inter, sans-serif', lineHeight: 1.6 }}>
                      Log transactions, check balances,<br />or ask for financial insights.
                    </p>
                  </div>
                )}
                {chatMessages.map((m) => {
                  const text = getMessageText(m);
                  const mAny = m as any;
                  const hasTool = mAny.toolInvocations && mAny.toolInvocations.length > 0;
                  if (!text && !hasTool) return null;
                  const isUser = m.role === 'user';
                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '85%',
                        padding: '10px 14px',
                        background: isUser ? '#4DA3E8' : 'transparent',
                        border: isUser ? 'none' : '1px solid rgba(255,255,255,0.07)',
                        color: isUser ? '#fff' : '#E0E0E0',
                        fontSize: isUser ? '13px' : '13px',
                        fontFamily: isUser ? 'Inter, sans-serif' : "'Cormorant Garamond', Georgia, serif",
                        lineHeight: 1.6,
                      }}>
                        {text && <p style={{ whiteSpace: 'pre-wrap' }}>{renderBoldMarkdown(text)}</p>}
                        {hasTool && mAny.toolInvocations?.map((tool: any) => (
                          <div key={tool.toolCallId} style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.10)' }}>
                            {tool.state === 'result'
                              ? <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#4CAF85', fontFamily: 'Inter, sans-serif' }}>✓ Synced</span>
                              : <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#D4943A', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', gap: '6px' }}><Loader2 className="w-3 h-3 animate-spin" /> Processing</span>
                            }
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {chatStatus === 'submitted' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{ padding: '12px 16px', background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {[0, 1, 2].map(i => (
                        <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: '#4A4A4A', animation: 'bj-pulse-slow 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={chatScrollRef} style={{ height: 1 }} />
              </div>

              {/* Input */}
              <form
                style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '8px', flexShrink: 0, background: '#111111' }}
                onSubmit={(e) => { e.preventDefault(); if (input.trim() && !chatBusy) { sendMessage({ text: input }); setInput(''); } }}
              >
                <textarea
                  autoFocus
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim() && !chatBusy) { sendMessage({ text: input }); setInput(''); } } }}
                  disabled={chatBusy}
                  placeholder="Ask anything or log a transaction..."
                  rows={1}
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#F5F5F5', fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '14px', padding: '10px 12px', outline: 'none', resize: 'none', lineHeight: 1.5, borderRadius: 0 }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
                />
                <button
                  type="submit"
                  disabled={chatBusy || !input.trim()}
                  style={{ padding: '10px 18px', background: input.trim() && !chatBusy ? '#4DA3E8' : 'transparent', border: 'none', color: input.trim() && !chatBusy ? '#fff' : '#3A3A3A', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: input.trim() && !chatBusy ? 'pointer' : 'not-allowed', transition: 'all 200ms', flexShrink: 0 }}
                >
                  Send
                </button>
              </form>
            </div>
          </div>
        )}

        {/* EDIT BALANCE / FUND GOAL */}
        <Dialog open={editBalanceOpen || fundGoalOpen} onOpenChange={(isOpen) => { setEditBalanceOpen(isOpen); setFundGoalOpen(isOpen); }}>
          <DialogContent className="sm:max-w-[320px] p-0 rounded-none border-0" style={{ background: '#111111', border: 'none' }}>
            <div style={{ padding: '24px' }}>
              <p style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', marginBottom: '4px' }}>
                {editBalanceOpen ? selectedAccount?.name : selectedGoal?.name}
              </p>
              <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '22px', fontWeight: 400, color: '#F5F5F5', marginBottom: '20px' }}>
                {editBalanceOpen ? 'Update Balance' : 'Add Funds'}
              </p>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', marginBottom: '20px' }} />
              <label style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', display: 'block', marginBottom: '8px' }}>Amount (IDR)</label>
              <input
                type="number"
                autoFocus
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                className="no-spinner"
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#F5F5F5', fontFamily: "'Cormorant Garamond', serif", fontSize: '28px', fontWeight: 300, padding: '10px 12px', outline: 'none', marginBottom: '20px', borderRadius: 0 }}
                onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => { setEditBalanceOpen(false); setFundGoalOpen(false); }}
                  style={{ flex: 1, padding: '10px', background: 'transparent', border: 'none', color: '#A0A0A0', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={editBalanceOpen ? handleUpdateBalance : handleFundGoal}
                  style={{ flex: 1, padding: '10px', background: '#4DA3E8', border: 'none', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  {editBalanceOpen ? 'Update' : 'Add Funds'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ASSET DIALOG */}
        <Dialog open={assetDialogOpen || editAssetOpen} onOpenChange={(isOpen) => { setAssetDialogOpen(isOpen); setEditAssetOpen(isOpen); }}>
          <DialogContent className="sm:max-w-[320px] p-0 rounded-none border-0" style={{ background: '#111111', border: 'none' }}>
            <div style={{ padding: '24px' }}>
              <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '22px', fontWeight: 400, color: '#F5F5F5', marginBottom: '20px' }}>
                {editAssetOpen ? 'Edit Asset' : 'Track Asset'}
              </p>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', marginBottom: '20px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', display: 'block', marginBottom: '6px' }}>Ticker Symbol</label>
                  <input value={assetSymbol} onChange={e => setAssetSymbol(e.target.value)} placeholder="e.g. BBCA.JK, BTC-USD, GC=F"
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#F5F5F5', fontFamily: "'SF Mono', monospace", fontSize: '14px', padding: '10px 12px', outline: 'none', borderRadius: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }} />
                  <p style={{ fontSize: '9px', color: '#606060', fontFamily: 'Inter, sans-serif', marginTop: '4px' }}>Source: Yahoo Finance · Auto-converted to IDR</p>
                </div>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', display: 'block', marginBottom: '6px' }}>Units Owned</label>
                  <input type="number" value={assetUnits} onChange={e => setAssetUnits(e.target.value)} placeholder="e.g. 100 or 0.5" className="no-spinner"
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#F5F5F5', fontFamily: "'Cormorant Garamond', serif", fontSize: '24px', fontWeight: 300, padding: '10px 12px', outline: 'none', borderRadius: 0 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => { setAssetDialogOpen(false); setEditAssetOpen(false); }}
                  style={{ flex: 1, padding: '10px', background: 'transparent', border: 'none', color: '#A0A0A0', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={editAssetOpen ? handleEditAsset : handleAddAsset}
                  style={{ flex: 1, padding: '10px', background: '#4DA3E8', border: 'none', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  {editAssetOpen ? 'Update' : 'Track'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* DELETE CONFIRM */}
        <Dialog open={deleteConfirm.isOpen} onOpenChange={(isOpen) => setDeleteConfirm(prev => ({ ...prev, isOpen }))}>
          <DialogContent className="sm:max-w-[320px] p-0 rounded-none border-0" style={{ background: '#111111', border: 'none' }}>
            <div style={{ padding: '24px' }}>
              <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '22px', fontWeight: 400, color: '#F5F5F5', marginBottom: '8px' }}>Confirm Delete</p>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', marginBottom: '16px' }} />
              <p style={{ fontSize: '12px', color: '#8A8A8A', fontFamily: 'Inter, sans-serif', lineHeight: 1.6, marginBottom: '24px' }}>
                This action <span style={{ color: '#E05C5C' }}>cannot be undone</span>. Balance will be restored automatically.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setDeleteConfirm({ isOpen: false, type: null, id: null })}
                  style={{ flex: 1, padding: '10px', background: 'transparent', border: 'none', color: '#A0A0A0', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={executeDelete} disabled={isDeleting}
                  style={{ flex: 1, padding: '10px', background: '#E05C5C', border: 'none', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: isDeleting ? 'not-allowed' : 'pointer', opacity: isDeleting ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                  {isDeleting && <Loader2 className="w-3 h-3 animate-spin" />}
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ADD BUDGET */}
        <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
          <DialogContent className="sm:max-w-[320px] p-0 rounded-none border-0" style={{ background: '#111111', border: 'none' }}>
            <div style={{ padding: '24px' }}>
              <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '22px', fontWeight: 400, color: '#F5F5F5', marginBottom: '20px' }}>New Spending Limit</p>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', marginBottom: '20px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', display: 'block', marginBottom: '6px' }}>Category</label>
                  <input value={newBudgetCategory} onChange={e => setNewBudgetCategory(e.target.value)} placeholder="e.g. Food, Transport"
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#F5F5F5', fontFamily: 'Inter, sans-serif', fontSize: '13px', padding: '10px 12px', outline: 'none', borderRadius: 0 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }} />
                </div>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', display: 'block', marginBottom: '6px' }}>Limit Amount (IDR)</label>
                  <input type="number" value={newBudgetAmount} onChange={e => setNewBudgetAmount(e.target.value)} placeholder="0" className="no-spinner"
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#F5F5F5', fontFamily: "'Cormorant Garamond', serif", fontSize: '24px', fontWeight: 300, padding: '10px 12px', outline: 'none', borderRadius: 0 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setBudgetDialogOpen(false)}
                  style={{ flex: 1, padding: '10px', background: 'transparent', border: 'none', color: '#A0A0A0', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleAddBudget}
                  style={{ flex: 1, padding: '10px', background: '#4DA3E8', border: 'none', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  Save
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ADD GOAL */}
        <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
          <DialogContent className="sm:max-w-[320px] p-0 rounded-none border-0" style={{ background: '#111111', border: 'none' }}>
            <div style={{ padding: '24px' }}>
              <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '22px', fontWeight: 400, color: '#F5F5F5', marginBottom: '20px' }}>New Target</p>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.07)', marginBottom: '20px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', display: 'block', marginBottom: '6px' }}>Target Name</label>
                  <input value={newGoalName} onChange={e => setNewGoalName(e.target.value)} placeholder="e.g. Emergency Fund"
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#F5F5F5', fontFamily: 'Inter, sans-serif', fontSize: '13px', padding: '10px 12px', outline: 'none', borderRadius: 0 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }} />
                </div>
                <div>
                  <label style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#606060', fontFamily: 'Inter, sans-serif', display: 'block', marginBottom: '6px' }}>Target Amount (IDR)</label>
                  <input type="number" value={newGoalTarget} onChange={e => setNewGoalTarget(e.target.value)} placeholder="0" className="no-spinner"
                    style={{ width: '100%', background: 'transparent', border: 'none', color: '#F5F5F5', fontFamily: "'Cormorant Garamond', serif", fontSize: '24px', fontWeight: 300, padding: '10px 12px', outline: 'none', borderRadius: 0 }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setGoalDialogOpen(false)}
                  style={{ flex: 1, padding: '10px', background: 'transparent', border: 'none', color: '#A0A0A0', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleAddGoal}
                  style={{ flex: 1, padding: '10px', background: '#4CAF85', border: 'none', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}>
                  Save
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      </div>
      <ChangePinDialog open={changePinOpen} onOpenChange={setChangePinOpen} />
      <TransactionDialog
        open={transactionDialogOpen}
        onOpenChange={(open) => {
          setTransactionDialogOpen(open);
          if (!open) setEditingTransaction(null);
        }}
        initialType={transactionDialogInitialType}
        accounts={accounts}
        onSubmitted={() => fetchData(false)}
        mode={mode}
        sessionId={sessionId}
        editTransaction={editingTransaction}
      />
    </div>
  );
}