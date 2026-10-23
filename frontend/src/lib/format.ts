export function formatRupiah(amount: number): string {
  const num = Number(amount || 0);
  if (num < 0) {
    return '-Rp ' + Math.abs(num).toLocaleString('id-ID');
  }
  return 'Rp ' + num.toLocaleString('id-ID');
}

export function formatDateIndo(dateStr?: string): string {
  if (!dateStr) return '-';
  try {
    // Parse SQL/HTML date-only values as calendar dates, not UTC instants.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    const d = match
      ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
      : new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    let dateFormat = 'DD MMM YYYY';
    try { dateFormat = JSON.parse(localStorage.getItem('hd_system_settings') || '{}').dateFormat || dateFormat; } catch {}
    const timeZone = 'Asia/Jakarta';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
    const year = part('year'); const monthNumber = part('month'); const day = part('day');
    if (dateFormat === 'YYYY-MM-DD') return `${year}-${monthNumber}-${day}`;
    if (dateFormat === 'DD/MM/YYYY') return `${day}/${monthNumber}/${year}`;
    const month = new Intl.DateTimeFormat('id-ID', { timeZone, month: 'short' }).format(d);
    return `${Number(day)} ${month} ${year}`;
  } catch {
    return dateStr;
  }
}

export function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function terbilangRupiah(nilai: number): string {
  const bilangan = [
    '', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan',
    'Sepuluh', 'Sebelas'
  ];
  const num = Math.floor(Math.abs(nilai));
  if (num === 0) return 'Nol Rupiah';

  function konversi(n: number): string {
    if (n < 12) return bilangan[n];
    if (n < 20) return konversi(n - 10) + ' Belas';
    if (n < 100) return konversi(Math.floor(n / 10)) + ' Puluh ' + konversi(n % 10);
    if (n < 200) return 'Seratus ' + konversi(n - 100);
    if (n < 1000) return konversi(Math.floor(n / 100)) + ' Ratus ' + konversi(n % 100);
    if (n < 2000) return 'Seribu ' + konversi(n - 1000);
    if (n < 1000000) return konversi(Math.floor(n / 1000)) + ' Ribu ' + konversi(n % 1000);
    if (n < 1000000000) return konversi(Math.floor(n / 1000000)) + ' Juta ' + konversi(n % 1000000);
    if (n < 1000000000000) return konversi(Math.floor(n / 1000000000)) + ' Miliar ' + konversi(n % 1000000000);
    return konversi(Math.floor(n / 1000000000000)) + ' Triliun ' + konversi(n % 1000000000000);
  }

  return (konversi(num).trim().replace(/\s+/g, ' ') + ' Rupiah').trim();
}

