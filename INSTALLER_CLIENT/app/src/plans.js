/**
 * Paket perpanjangan Lisensi Pro PesanRahasia.
 * Ubah harga di sini (atau lewat env LICENSE_PLANS_JSON) — tampilan & nominal QRIS otomatis mengikuti.
 *
 * Acuan harga: 7 Hari Rp20.000 (≈ Rp2.857/hari) sebagai harga eceran,
 * makin panjang durasi makin murah per hari agar pelanggan terdorong paket panjang
 * dan arus kas Anda lebih terjamin. Biaya operasional per pengguna sangat kecil
 * (server + Cloudflare Tunnel), sehingga margin tetap tinggi di semua paket.
 */
const DEFAULT_PLANS = [
  { key: '7d', label: '7 Hari', days: 7, price: 10000, originalPrice: 20000, isPromo: true, promoBadge: 'DISKON 50%' },
  { key: '14d', label: '2 Minggu', days: 14, price: 35000 },
  { key: '1m', label: '1 Bulan', days: 30, price: 60000, popular: true },
  { key: '3m', label: '3 Bulan', days: 90, price: 150000 },
  { key: '1y', label: '1 Tahun', days: 365, price: 500000 }
];

function loadPlans() {
  let plans = DEFAULT_PLANS;
  if (process.env.LICENSE_PLANS_JSON) {
    try {
      const parsed = JSON.parse(process.env.LICENSE_PLANS_JSON);
      if (Array.isArray(parsed) && parsed.length) {
        plans = parsed;
      }
    } catch {
      // Gunakan harga default jika JSON env tidak valid
    }
  }

  const cleaned = plans
    .map((p) => {
      const orig = Number(p.original_price || p.originalPrice || p.basePrice || 0);
      const pr = Math.max(500, Number(p.price || p.amount || 0));
      const hasPromo = Boolean(p.is_promo || p.isPromo || (orig > 0 && orig > pr) || p.promo_badge || p.promoBadge);
      const badge = p.promo_badge || p.promoBadge || (hasPromo && orig > pr ? `DISKON ${Math.round((1 - pr / orig) * 100)}%` : '');
      return {
        key: String(p.key),
        name: p.name || `Paket ${p.label || `${p.days} Hari`}`,
        label: String(p.label),
        days: Math.max(1, Number(p.days) || 1),
        price: pr,
        originalPrice: orig > pr ? orig : (hasPromo ? orig : 0),
        isPromo: hasPromo,
        promoBadge: badge,
        popular: Boolean(p.popular)
      };
    })
    .sort((a, b) => a.days - b.days);

  // Hitung harga per hari & persentase hemat dibanding paket eceran terpendek
  const base = cleaned[0];
  const baseDaily = (base.originalPrice || base.price) / base.days;
  return cleaned.map((p) => {
    const perDay = Math.round(p.price / p.days);
    const savePct = Math.max(0, Math.round((1 - p.price / p.days / baseDaily) * 100));
    return { ...p, perDay, savePct };
  });
}

export const LICENSE_PLANS = loadPlans();

export function findPlan(key) {
  return LICENSE_PLANS.find((p) => p.key === key) || null;
}

export function formatRupiah(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

