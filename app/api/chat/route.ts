import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const json = (await req.json()) as {
      messages?: UIMessage[];
      accountContext?: unknown;
      id?: string;
      trigger?: string;
      messageId?: string | null;
    };

    const { messages, accountContext } = json;

    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Field `messages` wajib berupa array.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Field `messages` tidak boleh kosong.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!geminiKey) {
      return new Response(
        JSON.stringify({
          error: 'Server belum punya `GEMINI_API_KEY` atau `GOOGLE_GENERATIVE_AI_API_KEY` di environment.',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const ctx =
      typeof accountContext === 'string' && accountContext.trim().length > 0
        ? accountContext.trim()
        : '';

    const modelMessages = await convertToModelMessages(messages);

    const systemPrompt = [
      'Anda adalah Asisten Keuangan Pribadi.',
      'Jawab dalam Bahasa Indonesia, ringkas, dan praktis.',
      ctx
        ? ['', 'Konteks dari aplikasi (gunakan saat relevan):', ctx].join('\n')
        : '',
      '',
      'Jika pengguna bertanya soal saldo atau total uang, gunakan angka dari konteks di atas bila tersedia.',
      'Jika pengguna meminta saran, berikan langkah yang bisa langsung dilakukan.',
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    const result = streamText({
      model: google('gemini-2.5-flash'),
      system: systemPrompt,
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error('chat error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Gagal memproses chat.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
