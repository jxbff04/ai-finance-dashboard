'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';

export type TransactionFormType = 'income' | 'expense' | 'transfer';

export type DashboardAccount = {
  id: string;
  name: string;
  type: string;
  balance: string | number | null;
};

type Category = {
  id: string;
  name: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType: TransactionFormType;
  accounts: DashboardAccount[];
  onSubmitted: () => Promise<void>;
};

const TRANSFER_CATEGORY_NAME = 'Transfer';

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const getTodayDateInputValue = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`; // format yang dibutuhkan oleh <input type="date" />
};

export default function TransactionDialog({
  open,
  onOpenChange,
  initialType,
  accounts,
  onSubmitted,
}: Props) {
  const [type, setType] = useState<TransactionFormType>(initialType);
  const [amount, setAmount] = useState<string>('');
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const [destinationAccountId, setDestinationAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const today = getTodayDateInputValue();
  const [date, setDate] = useState<string>(today);

  const [aiText, setAiText] = useState<string>('');
  const [aiFilling, setAiFilling] = useState(false);

  const didInitRef = useRef(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const transferCategoryId = useMemo(() => {
    const found = categories.find(
      (c) => c.name.trim().toLowerCase() === TRANSFER_CATEGORY_NAME.toLowerCase()
    );
    return found?.id ?? '';
  }, [categories]);

  const defaultSourceId = useMemo(() => accounts[0]?.id ?? '', [accounts]);
  const defaultDestinationId = useMemo(() => {
    if (accounts.length < 2) return '';
    const first = accounts[0]?.id ?? '';
    const candidate = accounts.find((a) => a.id !== first)?.id;
    return candidate ?? accounts[1]?.id ?? '';
  }, [accounts]);

  useEffect(() => {
    if (!open) {
      didInitRef.current = false;
      return;
    }

    // Hindari reset state berulang ketika parent re-render saat dialog masih terbuka.
    if (didInitRef.current) return;
    didInitRef.current = true;

    const nextType = initialType ?? 'income';
    setType(nextType);
    setAmount('');
    setDescription('');
    setDate(getTodayDateInputValue());
    setAiText('');
    setFormError(null);

    setSourceAccountId(defaultSourceId);
    setDestinationAccountId(nextType === 'transfer' ? defaultDestinationId : '');
    setCategoryId('');
  }, [open, initialType, defaultSourceId, defaultDestinationId]);

  useEffect(() => {
    if (!open) return;
    if (categories.length > 0) return;

    let cancelled = false;

    const fetchCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);
      try {
        // Expecting table shape: `categories(id, name)`
        const { data, error } = await supabase
          .from('categories')
          .select('id, name')
          .order('name', { ascending: true });

        if (error) throw error;

        const normalized: Category[] = (data ?? [])
          .map((c: any) => ({
            id: String(c.id ?? ''),
            name: String(c.name ?? '').trim(),
          }))
          .filter((c: Category) => c.id.length > 0 && c.name.length > 0);

        if (!cancelled) setCategories(normalized);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to fetch categories:', err);
        setCategoriesError('Gagal mengambil daftar kategori. Silakan coba lagi.');
        // If categories can't be loaded, avoid guessing IDs (schema-dependent).
        // The UI will show the error and disable submit until data is available.
        setCategories([]);
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    };

    fetchCategories();

    return () => {
      cancelled = true;
    };
  }, [open, type, categories.length]);

  useEffect(() => {
    if (!open) return;
    if (type === 'transfer') return;
    if (categories.length === 0) return;

    // If user switches type (e.g., from transfer back to income/expense), prefill category.
    if (!categoryId) {
      setCategoryId(categories[0]?.id ?? '');
    }
  }, [open, type, categories, categoryId]);

  useEffect(() => {
    if (!open) return;
    if (type !== 'transfer') return;
    if (!destinationAccountId) {
      // Prefer destination != source.
      const candidate = accounts.find((a) => a.id !== sourceAccountId)?.id ?? '';
      if (candidate && candidate !== sourceAccountId) setDestinationAccountId(candidate);
    }
  }, [open, type, destinationAccountId, accounts, sourceAccountId]);

  const title = useMemo(() => {
    if (type === 'transfer') return 'Transfer Antar Akun';
    if (type === 'income') return 'Tambah Transaksi Manual';
    return 'Tambah Transaksi Pengeluaran';
  }, [type]);

  const submitDisabled = useMemo(() => {
    if (submitting || aiFilling) return true;
    if (!amount) return true;
    if (!sourceAccountId) return true;
    if (!date) return true;
    if (type === 'transfer') {
      return !destinationAccountId || destinationAccountId === sourceAccountId;
    }
    if (!categoryId) return true;
    return false;
  }, [submitting, aiFilling, amount, sourceAccountId, type, destinationAccountId, categoryId, date]);

  const handleAutoFillWithAI = async () => {
    const trimmed = aiText.trim();
    if (!trimmed) {
      setFormError('Teks transaksi untuk AI masih kosong.');
      return;
    }

    try {
      setAiFilling(true);
      setFormError(null);

      const res = await fetch('/api/parse-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type })),
          categories: categories.map((c) => ({ id: c.id, name: c.name })),
        }),
      });

      const body = (await res.json()) as any;
      if (!res.ok) {
        throw new Error(body?.error || 'Gagal mengisi form dari AI.');
      }

      const nextType = body?.type as TransactionFormType | undefined;
      const nextAmountNum = Number(body?.amount);
      const nextAccountId = body?.account_id;
      const nextCategoryId = body?.category_id;
      const nextNotes = body?.notes ?? '';

      if (
        !nextType ||
        !nextAccountId ||
        !Number.isFinite(nextAmountNum) ||
        nextAmountNum <= 0 ||
        typeof nextCategoryId !== 'string'
      ) {
        throw new Error('AI tidak dapat memahami transaksi. Coba ulang dengan teks yang lebih spesifik.');
      }

      setType(nextType);
      setAmount(String(Math.abs(nextAmountNum)));
      setSourceAccountId(String(nextAccountId));
      setCategoryId(nextCategoryId);
      setDescription(String(nextNotes));

      if (nextType === 'transfer') {
        const destCandidate = accounts.find((a) => a.id !== String(nextAccountId))?.id ?? '';
        setDestinationAccountId(destCandidate);
      } else {
        setDestinationAccountId('');
      }

      setFormError(null);
    } catch (err) {
      console.error(err);
      const anyErr = err as any;
      const message =
        (anyErr && typeof anyErr.message === 'string' && anyErr.message) ||
        'Gagal mengisi form otomatis dengan AI.';
      setFormError(message);
    } finally {
      setAiFilling(false);
    }
  };

  const handleSubmit = async () => {
    setFormError(null);
    const parsedAmount = Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Nominal harus berupa angka lebih dari 0.');
      return;
    }

    if (!sourceAccountId) {
      setFormError('Pilih Akun Sumber terlebih dahulu.');
      return;
    }

    const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
    if (!sourceAccount) {
      setFormError('Akun Sumber tidak ditemukan.');
      return;
    }

    const dateParsed = date
      ? new Date(`${date}T00:00:00`)
      : new Date();
    const transactionDateIso = Number.isNaN(dateParsed.getTime())
      ? new Date().toISOString()
      : dateParsed.toISOString();
    const safeDescription = description.trim();

    try {
      setSubmitting(true);

      if (type === 'transfer') {
        if (!destinationAccountId || destinationAccountId === sourceAccountId) {
          setFormError('Akun Tujuan harus berbeda dengan Akun Sumber.');
          return;
        }

        const destinationAccount = accounts.find((a) => a.id === destinationAccountId);
        if (!destinationAccount) {
          setFormError('Akun Tujuan tidak ditemukan.');
          return;
        }

        // 1) Insert 1 transaction row for transfer
        // Schema: `account_id` (sumber), `to_account_id` (tujuan), `category_id` (opsional)
        const transferRow: Record<string, unknown> = {
          account_id: sourceAccountId,
          to_account_id: destinationAccountId,
          notes: safeDescription || '',
          amount: Math.abs(parsedAmount),
          type: 'transfer',
          transaction_date: transactionDateIso,
        };

        const resolvedTransferCategoryId = transferCategoryId || categoryId;
        if (resolvedTransferCategoryId) {
          transferRow.category_id = resolvedTransferCategoryId;
        }

        const { error: insertError } = await supabase
          .from('transactions')
          .insert(transferRow);
        if (insertError) throw insertError;

        // 2) Update balances
        const sourceNewBalance = toNumber(sourceAccount.balance) - Math.abs(parsedAmount);
        const destinationNewBalance =
          toNumber(destinationAccount.balance) + Math.abs(parsedAmount);

        const { error: srcUpdateError } = await supabase
          .from('accounts')
          .update({ balance: sourceNewBalance })
          .eq('id', sourceAccountId);
        if (srcUpdateError) throw srcUpdateError;

        const { error: dstUpdateError } = await supabase
          .from('accounts')
          .update({ balance: destinationNewBalance })
          .eq('id', destinationAccountId);
        if (dstUpdateError) throw dstUpdateError;
      } else {
        if (!categoryId) {
          setFormError('Pilih Kategori terlebih dahulu.');
          return;
        }

        const isIncome = type === 'income';
        const delta = Math.abs(parsedAmount);
        const signedAmount = isIncome ? delta : -delta;
        const nextBalance = toNumber(sourceAccount.balance) + (isIncome ? delta : -delta);

        const { error: insertError } = await supabase.from('transactions').insert({
          account_id: sourceAccountId,
          notes: safeDescription || '',
          category_id: categoryId,
          amount: signedAmount,
          type,
          transaction_date: transactionDateIso,
        });
        if (insertError) throw insertError;

        const { error: updateError } = await supabase
          .from('accounts')
          .update({ balance: nextBalance })
          .eq('id', sourceAccountId);
        if (updateError) throw updateError;
      }

      toast.success('✨ Transaksi berhasil disimpan!');
      await onSubmitted();
      onOpenChange(false);
    } catch (err) {
      console.error(err);

      const anyErr = err as any;
      const rawMessage =
        (anyErr && typeof anyErr.message === 'string' && anyErr.message) ||
        (err instanceof Error ? err.message : null) ||
        'Gagal menyimpan transaksi.';

      const details =
        anyErr && typeof anyErr.details === 'string' ? anyErr.details : undefined;
      const hint = anyErr && typeof anyErr.hint === 'string' ? anyErr.hint : undefined;

      const messageToShow = [
        rawMessage,
        details ? `Details: ${details}` : null,
        hint ? `Hint: ${hint}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      setFormError(messageToShow);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Keep behavior predictable: if user closes, reset any inline errors.
        if (!nextOpen) setFormError(null);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-2xl border-gray-800 bg-[#1A1A1A] p-6 text-gray-100 shadow-2xl [&>button.absolute]:text-gray-300 [&>button.absolute]:hover:text-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 border border-emerald-500/20">
                {type === 'transfer' ? (
                  <ArrowRightLeft className="h-5 w-5 text-emerald-300" />
                ) : (
                  <Plus className="h-5 w-5 text-emerald-300" />
                )}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">{title}</h2>
                <p className="text-xs text-gray-400">Isi detail transaksi Anda.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Textarea
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder="Contoh: Beli kopi 30000 pakai gopay untuk kategori makan"
            className="min-h-[72px] border-gray-800 bg-[#0F0F0F] text-gray-100 placeholder:text-gray-500"
          />
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              className="border-gray-700 bg-[#0F0F0F] text-gray-200 hover:bg-[#1A1A1A] hover:text-white"
              onClick={handleAutoFillWithAI}
              disabled={aiFilling || submitting || !aiText.trim()}
            >
              {aiFilling ? '🤖 Robot sedang berpikir...' : '✨ Isi Otomatis dengan AI'}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {/* Tipe */}
          <div className="sm:col-span-2">
            <Label className="mb-2 block text-sm font-medium text-gray-200">Tipe</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                const nextType = v as TransactionFormType;
                setType(nextType);
                setFormError(null);
                if (nextType === 'transfer') {
                  setCategoryId('');
                } else {
                  setCategoryId('');
                  setDestinationAccountId('');
                }
              }}
            >
              <SelectTrigger className="border-gray-800 bg-[#0F0F0F] text-gray-100">
                <SelectValue placeholder="Pilih tipe transaksi" />
              </SelectTrigger>
              <SelectContent className="border border-gray-800 bg-[#0F0F0F] text-gray-100">
                <SelectItem value="income">Pemasukan</SelectItem>
                <SelectItem value="expense">Pengeluaran</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Nominal */}
          <div className="sm:col-span-1">
            <Label className="mb-2 block text-sm font-medium text-gray-200">Nominal</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="0"
              className="border-gray-800 bg-[#0F0F0F] text-gray-100 placeholder:text-gray-500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-400">Masukkan nominal dalam Rupiah.</p>
          </div>

          {/* Tanggal Transaksi */}
          <div className="sm:col-span-1">
            <Label className="mb-2 block text-sm font-medium text-gray-200">Tanggal Transaksi</Label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setFormError(null);
              }}
              className="h-9 w-full rounded-md border border-gray-800 bg-[#0F0F0F] px-3 text-sm text-gray-100 outline-none focus:border-gray-600"
            />
          </div>

          {/* Akun Sumber */}
          <div className="sm:col-span-1">
            <Label className="mb-2 block text-sm font-medium text-gray-200">Akun Sumber</Label>
            <Select value={sourceAccountId} onValueChange={setSourceAccountId}>
              <SelectTrigger className="border-gray-800 bg-[#0F0F0F] text-gray-100">
                <SelectValue placeholder="Pilih akun sumber" />
              </SelectTrigger>
              <SelectContent className="border border-gray-800 bg-[#0F0F0F] text-gray-100">
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Kategori (hide for transfer) */}
          {type !== 'transfer' && (
            <div className="sm:col-span-1">
              <Label className="mb-2 block text-sm font-medium text-gray-200">Kategori</Label>
              <Select
                value={categoryId}
                onValueChange={(v) => {
                  setCategoryId(v);
                  setFormError(null);
                }}
              >
                <SelectTrigger
                  className="border-gray-800 bg-[#0F0F0F] text-gray-100"
                  disabled={categoriesLoading}
                >
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent className="border border-gray-800 bg-[#0F0F0F] text-gray-100">
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categoriesError && <p className="mt-1 text-xs text-red-400">{categoriesError}</p>}
            </div>
          )}

          {/* Akun Tujuan (transfer only) */}
          {type === 'transfer' && (
            <div className="sm:col-span-1">
              <Label className="mb-2 block text-sm font-medium text-gray-200">Akun Tujuan</Label>
              <Select
                value={destinationAccountId}
                onValueChange={(v) => {
                  setDestinationAccountId(v);
                  setFormError(null);
                }}
              >
                <SelectTrigger className="border-gray-800 bg-[#0F0F0F] text-gray-100">
                  <SelectValue placeholder="Pilih akun tujuan" />
                </SelectTrigger>
                <SelectContent className="border border-gray-800 bg-[#0F0F0F] text-gray-100">
                  {accounts
                    .filter((acc) => acc.id !== sourceAccountId)
                    .map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-gray-400">
                Transfer akan mencatat 2 transaksi: keluar (sumber) dan masuk (tujuan).
              </p>
            </div>
          )}

          {/* Catatan */}
          <div className="sm:col-span-2">
            <Label className="mb-2 block text-sm font-medium text-gray-200">Catatan</Label>
            <Textarea
              placeholder="Opsional. Misalnya: Biaya internet, Transfer ke DANA..."
              className="min-h-[90px] border-gray-800 bg-[#0F0F0F] text-gray-100 placeholder:text-gray-500"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {formError && (
            <div className="sm:col-span-2 rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">
              {formError}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-gray-700 bg-[#0F0F0F] text-gray-200 hover:bg-[#1A1A1A] hover:text-white"
            onClick={() => onOpenChange(false)}
            disabled={submitting || aiFilling}
          >
            Batal
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handleSubmit}
            disabled={submitDisabled}
          >
            {submitting ? 'Menyimpan...' : 'Simpan Transaksi'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

