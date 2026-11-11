// The request header is a summary of its lines. These are the rules from the
// approval spec, one assertion per rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRequestStatus } from '../src/requestStatus.ts';

const line = (status: string, requestedQuantity: number, approvedQuantity = 0) => ({ status, requestedQuantity, approvedQuantity });

test('a request with any pending line is still pending, whatever was decided already', () => {
  assert.equal(deriveRequestStatus([line('Pending', 3), line('Pending', 3)]), 'Pending');
  assert.equal(deriveRequestStatus([line('Approved', 3, 2), line('Pending', 3)]), 'Pending', 'Kasus 1 after A');
  assert.equal(deriveRequestStatus([line('Rejected', 3), line('Pending', 3)]), 'Pending', 'Kasus 2 after A');
  assert.equal(deriveRequestStatus([]), 'Pending');
});

test('every line approved in full is Approved', () => {
  assert.equal(deriveRequestStatus([line('Approved', 3, 3), line('Approved', 3, 3)]), 'Approved', 'Kasus 3');
});

test('every line rejected is Rejected', () => {
  assert.equal(deriveRequestStatus([line('Rejected', 3), line('Rejected', 3)]), 'Rejected');
});

test('a partial quantity, or approvals mixed with rejections, is Partially Approved', () => {
  assert.equal(deriveRequestStatus([line('Approved', 3, 2), line('Approved', 3, 3)]), 'Partially Approved');
  assert.equal(deriveRequestStatus([line('Approved', 3, 3), line('Rejected', 3)]), 'Partially Approved');
  assert.equal(deriveRequestStatus([line('Approved', 3, 2)]), 'Partially Approved');
  // Quantities may arrive as strings from the database driver.
  assert.equal(deriveRequestStatus([{ status: 'Approved', requestedQuantity: '3' as any, approvedQuantity: '3' as any }]), 'Approved');
});
