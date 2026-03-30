import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get('symbols');
  if (!symbols) return NextResponse.json({});

  const symbolArray = symbols.split(',');
  const pricesInIDR: Record<string, number> = {};

  try {
    // Mengambil kurs USD ke IDR hari ini secara real-time
    const idrRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/USDIDR=X`, { next: { revalidate: 60 } });
    const idrData = await idrRes.json();
    const usdToIdr = idrData?.chart?.result?.[0]?.meta?.regularMarketPrice || 15500;

    // Mengambil harga setiap aset yang dimasukkan user
    await Promise.all(symbolArray.map(async (sym) => {
      try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}`, { next: { revalidate: 60 } });
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) { pricesInIDR[sym] = 0; return; }
        
        const price = meta.regularMarketPrice;
        const currency = meta.currency;

        // Jika asetnya dalam USD (cth: Apple, BTC), otomatis kalikan dengan kurs Rupiah
        if (currency === 'USD') {
          pricesInIDR[sym] = price * usdToIdr;
        } else {
          pricesInIDR[sym] = price; // Jika sudah IDR (cth: BBCA.JK), biarkan
        }
      } catch (e) {
        pricesInIDR[sym] = 0;
      }
    }));

    return NextResponse.json(pricesInIDR);
  } catch(err) {
    return NextResponse.json({ error: "Gagal menarik data harga" }, { status: 500 });
  }
}