// Sends ESC/POS bytes straight to a thermal printer from the browser, without
// the print dialog. Three ways, depending on the device and the printer:
//   - Web Bluetooth: Bluetooth Low Energy printers, Chrome/Edge on Android,
//     Windows and Mac (and the Bluefy browser on iPhone/iPad).
//   - Web Serial: a Bluetooth Classic printer paired in Windows/Mac, which
//     shows up as a COM port; Chrome/Edge on a computer.
//   - RawBT: the RawBT app on Android, for Bluetooth Classic printers.
// The printer chosen once is remembered in this browser and reused.

const nav = (): any => (typeof navigator === 'undefined' ? {} : navigator);
export const supportsBluetooth = () => Boolean(nav().bluetooth?.requestDevice);
export const supportsSerial = () => Boolean(nav().serial?.requestPort);
export const isAndroid = () => /Android/i.test(nav().userAgent || '');
export const isIos = () => /iPhone|iPad|iPod/i.test(nav().userAgent || '') || (nav().platform === 'MacIntel' && nav().maxTouchPoints > 1);

// Print services used by common 58/80 mm BLE printers. Web Bluetooth only
// shows services listed here.
export const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae3a-0000-1000-8000-00805f9b34fb',
];

const STORAGE_KEY = 'hd-receipt-printer';
type Saved = { kind: 'bluetooth' | 'serial'; id?: string; name: string };
const readSaved = (): Saved | null => { try { const value = localStorage.getItem(STORAGE_KEY); return value ? JSON.parse(value) : null; } catch { return null; } };
const writeSaved = (value: Saved | null) => { try { if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); else localStorage.removeItem(STORAGE_KEY); } catch { /* not remembered */ } };
export const savedPrinterName = () => readSaved()?.name ?? null;
export const savedPrinterKind = () => readSaved()?.kind ?? null;

export class ReceiptPrinterError extends Error {}

// Writes in small pieces: many printers accept only 20 bytes per BLE write.
export async function writeChunks(write: (chunk: Uint8Array) => Promise<void>, data: Uint8Array, size = 20, pause = 0) {
  for (let offset = 0; offset < data.length; offset += size) {
    await write(data.subarray(offset, offset + size));
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  }
}

// --- Bluetooth Low Energy ------------------------------------------------------
let bluetoothDevice: any = null;

async function findWritable(server: any) {
  const services = await server.getPrimaryServices().catch(() => []);
  for (const service of services) {
    const characteristics = await service.getCharacteristics().catch(() => []);
    const found = characteristics.find((c: any) => c.properties.write || c.properties.writeWithoutResponse);
    if (found) return found;
  }
  return null;
}

async function bluetoothDeviceToUse(choose: boolean) {
  if (!choose && bluetoothDevice) return bluetoothDevice;
  const saved = readSaved();
  // Chrome can give back a device chosen in an earlier visit, where supported.
  if (!choose && saved?.kind === 'bluetooth' && nav().bluetooth.getDevices) {
    const known = (await nav().bluetooth.getDevices().catch(() => [])).find((device: any) => device.id === saved.id);
    if (known) return (bluetoothDevice = known);
  }
  try {
    bluetoothDevice = await nav().bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
  } catch (error: any) {
    if (error?.name === 'NotFoundError') throw new ReceiptPrinterError('Tidak ada printer yang dipilih.');
    throw new ReceiptPrinterError('Bluetooth tidak dapat dibuka. Pastikan Bluetooth perangkat menyala dan izin Bluetooth untuk browser diberikan.');
  }
  return bluetoothDevice;
}

export async function printViaBluetooth(data: Uint8Array, choose = false): Promise<string> {
  if (!supportsBluetooth()) throw new ReceiptPrinterError(isIos()
    ? 'Safari/Chrome di iPhone dan iPad tidak bisa memakai Bluetooth dari web. Buka hdhub di browser Bluefy.'
    : 'Browser ini tidak mendukung Bluetooth. Pakai Chrome atau Edge.');
  const device = await bluetoothDeviceToUse(choose);
  let characteristic: any;
  try {
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
    characteristic = await findWritable(server);
  } catch {
    bluetoothDevice = null;
    throw new ReceiptPrinterError(`Tidak dapat tersambung ke ${device.name || 'printer'}. Nyalakan printer, dekatkan, lalu coba lagi.`);
  }
  if (!characteristic) {
    device.gatt.disconnect?.();
    bluetoothDevice = null;
    throw new ReceiptPrinterError(`${device.name || 'Printer ini'} tidak menyediakan layanan cetak Bluetooth LE. Kemungkinan printer hanya Bluetooth Classic: di PC pakai "Lewat port COM", di Android pakai RawBT.`);
  }
  const withResponse = characteristic.properties.write && characteristic.writeValueWithResponse;
  await writeChunks((chunk) => (withResponse ? characteristic.writeValueWithResponse(chunk) : characteristic.writeValueWithoutResponse ? characteristic.writeValueWithoutResponse(chunk) : characteristic.writeValue(chunk)), data, 20, withResponse ? 0 : 15);
  const name = device.name || 'Printer Bluetooth';
  writeSaved({ kind: 'bluetooth', id: device.id, name });
  return name;
}

// --- Serial port (Bluetooth Classic paired on a computer, or USB) --------------
export async function printViaSerial(data: Uint8Array, choose = false): Promise<string> {
  if (!supportsSerial()) throw new ReceiptPrinterError('Browser ini tidak mendukung port COM. Pakai Chrome atau Edge di komputer.');
  let port: any = null;
  if (!choose) port = (await nav().serial.getPorts().catch(() => []))[0] ?? null;
  if (!port) {
    try { port = await nav().serial.requestPort(); }
    catch { throw new ReceiptPrinterError('Tidak ada port printer yang dipilih. Pair printer di pengaturan Bluetooth komputer dulu, lalu pilih port COM-nya.'); }
  }
  try {
    if (!port.writable) await port.open({ baudRate: 9600 });
    const writer = port.writable.getWriter();
    try { await writeChunks((chunk) => writer.write(chunk), data, 256); } finally { writer.releaseLock(); }
    await port.close().catch(() => undefined);
  } catch {
    throw new ReceiptPrinterError('Gagal mengirim ke port printer. Pastikan printer menyala dan tersambung, lalu coba lagi.');
  }
  const info = port.getInfo?.() ?? {};
  const name = info.bluetoothServiceClassId ? 'Printer Bluetooth (COM)' : 'Printer (COM)';
  writeSaved({ kind: 'serial', name });
  return name;
}

// --- RawBT app on Android ------------------------------------------------------
export const rawbtUrl = (data: Uint8Array) => {
  let binary = '';
  data.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `rawbt:base64,${btoa(binary)}`;
};
export const printViaRawbt = (data: Uint8Array) => { window.location.href = rawbtUrl(data); };

export const forgetPrinter = () => {
  try { bluetoothDevice?.gatt?.disconnect?.(); } catch { /* already gone */ }
  bluetoothDevice = null;
  writeSaved(null);
};
