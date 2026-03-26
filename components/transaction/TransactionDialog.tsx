'use client';

import { useState, useEffect } from 'react';
import { Sparkles, Calendar as CalendarIcon } from 'lucide-react';
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
  const [date, setDate] = useState<Date | undefined>(new Date()); // Menggunakan Date object untuk Kalender
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
      setDate(new Date()); // Reset ke hari ini saat modal dibuka
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
      
      // Parsing tanggal dari string (YYYY-MM-DD) yang dikirim AI menjadi Date Object
      if (data.date) {
        setDate(new Date(data.date));
      }

      if (data.account_name) {
        const matchedAcc = accounts.find(a => a.name.toLowerCase().includes(data.account_name.toLowerCase()));
        if (matchedAcc) setAccountId(String(matchedAcc.id));
      }
      if (data.category_name) {
        const matchedCat = categories.find(c => c.name.toLowerCase().includes(data.category_name.toLowerCase()));
        if (matchedCat) setCategoryId(String(matchedCat.id));
      }
      
      toast.success('Berhasil diisi otomatis!');
    } catch (err: any) {
      toast.error(err.message || 'Gagal auto-fill');
    } finally {
      setIsLoadingAI(false);
    }
  };

  const handleSubmit = async () => {
    if (!amount || !accountId || !date) return toast.error('Nominal, Akun, dan Tanggal wajib diisi');
    setIsSubmitting(true);
    try {
      const finalAmount = type === 'expense' ? -Math.abs(Number(amount)) : Math.abs(Number(amount));

      const { error } = await supabase.from('transactions').insert({
        account_id: accountId,
        category_id: categoryId || null,
        amount: finalAmount,
        type,
        notes,
        transaction_date: format(date, 'yyyy-MM-dd') // Kembalikan ke format database
      });
      if (error) throw error;
      toast.success('Transaksi berhasil disimpan');
      onSubmitted();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan transaksi');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-[#0A0A0A] border-gray-800 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Tambah {type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="space-y-2 bg-[#141414] p-3 rounded-xl border border-gray-800">
            <Textarea 
              placeholder="Contoh: Beli makan siang 45 ribu pakai Gopay" 
              value={aiPrompt} 
              onChange={(e) => setAiPrompt(e.target.value)}
              className="resize-none bg-[#1c1c1c] text-white border-gray-700 placeholder:text-gray-500"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAutoFill} disabled={isLoadingAI} className="bg-cyan-600 hover:bg-cyan-500 text-white">
                <Sparkles className="w-4 h-4 mr-2" />
                {isLoadingAI ? 'Memproses...' : 'Isi Otomatis dengan AI'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 mb-1 block">Tipe</label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger className="bg-[#141414] text-white border-gray-700 focus:ring-cyan-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1c1c1c] text-white border-gray-800">
                  <SelectItem value="expense">Pengeluaran</SelectItem>
                  <SelectItem value="income">Pemasukan</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* INI ADALAH KALENDER MODERN YANG BARU */}
            <div className="space-y-1 flex flex-col">
              <label className="text-xs font-semibold text-gray-400 mb-1">Tanggal</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={"outline"}
                    className={cn(
                      "w-full justify-start text-left font-normal bg-[#141414] border-gray-700 hover:bg-[#1c1c1c] hover:text-white transition-all focus-visible:ring-cyan-500",
                      !date && "text-gray-500"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-cyan-500 shrink-0" />
                    {date ? format(date, "d MMM yyyy", { locale: idLocale }) : <span>Pilih tanggal</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-[#0A0A0A] border-gray-800 text-white shadow-2xl" align="center">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                    className="bg-[#0A0A0A] text-white rounded-lg border border-gray-800"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-400 block mb-1">Nominal</label>
            <Input type="number" placeholder="45000" value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-[#141414] text-white border-gray-700 placeholder:text-gray-500 focus-visible:ring-cyan-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 block mb-1">Akun Sumber</label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="bg-[#141414] text-white border-gray-700 focus:ring-cyan-500">
                  <SelectValue placeholder="Pilih akun" />
                </SelectTrigger>
                <SelectContent className="bg-[#1c1c1c] text-white border-gray-800">
                  {accounts.map(acc => (
                    <SelectItem key={acc.id} value={String(acc.id)}>{acc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-400 block mb-1">Kategori</label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="bg-[#141414] text-white border-gray-700 focus:ring-cyan-500">
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent className="bg-[#1c1c1c] text-white border-gray-800 max-h-48">
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-400 block mb-1">Catatan</label>
            <Input placeholder="Beli makan siang" value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-[#141414] text-white border-gray-700 placeholder:text-gray-500 focus-visible:ring-cyan-500" />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-white hover:bg-gray-800">Batal</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} className="bg-emerald-600 hover:bg-emerald-500 text-white">
            {isSubmitting ? 'Menyimpan...' : 'Simpan Transaksi'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}