import type { Request, Response } from 'express';
// The UI profile and credential headers are not authentication authorities.
export function createAdminSessionAccess<T extends { id: number; role: string }>(identity: (req: Request) => Promise<T | null>) {
  return async (req: Request, res: Response): Promise<T | null> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const user = await identity(req);
      if (!user) { res.status(401).json({ error: 'Sesi login tidak tersedia atau berakhir. Silakan login kembali.' }); return null; }
      if (user.role !== 'ADMIN') { res.status(403).json({ error: 'Akses administrasi hanya untuk role Admin' }); return null; }
      return user;
    } catch { res.status(503).json({ error: 'Layanan verifikasi sesi Admin tidak tersedia. Coba lagi.' }); return null; }
  };
}
