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
1. Jika user meminta mencatat satu atau BANYAK transaksi, kumpulkan semuanya dan LANGSUNG panggil tool "catat_banyak_transaksi".
2. TENTUKAN KATEGORI dan AKUN SENDIRI secara logis. JANGAN BERTANYA PADA USER. Jika akun tidak disebut, asumsikan "Tunai".
3. Jika user bertanya soal saldo, BACA informasi saldo di bawah ini.

Konteks Saldo User Saat Ini:
${ctx}

Tanggal hari ini: ${new Date().toISOString().split('T')[0]}`;

    const result = streamText({
      model: google('gemini-2.5-flash'),
      system: systemPrompt,
      messages: modelMessages as any,
      stopWhen: stepCountIs(5),
      tools: {
        catat_banyak_transaksi: tool({
          description: 'Mencatat satu atau BEBERAPA transaksi sekaligus ke database',
          inputSchema: z.object({
            data_transaksi: z.array(z.object({
              amount: z.number().describe('Nominal transaksi positif'),
              type: z.enum(['income', 'expense', 'transfer']),
              notes: z.string().describe('Deskripsi singkat'),
              category_name: z.string().describe('Nama kategori otomatis'),
              date: z.string().describe('Tanggal format YYYY-MM-DD'),
              account_name: z.string().describe('Nama akun (Gopay, Tunai, dll)'),
            })).describe('Daftar seluruh transaksi yang ingin dicatat')
          }),
          execute: async (args: any) => {
            const { data_transaksi } = args;
            let successCount = 0;
            let laporan = [];

            for (const tx of data_transaksi) {
              const { amount, type, notes, category_name, date, account_name } = tx;
              try {
                let account_id = null;
                const { data: accData } = await supabase.from('accounts').select('id').ilike('name', `%${account_name}%`).limit(1).single();
                if (accData) { account_id = accData.id; } 
                else {
                  const { data: newAcc } = await supabase.from('accounts').insert({ name: account_name, type: 'E-WALLET', balance: 0 }).select('id').single();
                  if (newAcc) account_id = newAcc.id;
                }
                if (!account_id) continue;

                let category_id = null;
                if (type !== 'transfer') {
                  const { data: catData } = await supabase.from('categories').select('id').ilike('name', category_name).limit(1).single();
                  if (catData) { category_id = catData.id; } 
                  else {
                    const catType = type === 'income' ? 'income' : 'expense';
                    const { data: newCat } = await supabase.from('categories').insert({ name: category_name, type: catType }).select('id').single();
                    if (newCat) category_id = newCat.id;
                  }
                }

                const finalAmount = type === 'expense' ? -Math.abs(amount) : Math.abs(amount);

                const { error: txErr } = await supabase.from('transactions').insert({
                  account_id, category_id, amount: finalAmount, type, notes, transaction_date: date,
                });

                if (!txErr) {
                  successCount++;
                  laporan.push(`- Rp${Math.abs(amount)}: ${notes} (${account_name})`);
                }
              } catch (e: any) {
                console.error("Gagal mencatat transaksi", notes, e);
              }
            }
            
            return `BERHASIL MENCATAT ${successCount} TRANSAKSI:\n` + laporan.join('\n');
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