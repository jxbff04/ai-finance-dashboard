import { convertToModelMessages, streamText, tool, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';

export const maxDuration = 30;

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
});

export async function POST(req: Request) {
  try {
    const json = (await req.json()) as any;
    const { messages, accountContext } = json;

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages invalid' }), { status: 400 });
    }

    const ctx = typeof accountContext === 'string' ? accountContext.trim() : '';
    const modelMessages = await convertToModelMessages(messages);

    const systemPrompt = `Kamu adalah asisten keuangan AI super cerdas.
ATURAN MUTLAK:
1. Jika user meminta mencatat uang keluar/masuk, LANGSUNG panggil tool "catat_transaksi".
2. TENTUKAN KATEGORI dan AKUN SENDIRI secara logis. JANGAN BERTANYA PADA USER. Jika akun tidak disebut, asumsikan "Tunai".
3. Jika user bertanya soal saldo atau ringkasan akun, BACA informasi saldo di bawah ini dan beritahukan ke user.

Konteks Saldo User Saat Ini:
${ctx}

Tanggal hari ini: ${new Date().toISOString().split('T')[0]}`;

    const result = streamText({
      model: google('gemini-2.5-flash'),
      system: systemPrompt,
      messages: modelMessages as any,
      // PERUBAHAN V6: Menggunakan stopWhen sebagai pengganti maxSteps
      stopWhen: stepCountIs(5),
      tools: {
        catat_transaksi: tool({
          description: 'Mencatat transaksi ke database secara mandiri',
          // PERUBAHAN V6: parameters diubah menjadi inputSchema
          inputSchema: z.object({
            amount: z.number().describe('Nominal transaksi positif'),
            type: z.enum(['income', 'expense', 'transfer']),
            notes: z.string().describe('Deskripsi singkat'),
            category_name: z.string().describe('Nama kategori otomatis'),
            date: z.string().describe('Tanggal format YYYY-MM-DD'),
            account_name: z.string().describe('Nama akun (Gopay, Tunai, dll)'),
          }),
          execute: async (args: any) => {
            const { amount, type, notes, category_name, date, account_name } = args;
            
            try {
              let account_id = null;
              const { data: accData } = await supabase.from('accounts').select('id').ilike('name', `%${account_name}%`).limit(1).single();
              if (accData) {
                account_id = accData.id;
              } else {
                const { data: newAcc } = await supabase.from('accounts').insert({ name: account_name, type: 'E-WALLET', balance: 0 }).select('id').single();
                if (newAcc) account_id = newAcc.id;
              }
              if (!account_id) return "Gagal memproses ID akun.";

              let category_id = null;
              if (type !== 'transfer') {
                const { data: catData } = await supabase.from('categories').select('id').ilike('name', category_name).limit(1).single();
                if (catData) {
                  category_id = catData.id;
                } else {
                  const catType = type === 'income' ? 'income' : 'expense';
                  const { data: newCat } = await supabase.from('categories').insert({ name: category_name, type: catType }).select('id').single();
                  if (newCat) category_id = newCat.id;
                }
              }

              // Ubah ke negatif jika pengeluaran sesuai struktur databasemu
              const finalAmount = type === 'expense' ? -Math.abs(amount) : Math.abs(amount);

              const { error: txErr } = await supabase.from('transactions').insert({
                account_id, category_id, amount: finalAmount, type, notes, transaction_date: date,
              });

              if (txErr) return `Gagal mencatat: ${txErr.message}`;
              
              return `BERHASIL: Transaksi Rp${Math.abs(amount)} untuk "${notes}" di akun "${account_name}" telah dicatat.`;
            } catch (e: any) {
              return `Error internal: ${e.message}`;
            }
          }
        })
      }
    });

    const response: any = result;
    return response.toDataStreamResponse ? response.toDataStreamResponse() : response.toUIMessageStreamResponse();
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}