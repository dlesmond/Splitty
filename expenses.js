const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

// local state for table rendering and filters
const expState = {
  expenses: [],
  filters: { q: '', payer: 'All', from: '', to: '' },
  container: null,
  tbody: null,
  expanded: new Set()
};

const filterInputs = {};

function renderExpenses() {
  const container = document.getElementById('expensesContainer');
  if (!container) return;
  expState.container = container;
  expState.expenses = (window.state?.expenses || []).slice();
  container.innerHTML = '';

  const filtersBar = document.createElement('div');
  filtersBar.className = 'expenses-filters';
  filtersBar.innerHTML = `
    <input type="search" placeholder="Search" aria-label="Search description" class="filter-q" />
    <select class="filter-payer" aria-label="Filter by payer"><option value="All">All</option></select>
    <input type="date" class="filter-from" aria-label="From date" />
    <input type="date" class="filter-to" aria-label="To date" />
  `;
  container.appendChild(filtersBar);

  filterInputs.q = filtersBar.querySelector('.filter-q');
  filterInputs.payer = filtersBar.querySelector('.filter-payer');
  filterInputs.from = filtersBar.querySelector('.filter-from');
  filterInputs.to = filtersBar.querySelector('.filter-to');

  // populate payers
  const payers = Array.from(new Set(expState.expenses.map(e => e.payer))).sort();
  payers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    filterInputs.payer.appendChild(opt);
  });

  const table = document.createElement('table');
  table.className = 'table expenses-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th class="date">Date</th>
        <th class="desc">Description</th>
        <th class="people">People</th>
        <th class="amount num">Amount</th>
        <th class="splitRule">Split rule</th>
        <th class="perPerson num">Per-person</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  container.appendChild(table);
  expState.tbody = table.querySelector('tbody');

  const debounced = debounce(applyFilters, 250);
  filterInputs.q.addEventListener('input', debounced);
  filterInputs.payer.addEventListener('change', debounced);
  filterInputs.from.addEventListener('change', debounced);
  filterInputs.to.addEventListener('change', debounced);

  render();
}

function setFilters(f) {
  Object.assign(expState.filters, f);
  if (filterInputs.q) filterInputs.q.value = expState.filters.q || '';
  if (filterInputs.payer) filterInputs.payer.value = expState.filters.payer || 'All';
  if (filterInputs.from) filterInputs.from.value = expState.filters.from || '';
  if (filterInputs.to) filterInputs.to.value = expState.filters.to || '';
  render();
}

function applyFilters() {
  expState.filters.q = filterInputs.q.value;
  expState.filters.payer = filterInputs.payer.value;
  expState.filters.from = filterInputs.from.value;
  expState.filters.to = filterInputs.to.value;
  render();
}

function render() {
  const tbody = expState.tbody;
  tbody.innerHTML = '';

  const filtered = expState.expenses.filter(e => {
    if (expState.filters.q && !e.description.toLowerCase().includes(expState.filters.q.toLowerCase())) return false;
    if (expState.filters.payer !== 'All' && e.payer !== expState.filters.payer) return false;
    if (expState.filters.from && e.date < expState.filters.from) return false;
    if (expState.filters.to && e.date > expState.filters.to) return false;
    return true;
  }).sort((a,b) => b.date.localeCompare(a.date));

  let currentMonth = '';
  filtered.forEach(exp => {
    const month = formatMonth(exp.date);
    if (month !== currentMonth) {
      currentMonth = month;
      const mtr = document.createElement('tr');
      mtr.className = 'monthHeader';
      const mth = document.createElement('th');
      mth.colSpan = 6;
      mth.textContent = month;
      mtr.appendChild(mth);
      tbody.appendChild(mtr);
    }

    const tr = document.createElement('tr');
    tr.className = 'expense-row';
    tr.tabIndex = 0;
    tr.dataset.id = exp.id;
    tr.innerHTML = `
      <td class="date">${formatDate(exp.date)}</td>
      <td class="desc truncate" title="${escapeHtml(exp.description)}">${escapeHtml(exp.description)}</td>
      <td class="people">${escapeHtml(exp.participants.map(p=>p.name).join(', '))}</td>
      <td class="amount num">${currency.format(exp.amount)}</td>
      <td class="splitRule">${splitIcon(exp.splitRule)}</td>
      <td class="perPerson num">${exp.participants.map(p => `${escapeHtml(p.name)} ${currency.format(p.share)}`).join(' &middot; ')}</td>
    `;
    tr.addEventListener('click', () => toggleRow(exp.id));
    tr.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRow(exp.id); }
    });
    tbody.appendChild(tr);
    if (expState.expanded.has(exp.id)) {
      tbody.appendChild(renderDetailsRow(exp));
    }
  });
}

function renderDetailsRow(exp) {
  const tr = document.createElement('tr');
  tr.className = 'details-row';
  const td = document.createElement('td');
  td.colSpan = 6;
  td.className = 'details';
  const people = exp.participants.map(p=>p.name).join(', ');
  const notes = exp.notes ? `<div class="small">${escapeHtml(exp.notes)}</div>` : '';
  const creator = exp.createdBy ? `<div class="small">Added by ${escapeHtml(exp.createdBy)}</div>` : '';
  const receipt = exp.receiptUrl ? `<div><a href="${exp.receiptUrl}" target="_blank" rel="noopener">Receipt</a></div>` : '';
  td.innerHTML = `<div class="small">People: ${escapeHtml(people)}</div>${notes}${creator}${receipt}<div class="actions"><button class="btn-edit">Edit</button><button class="btn-delete">Delete</button></div>`;
  tr.appendChild(td);

  td.querySelector('.btn-edit').addEventListener('click', e => {
    e.stopPropagation();
    startEdit(exp.id);
  });
  td.querySelector('.btn-delete').addEventListener('click', e => {
    e.stopPropagation();
    expState.container.dispatchEvent(new CustomEvent('deleteExpense', { detail: { id: exp.id } }));
  });
  return tr;
}

function startEdit(id) {
  const tr = expState.tbody.querySelector(`tr.expense-row[data-id="${id}"]`);
  if (!tr) return;
  const descCell = tr.querySelector('.desc');
  const amountCell = tr.querySelector('.amount');
  const origDesc = descCell.textContent;
  const origAmt = amountCell.textContent;

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.value = origDesc;
  descCell.innerHTML = '';
  descCell.appendChild(descInput);
  descInput.focus();

  const amtInput = document.createElement('input');
  amtInput.type = 'number';
  amtInput.step = '0.01';
  amtInput.value = parseFloat(origAmt.replace(/[^0-9.-]/g,'')) || 0;
  amountCell.innerHTML = '';
  amountCell.appendChild(amtInput);

  function finish(save) {
    if (save) {
      const patch = { description: descInput.value, amount: parseFloat(amtInput.value) };
      descCell.textContent = patch.description;
      descCell.title = patch.description;
      amountCell.textContent = currency.format(patch.amount);
      expState.container.dispatchEvent(new CustomEvent('updateExpense', { detail: { id, patch } }));
    } else {
      descCell.textContent = origDesc;
      descCell.title = origDesc;
      amountCell.textContent = origAmt;
    }
  }

  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  }

  descInput.addEventListener('keydown', onKey);
  amtInput.addEventListener('keydown', onKey);
  descInput.addEventListener('blur', () => finish(true));
  amtInput.addEventListener('blur', () => finish(true));
}

function toggleRow(id) {
  if (expState.expanded.has(id)) expState.expanded.delete(id); else expState.expanded.add(id);
  render();
}

function formatMonth(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('en-AU', { month: 'long', year: 'numeric' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function splitIcon(rule) {
  const map = {
    equal: { emoji: '⚖️', label: 'Equal split' },
    custom: { emoji: '🧩', label: 'Custom split' },
    percent: { emoji: '📊', label: 'Percent split' }
  };
  const m = map[rule] || map.equal;
  return `<span role="img" aria-label="${m.label}" title="${m.label}">${m.emoji}</span>`;
}

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function debounce(fn, delay) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), delay);
  };
}

window.renderExpenses = renderExpenses;
window.setFilters = setFilters;
