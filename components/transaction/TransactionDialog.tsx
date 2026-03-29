'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
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

export default function TransactionDialog({ open, onOpenChange, initialType, accounts, onSubmitted }: TransactionDialogProps) {
  const [type, setType] = useState(initialType);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  
  const [aiPrompt, setAiPrompt] = useState('');
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);

  useEffect(() => {
    if (open) {
      setType(initialType);
      setAmount(''); setNotes(''); setAiPrompt(''); setAccountId(''); setCategoryId('');
      setDate(new Date());
      fetchCategories();
    }
  }, [open, initialType]);

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
        body: JSON.stringify({ text: aiPrompt })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setType(data.type);
      setAmount(String(data.amount));
      setNotes(data.notes);
      
      if (data.date) { setDate(new Date(data.date)); }

      if (data.account_name) {
        const matchedAcc = accounts.find(a => a.name.toLowerCase().includes(data.account_name.toLowerCase()));
        if (matchedAcc) setAccountId(String(matchedAcc.id));
      }
      if (data.category_name) {
        const matchedCat = categories.find(c => c.name.toLowerCase().includes(data.category_name.toLowerCase()));
        if (matchedCat) setCategoryId(String(matchedCat.id));
      }
      
      toast.success('Auto-filled successfully.');
    } catch (err: any) {
      toast.error(err.message || 'Auto-fill failed.');
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleSubmit = async () => {
    if (!amount || !accountId || !date) return toast.error('Amount, Account, and Date are required.');
    setIsSubmitting(true);
    try {
      const finalAmount = type === 'expense' ? -Math.abs(Number(amount)) : Math.abs(Number(amount));

      const { error } = await supabase.from('transactions').insert({
        account_id: accountId,
        category_id: categoryId || null,
        amount: finalAmount,
        type,
        notes,
        transaction_date: format(date, 'yyyy-MM-dd')
      });
      if (error) throw error;
      toast.success('Transaction logged.');
      onSubmitted();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to log transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-white dark:bg-[#0a0a0a] border border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none shadow-2xl transition-colors duration-300">
        <DialogHeader>
          <DialogTitle className="text-2xl font-serif font-black border-b border-black dark:border-white pb-3 transition-colors duration-300 uppercase">
            New Entry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          
          <div className="space-y-2 bg-gray-50 dark:bg-[#111] p-3 border border-gray-200 dark:border-gray-800 transition-colors duration-300">
            <Textarea 
              placeholder="e.g. Bought lunch for 45k using Gopay..." 
              value={aiPrompt} 
              onChange={(e) => setAiPrompt(e.target.value)}
              className="resize-none bg-white dark:bg-[#0a0a0a] text-black dark:text-white border-gray-300 dark:border-gray-700 placeholder:text-gray-400 dark:placeholder:text-gray-600 rounded-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white font-serif transition-colors duration-300"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAutoFill} disabled={isLoadingAI} className="bg-blue-600 hover:bg-blue-700 text-white rounded-none border-0 uppercase font-bold text-[10px] tracking-wide h-7">
                {isLoadingAI ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Sparkles className="w-3 h-3 mr-2" />}
                {isLoadingAI ? 'Processing...' : 'AI AUTO-FILL'}
              </Button>
            </div>
          </div>

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
                  <Button variant={"outline"} className={cn("w-full justify-start text-left font-normal bg-white dark:bg-[#111] border-gray-300 dark:border-gray-800 text-black dark:text-white rounded-none hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors duration-300", !date && "text-gray-500")}>
                    <CalendarIcon className="mr-2 h-4 w-4 text-gray-500 shrink-0" />
                    {date ? format(date, "d MMM yyyy", { locale: idLocale }) : <span>Select date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-white dark:bg-[#0a0a0a] border-gray-200 dark:border-gray-800 text-black dark:text-white rounded-none shadow-xl transition-colors duration-300" align="center">
                  <Calendar mode="single" selected={date} onSelect={setDate} initialFocus className="bg-white dark:bg-[#0a0a0a] text-black dark:text-white" />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Amount (IDR)</label>
            <Input type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield] bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white rounded-none transition-colors duration-300" />
          </div>

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

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-black dark:text-gray-300 uppercase tracking-wide block transition-colors duration-300">Notes</label>
            <Input placeholder="Lunch, Coffee, etc." value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-white dark:bg-[#111] text-black dark:text-white border-gray-300 dark:border-gray-800 placeholder:text-gray-400 focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white rounded-none transition-colors duration-300" />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-2 border-t border-gray-200 dark:border-gray-800 pt-5 transition-colors duration-300">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-none border-gray-300 dark:border-gray-700 text-black dark:text-gray-300 font-bold hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors duration-300">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="rounded-none bg-black dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 font-bold transition-colors duration-300">
            {isSubmitting ? 'Saving...' : 'Log Transaction'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}