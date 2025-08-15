(function(global){
  'use strict';
  function calculateAggregates(people = [], expenses = [], settlements = []){
    const paid    = Object.fromEntries(people.map(p => [p, 0]));
    const owed    = Object.fromEntries(people.map(p => [p, 0]));
    const settled = Object.fromEntries(people.map(p => [p, 0]));
    expenses.forEach(e => {
      paid[e.payer] = (paid[e.payer] || 0) + (e.amount || 0);
      if (e.shares){
        Object.entries(e.shares).forEach(([p, share]) => {
          owed[p] = (owed[p] || 0) + share;
        });
      }
    });
    settlements.forEach(s => {
      settled[s.fromUserId] = (settled[s.fromUserId] || 0) + s.amount;
      settled[s.toUserId]   = (settled[s.toUserId]   || 0) - s.amount;
    });
    const net = Object.fromEntries(
      people.map(p => [p, (paid[p] || 0) - (owed[p] || 0) + (settled[p] || 0)])
    );
    return { paid, owed, settled, net };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { calculateAggregates };
  global.calculateAggregates = calculateAggregates;
})(typeof window !== 'undefined' ? window : globalThis);
