'use client';

import { useState, useEffect } from 'react';
import { Loader2, Trash2, Play, Plus, RepeatIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface RecurringItem {
  id: string;
  name: string;
  amount: number;
  type: 'income' | 'expense';
  account_id: string | null;
  category_id: string | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  due_day: number;
  last_logged: string | null;
  is_active: boolean;
}

interface RecurringPanelProps {
  accounts: any[];
  onTransactionLogged: () => void;
}

const NO_SPINNER_CLASS =
  '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]';

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

function isDue(item: RecurringItem): boolean {
  const today = new Date();
  if (!item.last_logged) return true; // belum pernah dicatat → langsung due
  const last = new Date(item.last_logged);
  if (item.frequency === 'daily') {
    return today.toDateString() !== last.toDateString();
  }
  if (item.frequency === 'weekly') {
    const diff = (today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 7;
  }
  if (item.frequency === 'monthly') {
    return (
      today.getMonth() !== last.getMonth() ||
      today.getFullYear() !== last.getFullYear()
    );
  }
  if (item.frequency === 'yearly') {
    return today.getFullYear() !== last.getFullYear();
  }
  return false;
}

export default function RecurringPanel({ accounts, onTransactionLogged }: RecurringPanelProps) {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Form states
  const [formName, setFormName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formType, setFormType] = useState<'income' | 'expense'>('expense');
  const [formAccountId, setFormAccountId] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formFrequency, setFormFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [formDueDay, setFormDueDay] = useState('1');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [recRes, catRes] = await Promise.all([
        supabase.from('recurring_transactions').select('*').order('created_at', { ascending: false }),
        supabase.from('categories').select('*'),
      ]);
      if (recRes.data) setItems(recRes.data as RecurringItem[]);
      if (catRes.data) setCategories(catRes.data);
    } catch (e) {
      toast.error('Failed to load recurring transactions');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormName(''); setFormAmount(''); setFormType('expense');
    setFormAccountId(''); setFormCategoryId('');
    setFormFrequency('monthly'); setFormDueDay('1');
  };

  const handleAdd = async () => {
    if (!formName || !formAmount || !formAccountId) {
      return toast.error('Name, Amount, and Account are required.');
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('recurring_transactions').insert({
        name: formName,
        amount: Math.abs(Number(formAmount)),
        type: formType,
        account_id: formAccountId,
        category_id: formCategoryId || null,
        frequency: formFrequency,
        due_day: Number(formDueDay) || 1,
        is_active: true,
      });
      if (error) throw error;
      toast.success('Recurring transaction saved!');
      setDialogOpen(false);
      resetForm();
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogNow = async (item: RecurringItem) => {
    setLoggingId(item.id);
    try {
      const account = accounts.find(a => String(a.id) === String(item.account_id));
      if (!account) throw new Error('Account not found.');

      const finalAmount = item.type === 'expense' ? -Math.abs(item.amount) : Math.abs(item.amount);
      const today = format(new Date(), 'yyyy-MM-dd');

      // 1. Catat ke tabel transactions
      const { error: txErr } = await supabase.from('transactions').insert({
        account_id: item.account_id,
        category_id: item.category_id || null,
        amount: finalAmount,
        type: item.type,
        notes: item.name,
        transaction_date: today,
      });
      if (txErr) throw txErr;

      // 2. Update saldo akun
      const newBalance = Number(account.balance || 0) + finalAmount;
      await supabase.from('accounts').update({ balance: newBalance }).eq('id', item.account_id);

      // 3. Update last_logged di recurring
      await supabase
        .from('recurring_transactions')
        .update({ last_logged: today })
        .eq('id', item.id);

      toast.success(`"${item.name}" logged successfully!`);
      fetchAll();
      onTransactionLogged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to log.');
    } finally {
      setLoggingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await supabase.from('recurring_transactions').delete().eq('id', id);
      if (error) throw error;
      toast.success('Recurring transaction deleted.');
      fetchAll();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete.');
    } finally {
      setDeletingId(null);
    }
  };

  const dueItems = items.filter(i => i.is_active && isDue(i));
  const upcomingItems = items.filter(i => i.is_active && !isDue(i));

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('id-ID', { style: 'decimal', minimumFractionDigits: 0 }).format(n);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 space-y-6">

      {/* HEADER */}
      <div className="flex items-center justify-between border-b border-black dark:border-gray-700 pb-1 transition-colors duration-300">
        <h3 className="text-lg font-serif font-bold text-black dark:text-white transition-colors duration-300">
          Recurring
        </h3>
        <button
          onClick={() => { resetForm(); setDialogOpen(true); }}
          className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors duration-300 uppercase"
        >
          + Add Recurring
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* DUE NOW */}
          {dueItems.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                Due Now ({dueItems.length})
              </p>
              <div className="space-y-3">
                {dueItems.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-3 py-2.5 transition-colors duration-300"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="text-sm font-bold text-black dark:text-white truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-500 uppercase mt-0.5">
                        {FREQ_LABEL[item.frequency]} · {accounts.find(a => String(a.id) === String(item.account_id))?.name || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className={`text-sm font-bold ${item.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {item.type === 'expense' ? '-' : '+'}{formatCurrency(item.amount)}
                      </p>
                      <button
                        onClick={() => handleLogNow(item)}
                        disabled={loggingId === item.id}
                        className="flex items-center gap-1 bg-black dark:bg-white text-white dark:text-black px-2 py-1 text-[10px] font-bold uppercase hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors disabled:opacity-50"
                      >
                        {loggingId === item.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Play className="w-3 h-3" />}
                        Log
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={deletingId === item.id}
                        className="text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* UPCOMING */}
          {upcomingItems.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">
                Upcoming
              </p>
              <div className="space-y-2">
                {upcomingItems.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2 transition-colors duration-300 group"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="text-sm font-bold text-black dark:text-white truncate">{item.name}</p>
                      <p className="text-[10px] text-gray-500 uppercase mt-0.5">
                        {FREQ_LABEL[item.frequency]} · Last: {item.last_logged
                          ? new Date(item.last_logged).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
                          : 'Never'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className={`text-sm font-bold ${item.type === 'income' ? 'text-green-600 dark:text-green-400' : 'text-black dark:text-white'}`}>
                        {item.type === 'expense' ? '-' : '+'}{formatCurrency(item.amount)}
                      </p>
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={deletingId === item.id}
                        className="text-red-400/50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* EMPTY STATE */}
          {items.length === 0 && (
            <div className="text-center py-10 border border-dashed border-gray-200 dark:border-gray-800">
              <RepeatIcon className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500 font-serif">No recurring transactions yet.</p>
              <p className="text-[11px] text-gray-400 mt-1">Add bills, subscriptions, or salary.</p>
            </div>
          )}
        </>
      )}

      {/* ADD DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[400px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none shadow-2xl transition-colors duration-300">
          <DialogHeader>
            <DialogTitle className="text-xl font-serif font-black border-b border-black dark:border-white pb-3 transition-colors duration-300 uppercase">
              New Recurring
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">

            {/* NAME */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Name</label>
              <Input
                placeholder="e.g. Spotify, Gaji, Cicilan KPR"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                className="bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white text-sm"
              />
            </div>

            {/* TYPE + AMOUNT */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Type</label>
                <Select value={formType} onValueChange={(v: any) => setFormType(v)}>
                  <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none">
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Amount (IDR)</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={formAmount}
                  onChange={e => setFormAmount(e.target.value)}
                  className={cn(
                    'bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white text-sm font-bold',
                    NO_SPINNER_CLASS
                  )}
                />
              </div>
            </div>

            {/* ACCOUNT */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Account</label>
              <Select value={formAccountId} onValueChange={setFormAccountId}>
                <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none max-h-40">
                  {accounts.map(acc => (
                    <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* CATEGORY */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Category (optional)</label>
              <Select value={formCategoryId} onValueChange={setFormCategoryId}>
                <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none max-h-40">
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* FREQUENCY + DUE DAY */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">Frequency</label>
                <Select value={formFrequency} onValueChange={(v: any) => setFormFrequency(v)}>
                  <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none">
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase text-gray-500 tracking-wide">
                  {formFrequency === 'monthly' ? 'Due Date (day)' : formFrequency === 'yearly' ? 'Due Month' : 'Every (N)'}
                </label>
                <Input
                  type="number"
                  placeholder={formFrequency === 'monthly' ? '1–31' : '1'}
                  value={formDueDay}
                  onChange={e => setFormDueDay(e.target.value)}
                  className={cn(
                    'bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white text-sm',
                    NO_SPINNER_CLASS
                  )}
                />
              </div>
            </div>

          </div>

          <div className="flex gap-3 mt-2 border-t border-gray-200 dark:border-gray-800 pt-4 transition-colors duration-300">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="flex-1 rounded-none border-gray-300 dark:border-gray-700 text-black dark:text-white font-bold hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={isSubmitting}
              className="flex-1 rounded-none bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 font-bold transition-colors"
            >
              {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : null}
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
