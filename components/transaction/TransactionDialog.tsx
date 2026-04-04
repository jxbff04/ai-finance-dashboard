'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Calendar as CalendarIcon, Loader2, ArrowRight, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export interface TransactionToEdit {
  id: string;
  account_id: string;
  amount: number | string;
  type: 'income' | 'expense' | 'transfer';
  notes: string;
  category: string;
  transaction_date: string;
}

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType: 'income' | 'expense' | 'transfer';
  accounts: any[];
  onSubmitted: () => void;
  editTransaction?: TransactionToEdit | null;
  mode?: 'guest' | 'private' | null;
  sessionId?: string | null;
}

const inputStyle = {
  width: '100%',
  background: '#0A0A0A',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#F5F5F5',
  fontFamily: 'Inter, sans-serif',
  fontSize: '13px',
  padding: '10px 12px',
  outline: 'none',
  transition: 'border-color 200ms ease-out',
  borderRadius: 0,
};

const labelStyle = {
  fontSize: '9px',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: '#606060',
  fontFamily: 'Inter, sans-serif',
  marginBottom: '6px',
  display: 'block',
};

const selectStyle = {
  width: '100%',
  background: '#0A0A0A',
  border: '1px solid rgba(255,255,255,0.10)',
  color: '#F5F5F5',
  fontFamily: 'Inter, sans-serif',
  fontSize: '13px',
  padding: '10px 12px',
  outline: 'none',
  cursor: 'pointer',
  borderRadius: 0,
};

async function runSmartLink({ notes, category_name, amount, type, month }: { notes: string; category_name: string; amount: number; type: string; month: string }) {
  try {
    const [goalsRes, budgetsRes] = await Promise.all([
      supabase.from('goals').select('id, name, current_amount, target_amount'),
      supabase.from('budgets').select('id, category_name, amount').eq('month', month),
    ]);
    const goals = goalsRes.data || [];
    const budgets = budgetsRes.data || [];
    const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n);
    if (goals.length > 0) {
      const keyword = (notes + ' ' + category_name).toLowerCase();
      let matched: any = goals.find((g: any) => keyword.includes(g.name.toLowerCase()) || g.name.toLowerCase().split(' ').some((w: string) => w.length > 3 && keyword.includes(w)));
      if (!matched) matched = goals.reduce((prev: any, curr: any) => (Number(curr.current_amount) / Math.max(Number(curr.target_amount), 1)) < (Number(prev.current_amount) / Math.max(Number(prev.target_amount), 1)) ? curr : prev);
      if (matched) {
        const { error } = await supabase.from('goals').update({ current_amount: Number(matched.current_amount) + Math.abs(amount) }).eq('id', matched.id);
        if (!error) toast.success(`🎯 ${fmt(Math.abs(amount))} → "${matched.name}"`, { duration: 5000 });
      }
    }
    if (budgets.length > 0 && type === 'expense') {
      const keyword = (notes + ' ' + category_name).toLowerCase();
      const matched = budgets.find((b: any) => keyword.includes(b.category_name.toLowerCase()) || b.category_name.toLowerCase().split(' ').some((w: string) => w.length > 3 && keyword.includes(w)));
      if (matched) toast.info(`📊 Linked to "${matched.category_name}"`, { duration: 4000 });
    }
  } catch (e: any) { console.error('[smart-link]', e.message); }
}

// ─── BUDGET OVERRUN CHECK ─────────────────────────────────────────────────
async function checkBudgetOverrun({
  category_name,
  amount,
  month,
}: {
  category_name: string;
  amount: number;
  month: string;
}) {
  try {
    if (!category_name || category_name === 'General') return;

    // Ambil budget untuk kategori ini
    const { data: budgets } = await supabase
      .from('budgets')
      .select('id, category_name, amount')
      .eq('month', month)
      .ilike('category_name', category_name);

    if (!budgets || budgets.length === 0) return;

    const budget = budgets[0];

    // Hitung total expense kategori ini bulan ini
    const { data: txs } = await supabase
      .from('transactions')
      .select('amount')
      .eq('type', 'expense')
      .gte('transaction_date', `${month}-01`)
      .lte('transaction_date', `${month}-31`);

    if (!txs) return;

    // Filter by category — ambil dari categories table
    const { data: cats } = await supabase
      .from('categories')
      .select('id')
      .ilike('name', category_name);

    if (!cats || cats.length === 0) return;

    const catId = cats[0].id;

    const { data: catTxs } = await supabase
      .from('transactions')
      .select('amount')
      .eq('type', 'expense')
      .eq('category_id', catId)
      .gte('transaction_date', `${month}-01`)
      .lte('transaction_date', `${month}-31`);

    if (!catTxs) return;

    const totalSpent = catTxs.reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
    const budgetLimit = Number(budget.amount);
    const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n);

    if (totalSpent > budgetLimit) {
      // Sudah over budget
      const overBy = totalSpent - budgetLimit;
      toast.warning(
        `⚠️ Budget "${budget.category_name}" terlampaui ${fmt(overBy)} dari limit ${fmt(budgetLimit)}`,
        { duration: 6000 }
      );
    } else if (totalSpent / budgetLimit >= 0.8) {
      // Mendekati 80%
      const remaining = budgetLimit - totalSpent;
      toast.warning(
        `📊 Budget "${budget.category_name}" tersisa ${fmt(remaining)} (${((totalSpent / budgetLimit) * 100).toFixed(0)}% terpakai)`,
        { duration: 5000 }
      );
    }
  } catch (e: any) {
    console.error('[budget-check] silent fail:', e.message);
  }
}

export default function TransactionDialog({ open, onOpenChange, initialType, accounts, onSubmitted, editTransaction, mode, sessionId }: TransactionDialogProps) {
  const isEditMode = !!editTransaction;
  const isGuest = mode === 'guest';

  const [type, setType] = useState<'income' | 'expense' | 'transfer'>(initialType);
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
  const [dateOpen, setDateOpen] = useState(false);

  useEffect(() => {
    if (open) {
      if (!isGuest) fetchCategories();
      if (isEditMode && editTransaction) {
        setType(editTransaction.type);
        setAmount(String(Math.abs(Number(editTransaction.amount))));
        setNotes(editTransaction.notes || '');
        setAccountId(editTransaction.account_id);
        setToAccountId(''); setAiPrompt('');
        const d = new Date(editTransaction.transaction_date);
        setDate(isNaN(d.getTime()) ? new Date() : d);
        fetchCategories().then(cats => {
          const m = cats.find((c: any) => c.name.toLowerCase() === editTransaction.category.toLowerCase());
          setCategoryId(m ? String(m.id) : '');
        });
      } else {
        setType(initialType); setAmount(''); setNotes(''); setAiPrompt('');
        setAccountId(''); setCategoryId(''); setToAccountId(''); setDate(new Date());
      }
    }
  }, [open, initialType, isEditMode, editTransaction, isGuest]);

  useEffect(() => { if (type !== 'transfer') setToAccountId(''); }, [type]);

  const fetchCategories = async (): Promise<any[]> => {
    const { data } = await supabase.from('categories').select('*');
    if (data) { setCategories(data); return data; }
    return [];
  };

  const handleAutoFill = async () => {
    if (!aiPrompt.trim()) return;
    setIsLoadingAI(true);
    try {
      const res = await fetch('/api/parse-transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: aiPrompt }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setType(data.type); setAmount(String(data.amount)); setNotes(data.notes);
      if (data.date) setDate(new Date(data.date));
      if (data.account_name) { const m = accounts.find(a => a.name.toLowerCase().includes(data.account_name.toLowerCase())); if (m) setAccountId(String(m.id)); }
      if (data.category_name && !isGuest) { const m = categories.find(c => c.name.toLowerCase().includes(data.category_name.toLowerCase())); if (m) setCategoryId(String(m.id)); }
      toast.success('Auto-filled.');
    } catch (err: any) { toast.error(err.message || 'Auto-fill failed.'); }
    finally { setIsLoadingAI(false); }
  };

  const handleGuestSubmit = async () => {
    if (!amount || !accountId || !date) return toast.error('Fill required fields.');
    setIsSubmitting(true);
    try {
      const absAmount = Math.abs(Number(amount));
      const finalAmount = type === 'expense' ? -absAmount : absAmount;
      const { error } = await supabase.from('guest_transactions').insert({ session_id: sessionId, account_id: accountId, amount: finalAmount, type, notes: notes || '', category: 'General', transaction_date: format(date!, 'yyyy-MM-dd') });
      if (error) throw error;
      const acc = accounts.find(a => String(a.id) === accountId);
      if (acc) await supabase.from('guest_accounts').update({ balance: Number(acc.balance || 0) + finalAmount }).eq('id', accountId);
      toast.success('Logged.'); onSubmitted(); onOpenChange(false);
    } catch (err: any) { toast.error(err.message || 'Failed.'); }
    finally { setIsSubmitting(false); }
  };

  const handleEditSubmit = async () => {
    if (!amount || !accountId || !date || !editTransaction) return toast.error('Fill required fields.');
    setIsSubmitting(true);
    try {
      const absAmount = Math.abs(Number(amount));
      const finalAmount = type === 'expense' ? -absAmount : absAmount;
      const oldAmount = Number(editTransaction.amount);
      const { data: oldAcc } = await supabase.from('accounts').select('balance').eq('id', editTransaction.account_id).single();
      if (oldAcc) await supabase.from('accounts').update({ balance: Number(oldAcc.balance) - oldAmount }).eq('id', editTransaction.account_id);
      const { data: newAcc } = await supabase.from('accounts').select('balance').eq('id', accountId).single();
      if (newAcc) await supabase.from('accounts').update({ balance: Number(newAcc.balance) + finalAmount }).eq('id', accountId);
      const { error } = await supabase.from('transactions').update({ account_id: accountId, category_id: categoryId || null, amount: finalAmount, type, notes, transaction_date: format(date!, 'yyyy-MM-dd') }).eq('id', editTransaction.id);
      if (error) throw error;
      toast.success('Updated.'); onSubmitted(); onOpenChange(false);
    } catch (err: any) { toast.error(err.message || 'Failed.'); }
    finally { setIsSubmitting(false); }
  };

  const handlePrivateSubmit = async () => {
    if (!amount || !accountId || !date) return toast.error('Fill required fields.');
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return toast.error('Select valid destination.');
    setIsSubmitting(true);
    try {
      const absAmount = Math.abs(Number(amount));
      const dateStr = format(date!, 'yyyy-MM-dd');
      const month = format(date!, 'yyyy-MM');
      const categoryName = categories.find(c => String(c.id) === categoryId)?.name || '';
      if (type === 'transfer') {
        const src = accounts.find(a => String(a.id) === accountId);
        const dst = accounts.find(a => String(a.id) === toAccountId);
        if (!src || !dst) throw new Error('Account not found.');
        const note = notes || `Transfer: ${src.name} → ${dst.name}`;
        await supabase.from('transactions').insert({ account_id: accountId, category_id: null, amount: -absAmount, type: 'transfer', notes: note, transaction_date: dateStr });
        await supabase.from('transactions').insert({ account_id: toAccountId, category_id: null, amount: absAmount, type: 'transfer', notes: note, transaction_date: dateStr });
        await supabase.from('accounts').update({ balance: Number(src.balance || 0) - absAmount }).eq('id', accountId);
        await supabase.from('accounts').update({ balance: Number(dst.balance || 0) + absAmount }).eq('id', toAccountId);
        toast.success('Transfer complete.'); onSubmitted(); onOpenChange(false);
        runSmartLink({ notes: note, category_name: 'Transfer', amount: absAmount, type, month });
      } else {
        const finalAmount = type === 'expense' ? -absAmount : absAmount;
        const { error } = await supabase.from('transactions').insert({ account_id: accountId, category_id: categoryId || null, amount: finalAmount, type, notes, transaction_date: dateStr });
        if (error) throw error;
        const acc = accounts.find(a => String(a.id) === accountId);
        if (acc) await supabase.from('accounts').update({ balance: Number(acc.balance || 0) + finalAmount }).eq('id', accountId);
        toast.success('Logged.'); onSubmitted(); onOpenChange(false);
        runSmartLink({ notes, category_name: categoryName, amount: absAmount, type, month });
        if (type === 'expense' && categoryName) {
          checkBudgetOverrun({ category_name: categoryName, amount: absAmount, month });
        }
      }
    } catch (err: any) { toast.error(err.message || 'Failed.'); }
    finally { setIsSubmitting(false); }
  };

  const handleSubmit = isEditMode ? handleEditSubmit : isGuest ? handleGuestSubmit : handlePrivateSubmit;
  const isTransfer = type === 'transfer';
  const submitBg = isEditMode ? '#4DA3E8' : type === 'income' ? '#4CAF85' : type === 'transfer' ? '#4DA3E8' : '#E05C5C';
  const amountColor = type === 'income' ? '#4CAF85' : type === 'transfer' ? '#4DA3E8' : '#F5F5F5';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] p-0 rounded-none border-0 shadow-2xl [&>button]:hidden" style={{ background: '#0A0A0A', border: 'none' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ ...labelStyle, marginBottom: '4px' }}>{isEditMode ? 'Edit Entry' : isGuest ? 'Guest Mode' : 'New Entry'}</p>
            <h2 style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: '24px', fontWeight: 400, color: '#F5F5F5', lineHeight: 1 }}>
              {isEditMode ? 'Edit Transaction' : 'Log Transaction'}
            </h2>
          </div>
          <button onClick={() => onOpenChange(false)} style={{ color: '#606060', background: 'none', border: 'none', cursor: 'pointer', padding: '2px', transition: 'color 200ms' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#F5F5F5'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#606060'; }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '70vh', overflowY: 'auto' }}>

          {/* AI FILL */}
          {!isEditMode && !isGuest && (
            <div style={{ background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.07)', padding: '12px' }}>
              <textarea placeholder="e.g. Makan siang 45k pakai Gopay..." value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={2}
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#A0A0A0', fontFamily: "'Cormorant Garamond', serif", fontSize: '14px', resize: 'none', outline: 'none', lineHeight: 1.5 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button onClick={handleAutoFill} disabled={isLoadingAI}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', background: '#4DA3E8', color: '#fff', fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', border: 'none', cursor: 'pointer', opacity: isLoadingAI ? 0.5 : 1 }}>
                  {isLoadingAI ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {isLoadingAI ? 'Processing' : 'AI Fill'}
                </button>
              </div>
            </div>
          )}

          {/* TYPE */}
          <div>
            <label style={labelStyle}>Type</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['expense', 'income', ...(isGuest ? [] : ['transfer'])] as string[]).map(t => {
                const colors: Record<string, string> = { expense: '#E05C5C', income: '#4CAF85', transfer: '#4DA3E8' };
                const active = type === t;
                return (
                  <button key={t} onClick={() => setType(t as any)}
                    style={{ flex: 1, padding: '8px', background: active ? colors[t] : 'transparent', border: `1px solid ${active ? colors[t] : 'rgba(255,255,255,0.10)'}`, color: active ? '#fff' : '#606060', fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer', transition: 'all 200ms' }}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* AMOUNT */}
          <div>
            <label style={labelStyle}>Amount (IDR)</label>
            <input type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} className="no-spinner"
              style={{ ...inputStyle, fontSize: '24px', fontFamily: "'Cormorant Garamond', serif", fontWeight: 300, color: amountColor }}
              onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }} />
          </div>

          {/* DATE */}
          <div>
            <label style={labelStyle}>Date</label>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <button style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', textAlign: 'left' }}>
                  <CalendarIcon style={{ width: 13, height: 13, color: '#606060', flexShrink: 0 }} />
                  <span style={{ color: date ? '#F5F5F5' : '#606060', fontFamily: 'Inter, sans-serif', fontSize: '13px' }}>
                    {date ? format(date, 'd MMMM yyyy', { locale: idLocale }) : 'Pick date'}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-none" style={{ background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.12)' }}>
                <Calendar mode="single" selected={date} onSelect={d => { setDate(d); setDateOpen(false); }} locale={idLocale} initialFocus />
              </PopoverContent>
            </Popover>
          </div>

          {/* ACCOUNTS */}
          {isTransfer && !isGuest ? (
            <div>
              <label style={labelStyle}>Transfer Route</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select value={accountId} onChange={e => setAccountId(e.target.value)} style={selectStyle}>
                  <option value="">From...</option>
                  {accounts.map(a => <option key={a.id} value={String(a.id)} disabled={String(a.id) === toAccountId}>{a.name}</option>)}
                </select>
                <ArrowRight style={{ width: 14, height: 14, color: '#606060', flexShrink: 0 }} />
                <select value={toAccountId} onChange={e => setToAccountId(e.target.value)} style={selectStyle}>
                  <option value="">To...</option>
                  {accounts.map(a => <option key={a.id} value={String(a.id)} disabled={String(a.id) === accountId}>{a.name}</option>)}
                </select>
              </div>
              {accountId && toAccountId && amount && (() => {
                const src = accounts.find(a => String(a.id) === accountId);
                const dst = accounts.find(a => String(a.id) === toAccountId);
                const amt = Math.abs(Number(amount));
                if (!src || !dst) return null;
                const fmt = (n: number) => new Intl.NumberFormat('id-ID').format(n);
                const srcAfter = Number(src.balance || 0) - amt;
                return (
                  <div style={{ marginTop: '8px', padding: '8px 12px', background: '#0A0A0A', border: '1px solid rgba(77,163,232,0.2)', fontSize: '10px', color: '#606060', fontFamily: "'SF Mono', monospace" }}>
                    {src.name} <span style={{ color: srcAfter < 0 ? '#E05C5C' : '#4CAF85' }}>{fmt(srcAfter)}</span>
                    {'  →  '}
                    {dst.name} <span style={{ color: '#4CAF85' }}>{fmt(Number(dst.balance || 0) + amt)}</span>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isGuest ? '1fr' : '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={labelStyle}>Account</label>
                <select value={accountId} onChange={e => setAccountId(e.target.value)} style={selectStyle}>
                  <option value="">Select...</option>
                  {accounts.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                </select>
              </div>
              {!isGuest && (
                <div>
                  <label style={labelStyle}>Category</label>
                  <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={selectStyle}>
                    <option value="">Select...</option>
                    {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* NOTES */}
          <div>
            <label style={labelStyle}>Notes</label>
            <input type="text" placeholder={isTransfer ? 'e.g. Top up GoPay' : 'e.g. Makan siang'} value={notes} onChange={e => setNotes(e.target.value)}
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = '#4DA3E8'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'; }} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '8px' }}>
          <button onClick={() => onOpenChange(false)}
            style={{ flex: 1, padding: '11px', background: 'transparent', border: '1px solid rgba(255,255,255,0.10)', color: '#A0A0A0', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: 'pointer', transition: 'all 200ms' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#F5F5F5'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.25)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#A0A0A0'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.10)'; }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting}
            style={{ flex: 2, padding: '11px', background: submitBg, border: 'none', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'opacity 200ms' }}>
            {isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
            {isSubmitting ? 'Saving...' : isEditMode ? 'Save Changes' : isTransfer && !isGuest ? 'Execute Transfer' : 'Log Transaction'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
