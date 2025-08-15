const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateAggregates } = require('../balances.js');

test('payer settles full amount → Net goes to 0', () => {
  const people = ['A','B'];
  const expenses = [{ amount:20, payer:'A', participants:['A','B'], shares:{A:10, B:10} }];
  const settlements = [{ fromUserId:'B', toUserId:'A', amount:10, date:'2024-01-01' }];
  const { net, settled } = calculateAggregates(people, expenses, settlements);
  assert.equal(net.A, 0);
  assert.equal(net.B, 0);
  assert.equal(settled.B, 10);
  assert.equal(settled.A, -10);
});

test('partial settlement reduces net', () => {
  const people = ['A','B'];
  const expenses = [{ amount:20, payer:'A', participants:['A','B'], shares:{A:10, B:10} }];
  const settlements = [{ fromUserId:'B', toUserId:'A', amount:5, date:'2024-01-01' }];
  const { net } = calculateAggregates(people, expenses, settlements);
  assert.equal(net.A, 5);
  assert.equal(net.B, -5);
});

test('receiver gets money → Settled negative and net closer to zero', () => {
  const people = ['A','B'];
  const expenses = [{ amount:20, payer:'A', participants:['A','B'], shares:{A:10, B:10} }];
  const settlements = [{ fromUserId:'B', toUserId:'A', amount:4, date:'2024-01-01' }];
  const { settled, net } = calculateAggregates(people, expenses, settlements);
  assert.equal(settled.A, -4);
  assert.equal(net.A, 6);
  assert.equal(net.B, -6);
});
