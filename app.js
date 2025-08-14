// app.js
(() => {
  'use strict';

  // ---------- small utils ----------
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const sum = (arr) => arr.reduce((a,b)=>a+b,0);
  const currency = (n) => (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
  const parseList = (str) => (str||'').split(',').map(s=>s.trim()).filter(Boolean);
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  function safeJSON(s){ try{ return JSON.parse(s); } catch { return null; } }

  // ---------- Firebase: ensure ready, then init ----------
  const firebaseConfig = {
    apiKey: "AIzaSyCk5BXVN51kMleIjjHIhMvJVViDnk4WAgo",
    authDomain: "splitty-c4ba4.firebaseapp.com",
    projectId: "splitty-c4ba4",
    storageBucket: "splitty-c4ba4.firebasestorage.app",
    messagingSenderId: "160510593981",
    appId: "1:160510593981:web:2734bda058ea2822bea0d4",
    measurementId: "G-SNY2QQPNGL"
  };

  let auth = null;
  let db   = null;

  async function ensureFirebaseReady(timeoutMs = 5000){
    const start = performance.now();
    while (!(window.firebase && firebase.auth && firebase.firestore)) {
      if (performance.now() - start > timeoutMs) return false;
      await sleep(50);
    }
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db   = firebase.firestore();
    return true;
  }

  // ---------- app state ----------
  const GROUP_ID = 'couple';
  let state = safeJSON(localStorage.getItem('spl-lite')) ?? { people: [], expenses: [] };

  // ---------- save status pill ----------
  let _saveTimer = null;
  function setStatus(text, mode) {
    const el = $('#saveStatus');
    if (!el) return;
    el.style.color = (mode === 'ok') ? 'var(--accent)' : '#fbbf24';
    const spans = el.querySelectorAll('span');
    if (spans.length) spans[spans.length - 1].textContent = text;
  }
  function markSaving(){ setStatus('Syncing…','sync'); }
  function markSaved(){
    setStatus('Saved • just now','ok');
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(()=> setStatus('Saved','ok'), 4000);
  }

  // ---------- local + cloud save ----------
  function save(){
    localStorage.setItem('spl-lite', JSON.stringify(state));
    if (!auth || !auth.currentUser || !db) { markSaved(); return; }
    markSaving();
    const docRef = db.collection('groups').doc(GROUP_ID);
    const payload = {
      people: state.people || [],
      expenses: state.expenses || [],
      members: firebase.firestore.FieldValue.arrayUnion(auth.currentUser.uid),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    docRef.set(payload, { merge: true })
      .then(markSaved)
      .catch(err => {
        console.error('save->firestore', err);
        setStatus('Sync failed','sync');
      });
  }

  // ---------- last-used participants ----------
  const LAST_KEY = 'spl-last-participants';
  const getLastParticipants = () => (safeJSON(localStorage.getItem(LAST_KEY)) ?? []);
  const setLastParticipants = (list) => localStorage.setItem(LAST_KEY, JSON.stringify(list||[]));

  // ---------- split builder ----------
  function buildShares({amount, participants, splitType, rawVals}){
    const shares = {};
    if (participants.length === 0) return shares;

    if (splitType === 'equal'){
      const each = amount / participants.length;
      participants.forEach(p => shares[p] = each);
      return shares;
    }

    const vals = parseList(rawVals||'').map(v=>v.toLowerCase());
    if(vals.length!==participants.length) throw new Error('Value count must match participants.');
    const rCount = vals.filter(v=>v==='r').length;
    if(rCount>0 && splitType==='shares') throw new Error('"r" is not supported for Shares.');
    if(rCount>1) throw new Error('Only one "r" (remainder) is allowed.');
    const nums = vals.map(v=> v==='r' ? NaN : parseFloat(v));
    if(nums.some((n,i)=> vals[i] !== 'r' && (isNaN(n) || !isFinite(n)))) throw new Error('Please enter numeric values (or a single r).');

    if (splitType === 'percent'){
      if(rCount===1){
        const rIndex=vals.indexOf('r');
        const known=nums.filter(n=>!isNaN(n));
        nums[rIndex] = 100 - sum(known);
      }
      const total = sum(nums);
      if (Math.abs(total-100) > 0.01) throw new Error('Percents must sum to 100.');
      participants.forEach((p,i)=> shares[p] = amount*(nums[i]/100));
      return shares;
    }

    if (splitType === 'shares'){
      const total = sum(nums);
      if (total<=0) throw new Error('Shares must be positive.');
      participants.forEach((p,i)=> shares[p] = amount*(nums[i]/total));
      return shares;
    }

    if (splitType === 'exact'){
      if(rCount===1){
        const rIndex=vals.indexOf('r');
        const known=nums.filter(n=>!isNaN(n));
        nums[rIndex] = amount - sum(known);
      }
      const total = sum(nums);
      if (Math.abs(total-amount) > 0.01) throw new Error('Exact values must sum to the total amount.');
      participants.forEach((p,i)=> shares[p] = nums[i]);
      return shares;
    }

    throw new Error('Unknown split type.');
  }

  // ---------- balances math ----------
  function calculateNet(people, expenses){
    const paid=Object.fromEntries(people.map(p=>[p,0]));
    const owed=Object.fromEntries(people.map(p=>[p,0]));
    expenses.forEach(e=>{
      if (e.splitType === 'settlement'){
        const [from,to] = e.participants;
        const amt = (e.shares && e.shares[to]) ? e.shares[to] : (e.amount||0);
        paid[from] = (paid[from]||0) + amt;
        owed[to]   = (owed[to]||0)  + amt;
        return;
      }
      paid[e.payer] = (paid[e.payer]||0) + e.amount;
      if (e.shares){
        Object.entries(e.shares).forEach(([p,share])=>{
          owed[p] = (owed[p]||0) + share;
        });
      }
    });
    const net = Object.fromEntries(people.map(p=>[p,(paid[p]||0)-(owed[p]||0)]));
    return { paid, owed, net };
  }

  // ---------- UI: People / chips / payer select ----------
  function renderPeople(){
    const chips = $('#chips');
    if (chips) chips.innerHTML='';
    if (state.people.length>0 && chips){
      const allBtn = document.createElement('button');
      allBtn.className='tag all';
      allBtn.textContent='ALL';
      allBtn.onclick = ()=>{ $('#participants').value = state.people.join(', '); updateSplitUI(); };
      chips.appendChild(allBtn);
      const sep = document.createElement('span');
      sep.className='chip-divider';
      chips.appendChild(sep);
    }
    if (chips){
      state.people.forEach(p=>{
        const b = document.createElement('button');
        b.className='tag';
        b.textContent=p;
        b.onclick=()=>toggleParticipant(p);
        chips.appendChild(b);
      });
    }
    const payer = $('#payer');
    if (payer) payer.innerHTML = state.people.map(p=>`<option value="${p}">${p}</option>`).join('');
    const list = $('#peopleList');
    if (list) list.textContent = state.people.length ? `People: ${state.people.join(', ')}` : 'No people yet — add some above.';

    const last = getLastParticipants().filter(n=>state.people.includes(n));
    const inp = $('#participants');
    if (inp && !inp.value.trim() && last.length) inp.value = last.join(', ');

    updateSplitUI();
  }
  function toggleParticipant(name){
    const input=$('#participants'); if(!input) return;
    const list=parseList(input.value);
    const i=list.indexOf(name);
    if(i>=0) list.splice(i,1); else list.push(name);
    input.value=list.join(', ');
    updateSplitUI();
  }

  // ---------- add person / expense / settlement ----------
  function addPerson(){
    const name = ($('#personName')?.value || '').trim();
    if(!name) return;
    if(state.people.includes(name)) return alert('That name already exists.');
    state.people.push(name);
    $('#personName').value='';
    save(); renderPeople();
  }

  function addExpense(){
    const date = $('#date')?.value || todayISO();
    const desc = ($('#desc')?.value || '').trim() || 'Expense';
    const amount = parseFloat($('#amount')?.value ?? 'NaN');

    // allow negative (but not zero)
    if (isNaN(amount) || amount === 0) return alert('Enter a non-zero amount (positive or negative).');

    const payer = $('#payer')?.value || '';
    const participants = parseList($('#participants')?.value || '');
    const splitType = $('#splitType')?.value || 'equal';

    if(!payer) return alert('Pick a payer.');
    if(participants.length===0) return alert('Pick at least one participant.');

    const rawInput = (splitType==='equal') ? 'equal' : (($('#splitValues')?.value)||'').trim();
    let shares={};
    try{
      shares = buildShares({amount, participants, splitType, rawVals:(splitType==='equal')?'':rawInput});
    }catch(err){
      return alert(err.message||String(err));
    }

    state.expenses.push({
      id: crypto.randomUUID(),
      date, desc, amount, payer, participants, shares,
      splitType, rawSplit: rawInput
    });

    setLastParticipants(participants);
    const lastAfter = getLastParticipants().filter(n=>state.people.includes(n));
    $('#participants').value = lastAfter.join(', ');
    if ($('#desc'))   $('#desc').value='';
    if ($('#amount')) $('#amount').value='';
    if ($('#splitValues')) $('#splitValues').value='';

    save(); renderExpenses(); computeBalances(); updateSplitUI();
  }

  function addExactSettlement(from, to, amount, date = null, viaModal=false){
    const when = date || todayISO();
    const desc = `Settle up: ${from} → ${to}`;
    const participants=[from,to];
    const shares={ [to]: amount };
    state.expenses.push({
      id: crypto.randomUUID(),
      date: when, desc, amount, payer: from, participants, shares,
      splitType: 'settlement', rawSplit: `${from}->${to}:${amount}`
    });
    save(); if(viaModal) closeSettleModal(); renderExpenses(); computeBalances();
  }

  function addSettlement(){
    const from = $('#settleFrom')?.value;
    const to   = $('#settleTo')?.value;
    const amt  = parseFloat($('#settleAmount')?.value||'NaN');
    const date = $('#settleDate')?.value || todayISO();
    if(!from||!to||from===to) return alert('Choose two different people.');
    if(isNaN(amt) || amt<=0)  return alert('Enter a valid amount.');
    addExactSettlement(from,to,amt,date,true);
  }

  // ---------- edit / delete ----------
  let editingId = null;

  function openEditModal(id){
    editingId = id;
    const e = state.expenses.find(x=>x.id===id); if(!e) return;
    $('#editTitle').textContent = e.splitType==='settlement' ? 'Edit settlement' : 'Edit expense';

    $('#editPayer').innerHTML = state.people.map(p=>`<option value="${p}">${p}</option>`).join('');
    $('#editFrom').innerHTML  = state.people.map(p=>`<option value="${p}">${p}</option>`).join('');
    $('#editTo').innerHTML    = state.people.map(p=>`<option value="${p}">${p}</option>`).join('');

    if (e.splitType === 'settlement'){
      $('#editNormal').style.display='none';
      $('#editSettlement').style.display='block';
      const [from,to] = e.participants;
      const amt = e.shares && e.shares[to] ? e.shares[to] : e.amount;
      $('#editFrom').value = from;
      $('#editTo').value   = to;
      $('#editSettleAmount').value = amt;
      $('#editSettleDate').value   = e.date || '';
    } else {
      $('#editNormal').style.display='block';
      $('#editSettlement').style.display='none';
      $('#editDate').value  = e.date || '';
      $('#editDesc').value  = e.desc || '';
      $('#editAmount').value = e.amount;
      $('#editPayer').value  = e.payer;
      $('#editSplitType').value = e.splitType || 'equal';
      $('#editParticipants').value = (e.participants||[]).join(', ');
      $('#editSplitValues').value  = e.splitType==='equal' ? '' : (e.rawSplit||'');
      updateEditSplitUI();
    }
    $('#editModal').classList.remove('hidden');
  }
  function closeEditModal(){ editingId=null; $('#editModal').classList.add('hidden'); }

  function updateEditSplitUI(){
    const type=$('#editSplitType').value;
    const row=$('#editSplitRow'); const label=$('#editSplitLabel'); const hint=$('#editSplitHint');
    if(type==='equal'){ row.style.display='none'; return; }
    row.style.display='block';
    label.textContent = `Split values (${type})`;
    const names = parseList($('#editParticipants').value);
    hint.textContent = names.length? `Expecting ${names.length} values — order: ${names.join(', ')}` : 'Add participants to know how many values to enter.';
  }

  function saveEdit(){
    if(!editingId) return;
    const i = state.expenses.findIndex(x=>x.id===editingId);
    if(i<0) return;
    const cur = state.expenses[i];

    if (cur.splitType==='settlement'){
      const from=$('#editFrom').value;
      const to=$('#editTo').value;
      const amt=parseFloat($('#editSettleAmount').value);
      const date=$('#editSettleDate').value || todayISO();
      if(!from||!to||from===to) return alert('Choose two different people.');
      if(isNaN(amt) || amt<=0)  return alert('Enter a valid amount.');
      const participants=[from,to];
      const shares={ [to]: amt };
      state.expenses[i] = {
        ...cur, date, desc:`Settle up: ${from} → ${to}`, amount:amt, payer:from, participants,
        shares, splitType:'settlement', rawSplit:`${from}->${to}:${amt}`
      };
    } else {
      const date = $('#editDate').value || todayISO();
      const desc = ($('#editDesc').value || '').trim() || 'Expense';
      const amount = parseFloat($('#editAmount').value);
      if(isNaN(amount) || amount===0) return alert('Enter a non-zero amount.');
      const payer = $('#editPayer').value || '';
      if(!payer) return alert('Pick a payer.');
      const participants = parseList($('#editParticipants').value);
      if(participants.length===0) return alert('Pick at least one participant.');
      const splitType = $('#editSplitType').value;
      const rawInput = (splitType==='equal') ? 'equal' : ($('#editSplitValues').value||'').trim();
      let shares = {};
      try{
        shares = buildShares({amount, participants, splitType, rawVals:(splitType==='equal')?'':rawInput});
      }catch(err){ return alert(err.message||String(err)); }
      state.expenses[i] = { ...cur, date, desc, amount, payer, participants, shares, splitType, rawSplit: rawInput };
    }
    save(); closeEditModal(); renderExpenses(); computeBalances();
  }

  // perform the actual deletion (kept same name)
  function deleteExpense(id){
    const i=state.expenses.findIndex(e=>e.id===id);
    if(i>=0){ state.expenses.splice(i,1); save(); renderExpenses(); computeBalances(); }
  }

  // ---------- generic confirm modal (reuses your #confirmModal) ----------
  function confirmAction({ title='Are you sure?', message='', okText='OK', cancelText='Cancel' } = {}){
    const modal = $('#confirmModal');
    if (!modal) {
      // Fallback if modal markup is missing
      return Promise.resolve(confirm(title));
    }
    const titleEl   = $('#confirmTitle');
    const textEl    = modal.querySelector('.modal-card p');
    const okBtn     = $('#confirmOk');
    const cancelBtn = $('#confirmCancel');

    // apply content
    if (titleEl) titleEl.textContent = title;
    if (textEl)  textEl.textContent  = message;
    if (okBtn) okBtn.textContent = okText;
    if (cancelBtn) cancelBtn.textContent = cancelText;

    // show
    modal.classList.remove('hidden');

    return new Promise((resolve)=>{
      const cleanup = ()=>{
        modal.classList.add('hidden');
        okBtn?.removeEventListener('click', onOk);
        cancelBtn?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onEsc);
        modal.removeEventListener('click', onBackdrop);
      };
      const onOk = ()=>{ cleanup(); resolve(true); };
      const onCancel = ()=>{ cleanup(); resolve(false); };
      const onEsc = (e)=>{ if(e.key==='Escape'){ onCancel(); } };
      const onBackdrop = (e)=>{ if(e.target === modal){ onCancel(); } };

      okBtn?.addEventListener('click', onOk);
      cancelBtn?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onEsc);
      modal.addEventListener('click', onBackdrop);
    });
  }

  // wrapper to confirm deletion with details
  async function confirmDelete(id){
    const e = state.expenses.find(x=>x.id===id);
    const desc = e?.desc || 'Entry';
    const amt  = e ? `$${currency(e.amount)}` : '';
    const msg  = e
      ? `This will permanently remove “${desc}” (${amt}). This cannot be undone.`
      : `This will permanently remove this entry. This cannot be undone.`;
    const yes = await confirmAction({
      title: 'Delete this entry?',
      message: msg,
      okText: 'Delete',
      cancelText: 'Cancel'
    });
    if (yes) deleteExpense(id);
  }

  // ---------- render: expenses (newest first) ----------
  function renderExpenses(){
    function formatRule(e){
      if(e.splitType==='settlement') return 'settlement';
      if(e && typeof e.rawSplit==='string' && e.rawSplit.length){ return `${e.splitType||'custom'}: ${e.rawSplit}`; }
      if(e && e.shares && e.participants){
        const vals=e.participants.map(p=>e.shares[p]||0);
        const allEq=vals.length>0 && vals.every(v=>Math.abs(v-vals[0])<0.01);
        return allEq? 'equal':'custom';
      }
      return '';
    }
    function formatAmounts(e){
      if(e.splitType==='settlement'){
        const [from,to]=e.participants;
        const amt = e.shares && e.shares[to] ? e.shares[to] : e.amount;
        return `${from} → ${to}: $${currency(amt)}`;
      }
      if(e && e.shares && e.participants){
        return e.participants.map(p=>`${p}: $${currency(e.shares[p]||0)}`).join(', ');
      }
      return '';
    }

    const tbody = $('#expensesTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // newest → oldest
    const items = state.expenses.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));

    items.forEach(e=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-label="Date">${e.date}</td>
        <td data-label="Description">${e.desc}</td>
        <td class="mono" data-label="Payer">${e.payer}</td>
        <td class="mono" data-label="Participants">${e.participants.join(', ')}</td>
        <td data-label="Amount">$${currency(e.amount)}</td>
        <td class="mono split-rule" data-label="Split rule">${formatRule(e)}</td>
        <td class="mono split-amts" data-label="Split amounts">${formatAmounts(e)}</td>
        <td class="right" data-label="Actions">
          <button class="btn-ghost icon btn-edit" style="color:#f59e0b" title="Edit" data-id="${e.id}">✎</button>
          <button class="btn-ghost icon btn-del"  style="color:#ef4444" title="Delete" data-id="${e.id}">✕</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  // ---------- render: balances + suggestions ----------
  function computeBalances(){
    const {net, paid, owed} = calculateNet(state.people, state.expenses);
    const wrap = $('#balances'); if(!wrap) return;
    wrap.innerHTML='';
    state.people.forEach(p=>{
      const paidVal = paid[p]||0;
      const owesVal = owed[p]||0;
      const n = net[p]||0;
      const card = document.createElement('div');
      card.className='balcard';
      card.innerHTML = `
        <div class="bal-name">${p}</div>
        <div class="bal-row"><span class="label">Paid</span><span class="bal-amt mono">$${currency(paidVal)}</span></div>
        <div class="bal-sep"></div>
        <div class="bal-row"><span class="label">Owes</span><span class="bal-amt mono">$${currency(owesVal)}</span></div>
        <div class="bal-sep"></div>
        <div class="bal-row"><span class="label">Net</span><span class="bal-amt mono ${n>=0?'pos':'neg'}">${n>=0?'+':'-'}$${currency(Math.abs(n))}</span></div>
      `;
      wrap.appendChild(card);
    });
    renderSettlements(net);
  }

  function renderSettlements(net){
    const creditors=[], debtors=[];
    Object.entries(net).forEach(([p,amt])=>{
      if(amt>0.005) creditors.push({p,amt});
      else if(amt<-0.005) debtors.push({p,amt:-amt});
    });
    creditors.sort((a,b)=>b.amt-a.amt);
    debtors.sort((a,b)=>b.amt-a.amt);

    const txns=[];
    let i=0,j=0;
    while(i<debtors.length && j<creditors.length){
      const pay=Math.min(debtors[i].amt, creditors[j].amt);
      txns.push({from:debtors[i].p, to:creditors[j].p, amt:pay});
      debtors[i].amt-=pay; creditors[j].amt-=pay;
      if(debtors[i].amt<0.005) i++;
      if(creditors[j].amt<0.005) j++;
    }

    const wrap = $('#settlements'); if(!wrap) return;
    wrap.innerHTML='';
    if(txns.length===0){
      wrap.innerHTML = '<p class="muted">No payments needed — all square.</p>';
      return;
    }
    const tbl = document.createElement('table');
    tbl.innerHTML = '<thead><tr><th>From</th><th>To</th><th class="right">Amount</th><th class="right">Actions</th></tr></thead>';
    const tbody = document.createElement('tbody');
    txns.forEach(t=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${t.from}</td><td>${t.to}</td><td class="right">$${currency(t.amt)}</td>
        <td class="right">
          <button class="btn-ghost use-suggestion" data-from="${t.from}" data-to="${t.to}" data-amt="${t.amt}">Use</button>
          <button class="btn-ghost pay-suggestion" data-from="${t.from}" data-to="${t.to}" data-amt="${t.amt}">Pay</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    const actions = document.createElement('div');
    actions.className='right';
    actions.innerHTML = '<button class="btn-ghost pay-all">Pay all</button>';
    wrap.appendChild(actions);
    wrap.dataset.txns = JSON.stringify(txns);
  }

  // ---------- export / import / reset ----------
  function exportJSON(){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='splitty-data.json';
    a.click();
  }
  function importJSON(file){
    const reader=new FileReader();
    reader.onload=e=>{
      try{
        const data=JSON.parse(e.target.result);
        if(!Array.isArray(data.people)||!Array.isArray(data.expenses)) throw 0;
        state.people=data.people; state.expenses=data.expenses;
        save(); renderPeople(); renderExpenses(); computeBalances();
      }catch{ alert('Invalid file.'); }
    };
    reader.readAsText(file);
  }

  // generic confirm for reset; keeps original function name for wiring
  async function openResetConfirm(){
    const yes = await confirmAction({
      title: 'Reset all data?',
      message: 'This will remove all people and transactions. This cannot be undone.',
      okText: 'Yes, reset',
      cancelText: 'Cancel'
    });
    if (yes) doReset();
  }
  function doReset(){
    state.people=[]; state.expenses=[];
    localStorage.removeItem(LAST_KEY);
    save(); renderPeople(); renderExpenses(); computeBalances(); updateSplitUI();
    setStatus('Synced from cloud','ok');
  }

  // ---------- split UI hints ----------
  function updateSplitUI(){
    const type = $('#splitType')?.value;
    const row  = $('#splitValuesRow');
    const hint = $('#splitValuesHint');
    const label= $('#splitValuesLabel');
    const names = parseList($('#participants')?.value || '');
    if(!row || !label || !hint) return;
    if(type==='equal'){ row.style.display='none'; return; }
    row.style.display='block';
    label.textContent = `Split values (${type})`;
    hint.textContent = names.length>0 ? `Expecting ${names.length} values — order should match: ${names.join(', ')}` : 'Add participants to know how many values to enter.';
  }

  // ---------- theme ----------
  function applyTheme(theme){
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('spl-theme', theme);
    const btn = $('#themeToggle');
    if (btn) btn.textContent = theme==='light' ? '🌙 Dark' : '☀️ Light';
  }

  // ---------- settle modal ----------
  function openSettleModal(prefFrom=null,prefTo=null,prefAmt=null){
    const fromSel=$('#settleFrom'); const toSel=$('#settleTo');
    if (!fromSel || !toSel) return;
    fromSel.innerHTML = state.people.map(p=>`<option value="${p}">${p}</option>`).join('');
    toSel.innerHTML   = state.people.map(p=>`<option value="${p}">${p}</option>`).join('');
    const {net} = calculateNet(state.people, state.expenses);
    const debtor   = Object.entries(net).sort((a,b)=>a[1]-b[1])[0]?.[0];
    const creditor = Object.entries(net).sort((a,b)=>b[1]-a[1])[0]?.[0];
    fromSel.value = prefFrom || debtor || state.people[0] || '';
    toSel.value   = prefTo   || creditor || state.people[1] || '';
    $('#settleAmount').value = (prefAmt!=null) ? String(prefAmt) : '';
    $('#settleDate').value = '';
    updateSettlePreview();
    $('#settleModal').classList.remove('hidden');
  }
  function closeSettleModal(){ $('#settleModal')?.classList.add('hidden'); }
  function updateSettlePreview(){
    const preview = $('#settlePreview'); if(!preview) return;
    const {net} = calculateNet(state.people, state.expenses);
    const from = $('#settleFrom')?.value; const to = $('#settleTo')?.value;
    const amt  = parseFloat($('#settleAmount')?.value || '0');
    if(!from||!to||from===to){ preview.innerHTML='<span class="muted">Choose two different people.</span>'; return; }
    const nf = (net[from]||0) + amt;
    const nt = (net[to]||0)  - amt;
    const dirWarn = (net[from]>0 && amt>0) || (net[to]<0 && amt>0);
    const warnTxt = dirWarn ? ' <span class="warn">Heads-up: with current balances this makes things worse. Consider Swap.</span>' : '';
    preview.innerHTML = `Effect → <strong>${from}</strong>: ${net[from]>=0?'+':'-'}$${currency(Math.abs(net[from]))} → ${nf>=0?'+':'-'}$${currency(Math.abs(nf))} &nbsp; | &nbsp; <strong>${to}</strong>: ${net[to]>=0?'+':'-'}$${currency(Math.abs(net[to]))} → ${nt>=0?'+':'-'}$${currency(Math.abs(nt))}.` + warnTxt;
  }
  function swapSettle(){
    const a=$('#settleFrom'), b=$('#settleTo'); if(!a||!b) return;
    const t=a.value; a.value=b.value; b.value=t; updateSettlePreview();
  }

  // ---------- auth modal (with fallback) ----------
  function openAuthModal(){
    const modal = $('#authModal');
    if (modal){
      const btn  = $('#authSubmit');
      const email= $('#authEmail');
      if (btn){ btn.disabled=false; btn.dataset.loading='false'; btn.textContent='Sign in'; }
      modal.classList.remove('hidden');
      const cancel = $('#authCancel');
      if (cancel) cancel.hidden = document.body.classList.contains('locked');
      setTimeout(()=> email?.focus(), 0);
      return;
    }
    const email = prompt('Email:'); if(!email) return;
    const pass  = prompt('Password:'); if(!pass) return;
    runEmailPasswordSignIn(email, pass);
  }
  function closeAuthModal(){ $('#authModal')?.classList.add('hidden'); }

  async function runEmailPasswordSignIn(email, pass){
    if(!auth){
      alert('Auth not available.');
      return;
    }
    if (!email || !pass){
      alert('Please enter email and password.');
      return;
    }
    const btn = $('#authSubmit');
    if (btn){ btn.disabled = true; btn.dataset.loading = 'true'; btn.textContent = 'Signing in…'; }
    try {
      await auth.signInWithEmailAndPassword(email, pass);
      closeAuthModal();
    } catch (e) {
      if (e && e.code === 'auth/user-not-found') {
        try {
          await auth.createUserWithEmailAndPassword(email, pass);
          closeAuthModal();
        } catch (e2) {
          alert(e2.message || String(e2));
          console.error(e2);
        }
      } else {
        alert(e.message || String(e));
        console.error(e);
      }
    } finally {
      if (btn){ btn.disabled = false; btn.dataset.loading = 'false'; btn.textContent = 'Sign in'; }
    }
  }

  // ---------- wire events ----------
  function wireEvents(){
    // People / expense
    $('#addPerson')?.addEventListener('click', addPerson);
    $('#addExpense')?.addEventListener('click', addExpense);
    $('#exportBtn')?.addEventListener('click', exportJSON);
    $('#importBtn')?.addEventListener('click', ()=> $('#importFile')?.click());
    $('#importFile')?.addEventListener('change', e=>{ if(e.target.files[0]) importJSON(e.target.files[0]); });

    // Reset confirm (now uses generic confirm)
    $('#resetAll')?.addEventListener('click', openResetConfirm);

    // Split UI
    $('#splitType')?.addEventListener('change', updateSplitUI);
    $('#participants')?.addEventListener('input', updateSplitUI);

    // Theme
    $('#themeToggle')?.addEventListener('click', ()=>{
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(cur==='light' ? 'dark' : 'light');
    });

    // Settle modal
    $('#settleBtn')?.addEventListener('click', ()=> openSettleModal());
    $('#settleCancel')?.addEventListener('click', closeSettleModal);
    $('#settleSave')?.addEventListener('click', addSettlement);
    $('#settleSwap')?.addEventListener('click', swapSettle);
    ['change','input'].forEach(ev=>{
      ['settleFrom','settleTo','settleAmount'].forEach(id=>{
        const el = $('#'+id); if(el) el.addEventListener(ev, updateSettlePreview);
      });
    });
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeSettleModal(); });

    // Suggestions
    $('#settlements')?.addEventListener('click', (e)=>{
      const use=e.target.closest?.('.use-suggestion');
      if(use){ openSettleModal(use.dataset.from, use.dataset.to, use.dataset.amt); return; }
      const pay=e.target.closest?.('.pay-suggestion');
      if(pay){ addExactSettlement(pay.dataset.from, pay.dataset.to, parseFloat(pay.dataset.amt)); return; }
      const payAll=e.target.closest?.('.pay-all');
      if(payAll){
        const wrap=$('#settlements');
        const txns=safeJSON(wrap?.dataset.txns) ?? [];
        txns.forEach(t=> addExactSettlement(t.from, t.to, t.amt));
      }
    });

    // Table buttons
    $('#expensesTable')?.addEventListener('click', (e)=>{
      const btnDel=e.target.closest?.('.btn-del'); if(btnDel){ confirmDelete(btnDel.dataset.id); return; }
      const btnEdit=e.target.closest?.('.btn-edit'); if(btnEdit){ openEditModal(btnEdit.dataset.id); }
    });

    // Edit modal
    $('#editCancel')?.addEventListener('click', closeEditModal);
    $('#editSave')?.addEventListener('click', saveEdit);
    $('#editSplitType')?.addEventListener('change', updateEditSplitUI);
    $('#editParticipants')?.addEventListener('input', updateEditSplitUI);

    // Auth buttons
    $('#loginBtn')?.addEventListener('click', openAuthModal);
    $('#logoutBtn')?.addEventListener('click', async ()=>{ try{ await auth.signOut(); }catch(e){ console.error(e);} });

    // Auth modal form (robust against autofill/name differences)
    const form = document.getElementById('authForm');
    if (form) {
      const btn = document.getElementById('authSubmit');

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const fd      = new FormData(form);

        const email = (fd.get('email')
                      || $('#authEmail')?.value
                      || '').toString().trim();

        const pass = (fd.get('password')
                     || fd.get('current-password')
                     || $('#authPassword')?.value
                     || $('#authPass')?.value
                     || document.querySelector('input[type="password"][name="password"]')?.value
                     || document.querySelector('input[type="password"][name="current-password"]')?.value
                     || '').toString();

        if (!email || !pass) {
          alert('Please enter email and password.');
          return;
        }

        if (btn) { btn.disabled = true; btn.dataset.loading = 'true'; }
        runEmailPasswordSignIn(email, pass).finally(() => {
          if (btn) { btn.disabled = false; btn.dataset.loading = 'false'; }
        });
      });

      document.getElementById('authCancel')?.addEventListener('click', () => {
        if (!document.body.classList.contains('locked')) {
          document.getElementById('authModal')?.classList.add('hidden');
        }
      });
    }
  } // end wireEvents

  // ---------- auth state / realtime sync ----------
  let unsubscribeGroup = null;

  function setFieldsLocked(lock){
    document.body.classList.toggle('locked', lock);
    if (lock) openAuthModal(); else closeAuthModal();
    $$("input, button, select, textarea").forEach(el => {
      if (el.id === 'loginBtn') return;
      if (el.closest('#authModal')) return;
      el.disabled = lock;
    });
  }

  function clearUIOnSignOut(){
    // Clear in-memory + local cache (do NOT touch Firestore)
    state = { people: [], expenses: [] };
    localStorage.removeItem('spl-lite');
    renderPeople(); renderExpenses(); computeBalances(); updateSplitUI();
    // Reset some form fields for a fresh look
    const d = $('#date'); if (d) d.value = todayISO();
    setStatus('Signed out','ok');
  }

  function handleAuth(){
    if (!auth || !db) return;
    auth.onAuthStateChanged((user)=>{
      const loginBtn  = $('#loginBtn');
      const logoutBtn = $('#logoutBtn');
      if (user){
        if (unsubscribeGroup) unsubscribeGroup();
        unsubscribeGroup = db.collection('groups').doc(GROUP_ID).onSnapshot((doc)=>{
          const remote = doc.exists ? doc.data() : {};
          state.people   = Array.isArray(remote.people)   ? remote.people   : [];
          state.expenses = Array.isArray(remote.expenses) ? remote.expenses : [];
          localStorage.setItem('spl-lite', JSON.stringify(state));
          renderPeople(); renderExpenses(); computeBalances(); updateSplitUI();
          setStatus('Synced from cloud','ok');
        }, (err)=> console.error('onSnapshot', err));

        if (loginBtn)  loginBtn.style.display  = 'none';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        setFieldsLocked(false);
      } else {
        if (unsubscribeGroup) unsubscribeGroup();
        unsubscribeGroup = null;
        if (loginBtn)  loginBtn.style.display  = 'inline-block';
        if (logoutBtn) logoutBtn.style.display = 'none';
        clearUIOnSignOut();
        setFieldsLocked(true);
      }
    });
  }

  // ---------- boot ----------
  async function boot(){
    if (location.protocol === 'file:') { const w=$('#fileWarn'); if(w) w.style.display='block'; }

    const ok = await ensureFirebaseReady();
    if (!ok) console.warn('Firebase SDK not ready in time');

    renderPeople(); renderExpenses(); computeBalances(); updateSplitUI();
    setFieldsLocked(true);
    applyTheme(localStorage.getItem('spl-theme')||'dark');
    if ($('#saveStatus')) markSaved();

    wireEvents();
    handleAuth();
  }

  // DOM ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
