import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { attendanceDay, HdAttendanceClient, normalizeHdAttendanceBase } from '../src/finance/hdAttendanceClient.ts';
import { daySalary } from '../src/finance/hdAttendanceSync.ts';

test('attendance dates come as the UTC instant of Jakarta midnight and are read back as the Jakarta day', () => {
  assert.equal(attendanceDay('2026-11-16T17:00:00.000Z'), '2026-11-17');
  assert.equal(attendanceDay('2026-11-17'), '2026-11-17');
  assert.equal(attendanceDay('17/11/2026'), null);
  assert.equal(attendanceDay(null), null);
});

test('the docs URL copied from the browser gives the API base', () => {
  for (const raw of ['https://hdattendance.kii.lat/api/docs/', 'https://hdattendance.kii.lat/api', 'https://hdattendance.kii.lat']) {
    assert.equal(normalizeHdAttendanceBase(raw).href, 'https://hdattendance.kii.lat/api/', raw);
  }
  assert.throws(() => normalizeHdAttendanceBase('http://hdattendance.kii.lat/api/'));
});

test('day salary: present × daily wage; other statuses and missing wages are not paid', () => {
  const s = daySalary([{ status: 'present', dailyWage: '50000', positionName: 'Staff/1' }, { status: 'present', dailyWage: '50000.000000', positionName: 'Staff/1' },
    { status: 'present', dailyWage: '80000', positionName: 'Leader/3' }, { status: 'present', dailyWage: null, positionName: null }, { status: 'sick', dailyWage: '50000', positionName: 'Staff/1' }]);
  assert.deepEqual([s.amount, s.paid, s.withoutWage], ['180000.000000', 3, 1]);
  assert.equal(s.breakdown, '1 × Leader/3 Rp80.000, 2 × Staff/1 Rp50.000');
});

test('client over HTTP: sends the key and a client name, reads the real response shape, filters the period', async t => {
  const seen: Record<string, string | undefined>[] = [];
  const data: Record<string, unknown> = {
    '/api/outlets': [{ id: '1', name: 'Cisalak', outlet_code: 'CISALAK' }],
    '/api/positions': [{ id: '1', name: 'Staff/1', dailyWage: 50000 }],
    '/api/employees': [{ id: 42, employee_code: 'HD-1', name: 'x', position_id: 1, position_name: 'Staff/1', status: 'active', phone: '08', join_date: null }],
    '/api/attendance': [
      { id: 320, employee_id: 42, attendance_date: '2026-11-16T17:00:00.000Z', check_in: '13:13:00', check_out: null, work_hours: '0.00', overtime_hours: '0.00', status: 'present', outlet_id: 1, outlet_name: 'Cisalak' },
      { id: 200, employee_id: 42, attendance_date: '2026-10-20T17:00:00.000Z', status: 'present', outlet_id: 1, outlet_name: 'Cisalak' },
      { id: 'x' },
    ],
  };
  const server = createServer((req, res) => {
    seen.push({ key: req.headers['x-api-key'] as string, agent: req.headers['user-agent'] });
    if (req.headers['x-api-key'] !== 'k'.repeat(64)) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"API key tidak valid."}'); return; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data[req.url ?? ''] ?? []));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/docs/`;
  const client = new HdAttendanceClient(base, 'k'.repeat(64));
  assert.deepEqual(await client.outlets(), [{ id: 1, name: 'Cisalak' }]);
  assert.deepEqual(await client.positions(), [{ id: 1, name: 'Staff/1', dailyWage: '50000.00' }]);
  assert.deepEqual(await client.employees(), [{ id: 42, positionId: 1 }], 'names and phone numbers are not read');
  const { rows, errors } = await client.attendance('2026-11-01', '2026-11-17');
  assert.deepEqual(rows, [{ id: 320, employeeId: 42, outletId: 1, outletName: 'Cisalak', date: '2026-11-17', status: 'present' }]);
  assert.equal(errors.length, 1);
  assert.equal(seen[0].agent, 'hdhub-finance/1.0');
  await assert.rejects(new HdAttendanceClient(base, 'wrong').outlets(), /ditolak \(401\)/);
});
