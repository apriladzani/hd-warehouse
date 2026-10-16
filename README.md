# HD Warehouse Management (Frontend & Backend Separated)

Sistem manajemen inventaris dan gudang HD dengan arsitektur terpisah antara **Frontend** dan **Backend**.

---

## Struktur Direktori

```text
├── frontend/                 # Kode Antarmuka / UI Client (Vite + React + Tailwind)
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── .env
│   ├── .env.example
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── index.css
│       ├── types.ts
│       ├── components/       # Komponen UI, Modals, Halaman User & Warehouse
│       ├── constants/        # Daftar Outlet & Konstanta
│       └── lib/              # Format Rupiah, Tanggal, Terbilang
│
├── backend/                  # Kode Server & API (Express + MySQL + Drizzle ORM)
│   ├── package.json
│   ├── tsconfig.json
│   ├── schema.sql            # Skema SQL Database
│   ├── .env
│   ├── .env.example
│   └── src/
│       ├── server.ts         # REST API Endpoints & Express Server
│       ├── types.ts          # Type Definitions
│       └── db/
│           ├── index.ts      # Koneksi Database MySQL Pool
│           ├── schema.ts     # Schema Drizzle ORM
│           ├── repository.ts # Business Logic, Query, & Relasi Database
│           └── drizzle.config.ts
│
├── package.json              # Root Workspace Script (Menjalankan frontend & backend)
└── README.md
```

---

## Cara Menjalankan

### Opsi 1: Menjalankan Bersamaan dari Root (Direkomendasikan)
```bash
# Menjalankan frontend (port 3000) dan backend (port 5001) secara serentak
npm run dev

# Build seluruh project
npm run build
```

### Opsi 2: Menjalankan Secara Terpisah
1. **Jalankan Backend:**
   ```bash
   cd backend
   npm run dev
   # Backend berjalan di http://localhost:5001
   ```

2. **Jalankan Frontend:**
   ```bash
   cd frontend
   npm run dev
   # Frontend berjalan di http://localhost:3000 (otomatis mem-proxy /api ke backend port 5001)
   ```


## Harga rata-rata pembelian Inventory

`items.avg_purchase_price` / `Inventory.avgPurchasePrice` menyimpan weighted average:
`SUM(quantity × harga beli) / SUM(quantity)` per `item_id`, dari seluruh riwayat pembelian valid tanpa filter vendor atau tanggal. Stok awal, stok keluar, dan harga katalog tidak menjadi bobot perhitungan. Penerimaan memperbarui field ini dalam transaksi database yang sama dengan stok dan riwayat pembelian.

Untuk database lama, jalankan `backend/migrations/20261015_inventory_weighted_average.sql` sekali pada database aplikasi sebelum memakai versi ini. Migrasi mengubah kolom yang sama menjadi `DECIMAL(18,2)` dan menghitung ulang nilainya dari riwayat; tidak menambahkan field baru.

Pengujian integrasi: `npm --prefix backend run test:weighted-average` (membutuhkan konfigurasi koneksi MySQL). Pengujian menggunakan tabel sementara dalam satu koneksi, tanpa mengubah data operasional. Jalankan dari root agar konfigurasi `.env` sama dengan `npm run dev`.
