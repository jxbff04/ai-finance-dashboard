import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
});

export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    
    const { object } = await generateObject({
      model: google('gemini-2.5-flash'),
      system: 'Kamu pengurai transaksi. Ubah teks menjadi JSON. Tebak kategori dan akun seakurat mungkin dari kalimat.',
      prompt: `Teks transaksi: "${text}"\nTanggal hari ini: ${new Date().toISOString().split('T')[0]}`,
      schema: z.object({
        amount: z.number(),
        type: z.enum(['income', 'expense', 'transfer']),
        notes: z.string(),
        category_name: z.string(),
        date: z.string(),
        account_name: z.string()
      })
    });

    return new Response(JSON.stringify(object), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}