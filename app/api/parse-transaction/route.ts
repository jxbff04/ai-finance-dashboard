import { NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const parsedTransactionSchema = z.object({
  amount: z.number(),
  account_id: z.string(),
  category_id: z.string(),
  type: z.enum(['income', 'expense', 'transfer']),
  notes: z.string(),
});

type ParsedTransaction = z.infer<typeof parsedTransactionSchema>;

type AccountInput = {
  id: string;
  name: string;
  type?: string;
};

type CategoryInput = {
  id: string;
  name: string;
};

export async function POST(req: Request) {
  try {
    const { text, accounts, categories } = (await req.json()) as {
      text?: string;
      accounts?: AccountInput[];
      categories?: CategoryInput[];
    };

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Field `text` wajib diisi dengan string.' },
        { status: 400 }
      );
    }

    const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!geminiKey) {
      return NextResponse.json(
        { error: 'Server belum punya `GEMINI_API_KEY` atau `GOOGLE_GENERATIVE_AI_API_KEY` di environment.' },
        { status: 500 }
      );
    }

    const accountsList = Array.isArray(accounts) ? accounts : [];
    const categoriesList = Array.isArray(categories) ? categories : [];

    const prompt = [
      'Anda adalah layanan parsing untuk aplikasi keuangan pribadi.',
      'Tugas Anda: mem-parsing teks pengguna menjadi satu transaksi.',
      'Penting: isi field sesuai schema; gunakan hanya ID dari daftar akun/kategori yang diberikan.',
      '',
      'Aturan interpretasi:',
      '- amount: angka nominal dalam Rupiah (misal 30000). Jika tidak ada nominal, gunakan 0.',
      '- type:',
      '  - "income" jika transaksi pemasukan (contoh: gajian, dibayar, top up masuk)',
      '  - "expense" jika pengeluaran (contoh: beli, bayar, makan, transport keluar)',
      '  - "transfer" jika teks jelas menyebut transfer antar akun (contoh: "transfer dari ... ke ...", "pindah dari ... ke ...").',
      '- account_id: pilih ID akun dari daftar `accounts` yang paling sesuai dengan sumber transaksi. Jika transfer, account_id gunakan akun sumber.',
      '- category_id: pilih ID kategori dari daftar `categories` yang paling relevan dengan transaksi:',
      '  - Untuk "transfer": gunakan kategori yang bernama "Transfer" jika tersedia, jika tidak tersedia gunakan "".',
      '  - Untuk income/expense: pilih kategori paling cocok dari daftar.',
      '- notes: ambil ringkasan teks pengguna (boleh sama dengan teks asli namun boleh dipersingkat).',
      '',
      'Daftar accounts (pakai ID-nya):',
      JSON.stringify(
        accountsList.map((a) => ({ id: String(a.id), name: String(a.name), type: a.type ? String(a.type) : '' })),
        null,
        2
      ),
      '',
      'Daftar categories (pakai ID-nya):',
      JSON.stringify(categoriesList.map((c) => ({ id: String(c.id), name: String(c.name) })), null, 2),
      '',
      'Teks pengguna:',
      text,
    ].join('\n');

    const { object: parsed } = await generateObject({
      model: google('gemini-2.5-flash'),
      schema: parsedTransactionSchema,
      prompt,
    });

    const normalized: ParsedTransaction = {
      amount: Number.isFinite(parsed.amount) ? parsed.amount : 0,
      account_id: typeof parsed.account_id === 'string' ? parsed.account_id : '',
      category_id: typeof parsed.category_id === 'string' ? parsed.category_id : '',
      type:
        parsed.type === 'income' || parsed.type === 'expense' || parsed.type === 'transfer'
          ? parsed.type
          : 'expense',
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    };

    if (!normalized.account_id) {
      normalized.account_id = accountsList[0]?.id ? String(accountsList[0].id) : '';
    }

    if (normalized.type !== 'transfer' && !normalized.category_id && categoriesList[0]?.id) {
      normalized.category_id = String(categoriesList[0].id);
    }

    return NextResponse.json(normalized, { status: 200 });
  } catch (err) {
    console.error('parse-transaction error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gagal parsing transaksi dengan AI.' },
      { status: 500 }
    );
  }
}
