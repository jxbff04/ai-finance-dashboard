'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Calendar as CalendarIcon, Loader2, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType: 'income' | 'expense' | 'transfer';
  accounts: any[];
  onSubmitted: () => void;
}

const NO_SPINNER_CLASS =
  '[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]';

// ─── SMART LINK: pure client-side, no AI API needed ──────────────────────────
async function runSmartLink({
  notes,
  category_name,
  amount,
  type,
  month,
}: {
  notes: string;
  category_name: string;
  amount: number;
  type: string;
  month: string;
}) {
  try {
    const [goalsRes, budgetsRes] = await Promise.all([
      supabase.from('goals').select('id, name, current_amount, target_amount'),
      supabase.from('budgets').select('id, category_name, amount').eq('month', month),
    ]);

    const goals = goalsRes.data || [];
    const budgets = budgetsRes.data || [];

    const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n);

    // ── GOAL MATCHING ──────────────────────────────────────────────────────────
    // Semua tipe transaksi bisa di-link ke goal
    if (goals.length > 0) {
      const keyword = (notes + ' ' + category_name).toLowerCase();

      // Cari goal yang namanya mirip dengan notes/kategori transaksi
      let matched: any = goals.find((g: any) =>
        keyword.includes(g.name.toLowerCase()) ||
        g.name.toLowerCase().split(' ').some((word: string) =>
          word.length > 3 && keyword.includes(word)
        )
      );

      // Jika tidak ada nama yang mirip → pilih goal dengan progress % terendah
      if (!matched) {
        matched = goals.reduce((prev: any, curr: any) => {
          const prevPct = Number(prev.current_amount) / Number(prev.target_amount);
          const currPct = Number(curr.current_amount) / Number(curr.target_amount);
          return currPct < prevPct ? curr : prev;
        });
      }

      if (matched) {
        const newAmount = Number(matched.current_amount) + Math.abs(amount);
        const { error } = await supabase
          .from('goals')
          .update({ current_amount: newAmount })
          .eq('id', matched.id);

        if (!error) {
          toast.success(
            `🎯 ${fmt(Math.abs(amount))} ditambahkan ke goal "${matched.name}"`,
            { duration: 5000 }
          );
        }
      }
    }

    // ── BUDGET MATCHING ────────────────────────────────────────────────────────
    // Hanya expense yang dihitung ke budget
    if (budgets.length > 0 && type === 'expense') {
      const keyword = (notes + ' ' + category_name).toLowerCase();
      const matched = budgets.find((b: any) =>
        keyword.includes(b.category_name.toLowerCase()) ||
        b.category_name.toLowerCase().split(' ').some((word: string) =>
          word.length > 3 && keyword.includes(word)
        )
      );

      if (matched) {
        toast.info(
          `📊 Transaksi terhitung di budget "${matched.category_name}"`,
          { duration: 4000 }
        );
      }
    }
  } catch (e: any) {
    console.error('[smart-link] silent fail:', e.message);
  }
}
// ──────────────────────────────────────────────────────────────────────────────

export default function TransactionDialog({
  open,
  onOpenChange,
  initialType,
  accounts,
  onSubmitted,
}: TransactionDialogProps) {
  const [type, setType] = useState(initialType);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');

  const [aiPrompt, setAiPrompt] = useState('');
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      setType(initialType);
      setAmount(''); setNotes(''); setAiPrompt('');
      setAccountId(''); setCategoryId(''); setToAccountId('');
      setDate(new Date());
      fetchCategories();
    }
  }, [open, initialType]);

  useEffect(() => {
    if (type !== 'transfer') setToAccountId('');
  }, [type]);

  const fetchCategories = async () => {
    const { data } = await supabase.from('categories').select('*');
    if (data) setCategories(data);
  };

  const handleAutoFill = async () => {
    if (!aiPrompt.trim()) return;
    setIsLoadingAI(true);
    try {
      const res = await fetch('/api/parse-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiPrompt }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setType(data.type);
      setAmount(String(data.amount));
      setNotes(data.notes);
      if (data.date) setDate(new Date(data.date));
      if (data.account_name) {
        const m = accounts.find(a => a.name.toLowerCase().includes(data.account_name.toLowerCase()));
        if (m) setAccountId(String(m.id));
      }
      if (data.category_name) {
        const m = categories.find(c => c.name.toLowerCase().includes(data.category_name.toLowerCase()));
        if (m) setCategoryId(String(m.id));
      }
      toast.success('Auto-filled successfully.');
    } catch (err: any) {
      toast.error(err.message || 'Auto-fill failed.');
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleSubmit = async () => {
    if (!amount || !accountId || !date)
      return toast.error('Amount, Account, and Date are required.');

    if (type === 'transfer') {
      if (!toAccountId) return toast.error('Destination account is required.');
      if (toAccountId === accountId) return toast.error('Source and destination cannot be the same.');
    }

    setIsSubmitting(true);
    try {
      const absAmount = Math.abs(Number(amount));
      const dateStr = format(date, 'yyyy-MM-dd');
      const month = format(date, 'yyyy-MM');
      const selectedCategory = categories.find(c => String(c.id) === categoryId);
      const categoryName = selectedCategory?.name || '';

      if (type === 'transfer') {
        const sourceAccount = accounts.find(a => String(a.id) === accountId);
        const destAccount = accounts.find(a => String(a.id) === toAccountId);
        if (!sourceAccount || !destAccount) throw new Error('Account not found.');

        const transferNote = notes || `Transfer: ${sourceAccount.name} → ${destAccount.name}`;

        const { error: outErr } = await supabase.from('transactions').insert({
          account_id: accountId, category_id: null,
          amount: -absAmount, type: 'transfer',
          notes: transferNote, transaction_date: dateStr,
        });
        if (outErr) throw outErr;

        const { error: inErr } = await supabase.from('transactions').insert({
          account_id: toAccountId, category_id: null,
          amount: absAmount, type: 'transfer',
          notes: transferNote, transaction_date: dateStr,
        });
        if (inErr) throw inErr;

        await supabase.from('accounts')
          .update({ balance: Number(sourceAccount.balance || 0) - absAmount })
          .eq('id', accountId);
        await supabase.from('accounts')
          .update({ balance: Number(destAccount.balance || 0) + absAmount })
          .eq('id', toAccountId);

        toast.success('Transfer logged — both wallets updated!');
        onSubmitted();
        onOpenChange(false);

        // Smart-link background
        runSmartLink({ notes: transferNote, category_name: 'Transfer', amount: absAmount, type, month });

      } else {
        const finalAmount = type === 'expense' ? -absAmount : absAmount;

        const { error: txErr } = await supabase.from('transactions').insert({
          account_id: accountId, category_id: categoryId || null,
          amount: finalAmount, type, notes, transaction_date: dateStr,
        });
        if (txErr) throw txErr;

        const targetAccount = accounts.find(a => String(a.id) === accountId);
        if (targetAccount) {
          await supabase.from('accounts').update({
            balance: Number(targetAccount.balance || 0) + finalAmount,
          }).eq('id', accountId);
        }

        toast.success('Transaction logged.');
        onSubmitted();
        onOpenChange(false);

        // Smart-link background
        runSmartLink({ notes, category_name: categoryName, amount: absAmount, type, month });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to log transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isTransfer = type === 'transfer';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none shadow-2xl transition-colors duration-300">
        <DialogHeader>
          <DialogTitle className="text-2xl font-serif font-black border-b border-black dark:border-white pb-3 transition-colors duration-300 uppercase">
            New Entry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">

          {/* AI AUTO-FILL */}
          <div className="space-y-2 bg-gray-50 dark:bg-[#111] p-3 border border-gray-200 dark:border-gray-800 transition-colors duration-300">
            <Textarea
              placeholder="e.g. Bought lunch for 45k using Gopay..."
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              className="resize-none bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-300 dark:border-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-600 rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white font-serif transition-colors duration-300"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAutoFill} disabled={isLoadingAI}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-none border-0 uppercase font-bold text-[10px] tracking-wide h-7">
                {isLoadingAI
                  ? <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  : <Sparkles className="w-3 h-3 mr-2" />}
                {isLoadingAI ? 'Processing...' : 'AI AUTO-FILL'}
              </Button>
            </div>
          </div>

          {/* TYPE & DATE */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Type</label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0 focus:border-black dark:focus:border-white transition-colors duration-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none">
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 flex flex-col">
              <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn(
                    'w-full justify-start text-left font-normal bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white rounded-none hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors duration-300',
                    !date && 'text-gray-500'
                  )}>
                    <CalendarIcon className="mr-2 h-4 w-4 text-gray-500 shrink-0" />
                    {date ? format(date, 'd MMM yy', { locale: idLocale }) : 'Pick date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-white dark:bg-[#111] border-gray-200 dark:border-gray-800 rounded-none">
                  <Calendar mode="single" selected={date} onSelect={setDate} locale={idLocale} initialFocus className="rounded-none" />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* AMOUNT */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Amount (IDR)</label>
            <Input
              type="number" placeholder="0" value={amount}
              onChange={e => setAmount(e.target.value)}
              className={cn(
                'bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white rounded-none transition-colors duration-300 text-lg font-bold',
                NO_SPINNER_CLASS
              )}
            />
          </div>

          {/* ACCOUNT(S) */}
          {isTransfer ? (
            <div className="space-y-2">
              <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Transfer Route</label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0 focus:border-black dark:focus:border-white transition-colors duration-300">
                      <SelectValue placeholder="From..." />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none max-h-48">
                      {accounts.map(acc => (
                        <SelectItem key={acc.id} value={String(acc.id)} disabled={String(acc.id) === toAccountId}>
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="flex-1">
                  <Select value={toAccountId} onValueChange={setToAccountId}>
                    <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0 focus:border-black dark:focus:border-white transition-colors duration-300">
                      <SelectValue placeholder="To..." />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none max-h-48">
                      {accounts.map(acc => (
                        <SelectItem key={acc.id} value={String(acc.id)} disabled={String(acc.id) === accountId}>
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {accountId && toAccountId && amount && (() => {
                const src = accounts.find(a => String(a.id) === accountId);
                const dst = accounts.find(a => String(a.id) === toAccountId);
                const amt = Math.abs(Number(amount));
                if (!src || !dst) return null;
                const srcAfter = Number(src.balance || 0) - amt;
                const dstAfter = Number(dst.balance || 0) + amt;
                const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n);
                return (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-2 text-[10px] text-blue-700 dark:text-blue-300 font-mono">
                    {src.name}: {fmt(Number(src.balance || 0))} → <strong className={srcAfter < 0 ? 'text-red-500' : ''}>{fmt(srcAfter)}</strong>
                    {'   |   '}
                    {dst.name}: {fmt(Number(dst.balance || 0))} → <strong>{fmt(dstAfter)}</strong>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Account</label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0 focus:border-black dark:focus:border-white transition-colors duration-300">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none max-h-48">
                    {accounts.map(acc => (
                      <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Category</label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 rounded-none focus:ring-0 focus:border-black dark:focus:border-white transition-colors duration-300">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-200 dark:border-gray-800 rounded-none max-h-48">
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* NOTES */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Notes</label>
            <Input
              placeholder={isTransfer ? 'e.g. Top up GoPay from BCA' : 'Lunch, Coffee, etc.'}
              value={notes} onChange={e => setNotes(e.target.value)}
              className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white rounded-none transition-colors duration-300"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-2 border-t border-gray-200 dark:border-gray-800 pt-5 transition-colors duration-300">
          <Button variant="outline" onClick={() => onOpenChange(false)}
            className="rounded-none border-gray-300 dark:border-gray-700 text-black dark:text-gray-300 font-bold hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors duration-300">
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}
            className="rounded-none bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 font-bold transition-colors duration-300">
            {isSubmitting
              ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Saving...</>
              : isTransfer ? 'Execute Transfer' : 'Log Transaction'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
