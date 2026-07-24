// Smart Wealth Tracker - Main Frontend Logic (public/js/app.js)

// --- Application State ---
const State = {
  transactions: [],
  accounts: [],
  categories: [],
  filters: {
    type: 'all',
    category: 'all',
    account: 'all',
    search: '',
    dateStart: '',
    dateEnd: '',
    futureStatus: 'all'
  },
  pagination: {
    page: 1,
    limit: 10
  },
  uploadedFileUrl: null,
  uploadedFileName: null
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  // Set today's date in header
  updateHeaderDate();

  const token = localStorage.getItem('swt_session_token');
  if (token) {
    try {
      await reloadAppData();
      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay) loginOverlay.classList.add('hidden');
      // Show admin nav if admin
      if (API.isAdmin()) {
        const adminBtn = document.getElementById('btn-nav-admin');
        if (adminBtn) adminBtn.style.display = '';
      }
      // Show username in sidebar
      const user = API.getCurrentUser();
      const usernameEl = document.getElementById('sidebar-username');
      if (usernameEl) usernameEl.textContent = user.username;
    } catch (error) {
      console.error('Session validation failed:', error);
      localStorage.removeItem('swt_session_token');
      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay) loginOverlay.classList.remove('hidden');
    }
  } else {
    // Show login overlay
    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay) {
      loginOverlay.classList.remove('hidden');
    }
  }

  // Setup Event Listeners
  setupEventListeners();

  // Load default transaction form date to today
  document.getElementById('tx-date').value = new Date().toLocaleDateString('sv-SE');
});

// Update header current date display
function updateHeaderDate() {
  const options = { day: 'numeric', month: 'short', year: 'numeric' };
  document.getElementById('header-date').innerText = new Date().toLocaleDateString('th-TH', options);
}

// Reload all data from backend and refresh UI
async function reloadAppData() {
  showLoader();
  try {
    // Parallel fetch for speed — load up to 500 transactions for Dashboard/Charts
    console.log('[SWT] Starting reloadAppData...');
    const [accounts, categories, txResult] = await Promise.all([
      API.getAccounts(),
      API.getCategories(),
      API.getTransactions({ limit: 500, page: 1 })
    ]);

    console.log('[SWT] txResult type:', typeof txResult, Array.isArray(txResult), txResult?.data ? 'has .data' : 'no .data');

    State.accounts     = Array.isArray(accounts)    ? accounts    : [];
    State.categories   = Array.isArray(categories)  ? categories  : [];
    // API returns { data, total, pages, ... } — always extract .data array
    const txData = txResult?.data ?? txResult;
    State.transactions = Array.isArray(txData) ? txData : [];
    State.txTotal      = txResult?.total  ?? State.transactions.length;
    State.txPages      = txResult?.pages  ?? 1;

    console.log('[SWT] State.transactions length:', State.transactions.length, 'isArray:', Array.isArray(State.transactions));

    // Refresh UI Components with isolated error protection
    const renderSteps = [
      ['populateFilterDropdowns', populateFilterDropdowns],
      ['populateFormDropdowns', populateFormDropdowns],
      ['refreshDashboard', refreshDashboard],
      ['refreshTransactionsTable', refreshTransactionsTable],
      ['refreshAccountsList', refreshAccountsList],
      ['refreshCategoriesLists', refreshCategoriesLists],
      ['refreshReportsTable', refreshReportsTable],
      ['refreshPOSReport', refreshPOSReport],
      ['refreshDeliveryReport', refreshDeliveryReport],
      ['checkDailyAlert', checkDailyAlert],
    ];

    for (const [name, fn] of renderSteps) {
      try {
        fn();
      } catch (err) {
        console.error(`[SWT] Error in ${name}:`, err);
      }
    }
    console.log('[SWT] reloadAppData complete!');

  } catch (error) {
    console.error('[SWT] ERROR in reloadAppData:', error);
    alert('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + error.message);
  } finally {
    hideLoader();
    document.body.classList.remove('modal-open');
  }
}

// --- Loading Overlay ---
function showLoader() {
  // Lightweight loader visually (handled elegantly by browser speed, can add minor visual cue if needed)
}
function hideLoader() {
  // Dismiss loader
}

// --- UI Refresh Handlers ---

// Populate Dropdowns
function populateFilterDropdowns() {
  // Category filter
  const catFilter = document.getElementById('filter-category');
  const currentVal = catFilter.value;
  catFilter.innerHTML = '<option value="all">ทั้งหมด</option>';
  
  // Sort categories alphabetically
  const sortedCats = [...State.categories].sort((a, b) => a.name.localeCompare(b.name));
  sortedCats.forEach(cat => {
    const typeLabel = cat.type === 'income' ? 'รายรับ' : 'รายจ่าย';
    catFilter.innerHTML += `<option value="${cat.name}">${cat.name} (${typeLabel})</option>`;
  });
  catFilter.value = currentVal || 'all';

  // Account filter
  const accFilter = document.getElementById('filter-account');
  const currentAccVal = accFilter.value;
  accFilter.innerHTML = '<option value="all">ทั้งหมด</option>';
  State.accounts.forEach(acc => {
    accFilter.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
  });
  accFilter.value = currentAccVal || 'all';
}

function populateFormDropdowns() {
  // Populate accounts based on selected payment method
  updateTransactionFormAccounts();

  // Populate categories based on transaction type (income / expense) in form
  updateTransactionFormCategories();
}

function updateTransactionFormCategories() {
  let txType = document.getElementById('tx-type').value;
  if (txType === 'future') txType = 'expense';
  const txCatSelect = document.getElementById('tx-category');
  txCatSelect.innerHTML = '';
  
  const filteredCats = State.categories
    .filter(cat => cat.type === txType)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, 'th'));
  filteredCats.forEach(cat => {
    txCatSelect.innerHTML += `<option value="${cat.name}">${cat.name}</option>`;
  });
}

function updateTransactionFormAccounts() {
  const method = document.getElementById('tx-payment-method').value;
  const txAccSelect = document.getElementById('tx-account');
  const currentVal = txAccSelect.value;
  const type = document.getElementById('tx-type').value;
  
  txAccSelect.innerHTML = '';
  
  let filteredAccounts = [];
  
  if (method === 'Unspecified') {
    txAccSelect.disabled = true;
    txAccSelect.required = false;
    document.getElementById('group-tx-account').style.opacity = '0.5';
    txAccSelect.innerHTML = '<option value="">ไม่ระบุ</option>';
  } else if (method === 'Transfer') {
    filteredAccounts = State.accounts.filter(acc => acc.type !== 'cash' && acc.id !== 'acc-cash');
    txAccSelect.disabled = false;
    txAccSelect.required = true;
    document.getElementById('group-tx-account').style.opacity = '1';
  } else {
    // Cash method
    txAccSelect.disabled = type === 'future' ? false : true;
    txAccSelect.required = type === 'future' ? false : true;
    document.getElementById('group-tx-account').style.opacity = type === 'future' ? '1' : '0.5';
    filteredAccounts = State.accounts.filter(acc => acc.type === 'cash' || acc.id === 'acc-cash');
  }
  
  filteredAccounts.forEach(acc => {
    txAccSelect.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
  });
  
  // Set value
  if (method === 'Unspecified') {
    txAccSelect.value = '';
  } else if (method === 'Cash') {
    txAccSelect.value = 'acc-cash';
  } else if (filteredAccounts.some(acc => acc.id === currentVal)) {
    txAccSelect.value = currentVal;
  } else {
    if (filteredAccounts.length > 0) {
      txAccSelect.value = filteredAccounts[0].id;
    }
  }
}

function populateTransferAccountSelects() {
  const txAccSelect = document.getElementById('tx-account');
  const txToAccSelect = document.getElementById('tx-to-account');
  
  if (!txAccSelect || !txToAccSelect) return;
  
  const currentVal = txAccSelect.value;
  const currentToVal = txToAccSelect.value;
  
  txAccSelect.innerHTML = '';
  txToAccSelect.innerHTML = '';
  
  txAccSelect.disabled = false;
  txToAccSelect.disabled = false;
  
  const groupAcc = document.getElementById('group-tx-account');
  const groupToAcc = document.getElementById('group-tx-to-account');
  if (groupAcc) groupAcc.style.opacity = '1';
  if (groupToAcc) groupToAcc.style.opacity = '1';

  State.accounts.forEach(acc => {
    txAccSelect.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
    txToAccSelect.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
  });
  
  if (State.accounts.some(acc => acc.id === currentVal)) {
    txAccSelect.value = currentVal;
  } else if (State.accounts.length > 0) {
    txAccSelect.value = State.accounts[0].id;
  }
  
  if (State.accounts.some(acc => acc.id === currentToVal)) {
    txToAccSelect.value = currentToVal;
  } else if (State.accounts.length > 1) {
    txToAccSelect.value = State.accounts[1].id;
  } else if (State.accounts.length > 0) {
    txToAccSelect.value = State.accounts[0].id;
  }
}

function refreshDashboard() {
  const txList = Array.isArray(State.transactions) ? State.transactions : [];

  let posTotal = 0;
  let deliveryTotal = 0;
  let cnTotal = 0;

  txList.forEach(t => {
    const amt = Number(t.amount || 0);
    if (t.subType === 'pos' || (t.category && t.category.includes('POS'))) {
      posTotal += amt;
    }
    if (t.subType === 'delivery' || (t.category && t.category.includes('สายส่ง'))) {
      deliveryTotal += amt;
      cnTotal += Number(t.cnAmount || 0);
    }
  });

  const netSales = posTotal + deliveryTotal;

  const elNet = document.getElementById('dash-net-sales');
  const elPOS = document.getElementById('dash-pos-total');
  const elDel = document.getElementById('dash-delivery-total');
  const elCN  = document.getElementById('dash-cn-total');

  if (elNet) elNet.innerText = formatCurrency(netSales);
  if (elPOS) elPOS.innerText = formatCurrency(posTotal);
  if (elDel) elDel.innerText = formatCurrency(deliveryTotal);
  if (elCN)  elCN.innerText  = formatCurrency(cnTotal);

  renderDashPOSMachines();
  renderDashDeliveryDocs();
  renderDashAccountBalances();
}

function renderDashPOSMachines() {
  const container = document.getElementById('dash-pos-machines-list');
  const countBadge = document.getElementById('dash-pos-count');
  if (!container) return;

  const posMachines = getPOSMachines();
  if (countBadge) countBadge.innerText = `${posMachines.length} เครื่อง`;

  const txList = Array.isArray(State.transactions) ? State.transactions : [];
  const posTxs = txList.filter(t => t.subType === 'pos' || (t.category && t.category.includes('POS')));

  let html = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem;">`;

  posMachines.forEach(m => {
    const mTxs = posTxs.filter(t => t.posMachine === m.name || (t.category && t.category.includes(m.name)));
    let cash = 0, transfer = 0, coupon = 0;

    mTxs.forEach(t => {
      if (t.cashAmount !== undefined || t.transferAmount !== undefined || t.couponAmount !== undefined) {
        cash += Number(t.cashAmount || 0);
        transfer += Number(t.transferAmount || 0);
        coupon += Number(t.couponAmount || 0);
      } else {
        const amt = Number(t.amount || 0);
        if (t.category.includes('คูปอง') || (t.notes && t.notes.includes('คูปอง'))) coupon += amt;
        else if (t.paymentMethod === 'Cash' || (t.category && t.category.includes('เงินสด'))) cash += amt;
        else transfer += amt;
      }
    });

    const mTotal = cash + transfer + coupon;

    html += `
      <div style="background: var(--bg-app); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 0.75rem;">
          <h4 style="font-weight: 800; color: var(--text-main); font-size: 1.05rem;"><i class="fa-solid fa-cash-register text-emerald"></i> ${m.name}</h4>
          <span class="badge badge-emerald">${mTxs.length} กะ</span>
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.6rem;">
          พนักงาน: <strong style="color: var(--text-main);">${m.cashier}</strong>
        </div>
        <div style="display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.88rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="text-slate">เงินสด:</span>
            <strong class="text-emerald">${formatCurrency(cash)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="text-slate">เงินโอน:</span>
            <strong class="text-primary">${formatCurrency(transfer)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="text-slate">คูปอง:</span>
            <strong style="color: #0284c7;">${formatCurrency(coupon)}</strong>
          </div>
          <div style="border-top: 1px dashed var(--border-color); padding-top: 0.5rem; margin-top: 0.2rem; display: flex; justify-content: space-between; font-weight: 800;">
            <span>รวมยอด:</span>
            <span class="text-emerald" style="font-size: 1rem;">${formatCurrency(mTotal)}</span>
          </div>
        </div>
      </div>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function renderDashDeliveryDocs() {
  const container = document.getElementById('dash-delivery-docs-list');
  const countBadge = document.getElementById('dash-delivery-count');
  if (!container) return;

  const txList = Array.isArray(State.transactions) ? State.transactions : [];
  const delTxs = txList.filter(t => t.subType === 'delivery' || (t.category && t.category.includes('สายส่ง')));

  // Group by Document
  const docGroups = {};
  delTxs.forEach(t => {
    const key = t.documentNumber || t.documentCode || t.id;
    if (!docGroups[key]) docGroups[key] = [];
    docGroups[key].push(t);
  });

  const docKeys = Object.keys(docGroups);
  if (countBadge) countBadge.innerText = `${docKeys.length} เอกสาร`;

  if (docKeys.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate">
        <i class="fa-solid fa-truck-ramp-box text-2xl mb-1 text-slate-400"></i>
        <p>ยังไม่มีข้อมูลบันทึกรายรับสายส่งในระบบ</p>
      </div>`;
    return;
  }

  let tableRows = '';
  docKeys.forEach(docKey => {
    const txs = docGroups[docKey];
    const sample = txs[0];
    const docTotal = Number(sample.documentTotalAmount || 0);
    const bills = Number(sample.customerCount || 0);
    const cn = Number(sample.cnAmount || 0);

    let cash = 0, transfer = 0;
    txs.forEach(t => {
      if (t.cashAmount !== undefined || t.transferAmount !== undefined) {
        cash += Number(t.cashAmount || 0);
        transfer += Number(t.transferAmount || 0);
      } else {
        const amt = Number(t.amount || 0);
        if (t.paymentMethod === 'Cash' || (t.category && t.category.includes('เงินสด'))) cash += amt;
        else transfer += amt;
      }
    });

    const net = Number(sample.amount || (cash + transfer));
    const expected = docTotal - cn;
    const diff = (cash + transfer) - expected;
    const hasDiscrepancy = Boolean(sample.hasDiscrepancy || Math.abs(diff) >= 0.01);

    tableRows += `
      <tr style="cursor: pointer;" onclick="viewDocumentSummary('${docKey}')">
        <td style="font-weight: 700; color: var(--primary);">${sample.date}</td>
        <td><strong>${docKey}</strong></td>
        <td class="text-center">${bills} บิล</td>
        <td class="text-right">${formatCurrency(docTotal)}</td>
        <td class="text-right text-emerald">${formatCurrency(cash)}</td>
        <td class="text-right text-indigo">${formatCurrency(transfer)}</td>
        <td class="text-right text-rose">${formatCurrency(cn)}</td>
        <td class="text-right" style="font-weight: 800; color: var(--emerald);">${formatCurrency(net)}</td>
        <td class="text-center">
          ${hasDiscrepancy 
            ? `<span class="badge badge-rose" style="font-size: 0.75rem;"><i class="fa-solid fa-triangle-exclamation"></i> ยอดไม่ตรง (${diff > 0 ? '+' : ''}${formatCurrency(diff)})</span>`
            : `<span class="badge badge-emerald" style="font-size: 0.75rem;"><i class="fa-solid fa-check"></i> ตรงตามเอกสาร</span>`
          }
        </td>
      </tr>`;
  });

  container.innerHTML = `
    <div class="table-container scrollbar">
      <table class="premium-table compact">
        <thead>
          <tr>
            <th>วันที่</th>
            <th>เลขที่เอกสาร</th>
            <th class="text-center">จำนวนบิล</th>
            <th class="text-right">ยอดตามเอกสาร</th>
            <th class="text-right">เงินสด</th>
            <th class="text-right">เงินโอน</th>
            <th class="text-right">ยอด CN</th>
            <th class="text-right">รายรับสุทธิ</th>
            <th class="text-center">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>`;
}

function renderDashAccountBalances() {
  const container = document.getElementById('dash-accounts-accumulated-container');
  if (!container) return;

  const accounts = Array.isArray(State.accounts) ? State.accounts : [];
  let grandBalance = 0;

  let html = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.25rem;">`;

  accounts.forEach(acc => {
    const bal = Number(acc.balance || 0);
    grandBalance += bal;

    let icon = 'fa-solid fa-building-columns';
    if (acc.type === 'cash' || acc.id === 'acc-cash') icon = 'fa-solid fa-money-bill-wave text-emerald';
    else if (acc.type === 'coupon') icon = 'fa-solid fa-id-card text-sky';
    else icon = 'fa-solid fa-building-columns text-primary';

    html += `
      <div style="background: var(--bg-app); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
          <i class="${icon} text-lg"></i>
          <h4 style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${acc.name}</h4>
        </div>
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 0.4rem;">
          ยอดเริ่มต้น: ${formatCurrency(acc.initialBalance)}
        </div>
        <div style="font-size: 1.2rem; font-weight: 800; color: var(--emerald);">
          ${formatCurrency(bal)}
        </div>
      </div>`;
  });

  html += `</div>`;

  // Grand Total Box
  html += `
    <div style="background: linear-gradient(135deg, #0f172a, #1e293b); color: #ffffff; border-radius: var(--radius-md); padding: 1.25rem; display: flex; justify-content: space-between; align-items: center; box-shadow: var(--shadow-sm);">
      <div>
        <span style="font-size: 0.85rem; color: #94a3b8; display: block;">ยอดเงินสะสมรวมสุทธิทุกบัญชี (Grand Total)</span>
        <span style="font-size: 0.78rem; color: #64748b;">รวมสภาพคล่องทางการเงินคงเหลือในระบบ</span>
      </div>
      <div style="font-size: 1.75rem; font-weight: 800; color: #34d399;">
        ${formatCurrency(grandBalance)}
      </div>
    </div>`;

  container.innerHTML = html;
}

// Get CSS class based on bank name for background styling
function getBankColorClass(bankName) {
  if (bankName === 'กสิกรไทย') return 'bg-kbank';
  if (bankName === 'ไทยพาณิชย์') return 'bg-scb';
  if (bankName === 'กรุงเทพ') return 'bg-bbl';
  if (bankName === 'กรุงไทย') return 'bg-ktb';
  if (bankName === 'กรุงศรีอยุธยา') return 'bg-bay';
  if (bankName === 'ทหารไทยธนชาต') return 'bg-ttb';
  if (bankName === 'ออมสิน') return 'bg-gsb';
  return 'bg-other-bank';
}

// 2. TRANSACTIONS TABLE REFRESH (WITH FILTERS & PAGINATION)
function refreshTransactionsTable() {
  const tbody = document.getElementById('transactions-table-body');
  tbody.innerHTML = '';

  const todayStr = new Date().toLocaleDateString('sv-SE');

  // Filter transactions (guard against non-array)
  const txList = Array.isArray(State.transactions) ? State.transactions : [];
  let filtered = txList.filter(t => {
    // Type filter
    if (State.filters.type === 'income' && t.type !== 'income') return false;
    if (State.filters.type === 'expense' && t.type !== 'expense') return false;
    if (State.filters.type === 'future') {
      if (t.type !== 'future') return false;
      
      const dueD = t.dueDate || t.date;
      
      if (State.filters.futureStatus !== 'all') {
        const isPaid = t.status === 'paid';
        const isOverdue = !isPaid && dueD < todayStr;
        const isPending = !isPaid && !isOverdue;
        
        if (State.filters.futureStatus === 'paid' && !isPaid) return false;
        if (State.filters.futureStatus === 'pending' && !isPending) return false;
        if (State.filters.futureStatus === 'overdue' && !isOverdue) return false;
      }

      if (State.filters.dueDateStart && dueD < State.filters.dueDateStart) return false;
      if (State.filters.dueDateEnd && dueD > State.filters.dueDateEnd) return false;
    }
    if (State.filters.type === 'transfer' && t.type !== 'transfer_out' && t.type !== 'transfer_in') return false;

    // Category filter
    if (State.filters.category !== 'all' && t.category !== State.filters.category) return false;

    // Account filter
    if (State.filters.account !== 'all' && t.accountId !== State.filters.account) return false;

    // Filter out transfer_in to avoid duplicate rows when displaying all accounts
    if (State.filters.account === 'all' && t.type === 'transfer_in') return false;

    // Date filters
    if (State.filters.dateStart && t.date < State.filters.dateStart) return false;
    if (State.filters.dateEnd && t.date > State.filters.dateEnd) return false;

    // Search query (guard null fields)
    if (State.filters.search) {
      const q = State.filters.search.toLowerCase();
      const categoryMatch = (t.category || '').toLowerCase().includes(q);
      const notesMatch    = (t.notes    || '').toLowerCase().includes(q);
      const amountMatch   = String(t.amount || '').includes(q);
      
      const acc = State.accounts.find(a => a.id === t.accountId);
      const accountMatch = acc ? acc.name.toLowerCase().includes(q) : false;
      const docMatch = (t.documentNumber || '').toLowerCase().includes(q);

      if (!categoryMatch && !notesMatch && !amountMatch && !accountMatch && !docMatch) return false;
    }

    return true;
  });

  const totalEntries = filtered.length;
  
  // Handle Pagination
  const limit = State.pagination.limit;
  const totalPages = Math.max(1, Math.ceil(totalEntries / limit));
  
  if (State.pagination.page > totalPages) {
    State.pagination.page = totalPages;
  }
  
  const startIndex = (State.pagination.page - 1) * limit;
  const endIndex = Math.min(startIndex + limit, totalEntries);
  
  const paginatedData = filtered.slice(startIndex, endIndex);

  // Render Table Entries Info
  document.getElementById('table-entries-info').innerText = 
    totalEntries > 0 
      ? `แสดง ${startIndex + 1} ถึง ${endIndex} จากทั้งหมด ${totalEntries} รายการ` 
      : 'แสดง 0 ถึง 0 จากทั้งหมด 0 รายการ';

  // Render Pagination buttons
  renderPaginationControls(totalPages);

  // Update Transactions Summary Bar based on filtered transactions
  let summaryIncome = 0;
  let summaryExpense = 0;
  let summaryPOS = 0;
  let summaryDelivery = 0;

  filtered.forEach(t => {
    const amt = Number(t.amount || 0);
    if (t.type === 'income' || t.type === 'transfer_in') {
      summaryIncome += amt;
    } else if (t.type === 'expense' || t.type === 'transfer_out') {
      summaryExpense += amt;
    }

    if (t.subType === 'pos' || (t.category && t.category.includes('POS'))) {
      summaryPOS += amt;
    }
    if (t.subType === 'delivery' || (t.category && t.category.includes('สายส่ง'))) {
      summaryDelivery += amt;
    }
  });

  const summaryNet = summaryIncome - summaryExpense;

  const elInc = document.getElementById('summary-total-income');
  const elExp = document.getElementById('summary-total-expense');
  const elPOS = document.getElementById('summary-pos-income');
  const elDel = document.getElementById('summary-delivery-income');
  const elNet = document.getElementById('summary-net-total');

  if (elInc) elInc.innerText = formatCurrency(summaryIncome);
  if (elExp) elExp.innerText = formatCurrency(summaryExpense);
  if (elPOS) elPOS.innerText = formatCurrency(summaryPOS);
  if (elDel) elDel.innerText = formatCurrency(summaryDelivery);
  if (elNet) {
    elNet.innerText = formatCurrency(summaryNet);
    elNet.style.color = summaryNet >= 0 ? 'var(--emerald)' : 'var(--rose)';
  }

  if (paginatedData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center py-12 text-slate">
          <i class="fa-regular fa-folder-open text-3xl mb-3 block text-slate-400"></i>
          ไม่พบรายการธุรกรรมตามตัวกรองที่เลือก
        </td>
      </tr>`;
    return;
  }

  // Draw Rows grouped by date (YYYY-MM-DD)
  const today = new Date();
  today.setHours(0,0,0,0);

  const groupedByDate = {};
  paginatedData.forEach(t => {
    const dKey = t.date;
    if (!groupedByDate[dKey]) groupedByDate[dKey] = [];
    groupedByDate[dKey].push(t);
  });

  const dateKeys = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));

  dateKeys.forEach(dateKey => {
    const dateTxs = groupedByDate[dateKey];
    let dailyNetIncome = 0;

    dateTxs.forEach(t => {
      const acc = State.accounts.find(a => a.id === t.accountId);
      const isIncome = t.type === 'income';
      const isFutureType = t.type === 'future';
      const isTransferOut = t.type === 'transfer_out';
      const isTransferIn = t.type === 'transfer_in';
      
      if (isIncome) dailyNetIncome += Number(t.amount || 0);
    
    // Amount class
    let amountClass = 'text-amount-exp';
    let amountPrefix = '-';
    let amountStyle = '';
    if (isIncome) {
      amountClass = 'text-amount-inc';
      amountPrefix = '+';
    } else if (isFutureType) {
      amountClass = 'text-amount-future';
      amountPrefix = '-';
    } else if (isTransferOut) {
      amountClass = 'text-slate';
      amountPrefix = '-';
      amountStyle = 'style="font-weight: 800; color: #64748b;"';
    } else if (isTransferIn) {
      amountClass = 'text-slate';
      amountPrefix = '+';
      amountStyle = 'style="font-weight: 800; color: #64748b;"';
    }

    // Attachment btn
    let attachmentBtn = '';
    if (t.slipUrl) {
      const ext = t.slipUrl.split('.').pop().toLowerCase();
      const icon = ext === 'pdf' ? 'fa-regular fa-file-pdf text-rose' : 'fa-regular fa-image text-indigo';
      attachmentBtn = `<button class="btn-table-attachment" onclick="previewAttachment('${t.slipUrl}')"><i class="${icon}"></i> ดูไฟล์</button>`;
    } else {
      attachmentBtn = `<button class="btn-table-attachment no-attachment" disabled><i class="fa-solid fa-ban"></i> ไม่มี</button>`;
    }

    // Calculate urgency row styling for unpaid prepaid expenses
    let rowUrgencyClass = '';
    if (t.type === 'future' && t.status !== 'paid') {
      const parts = (t.dueDate || t.date).split('-');
      if (parts.length === 3) {
        const txDate = new Date(parts[0], parts[1] - 1, parts[2]);
        txDate.setHours(0,0,0,0);
        const diffTime = txDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
          rowUrgencyClass = 'row-future-overdue';
        } else if (diffDays === 0) {
          rowUrgencyClass = 'row-future-today';
        } else if (diffDays > 0 && diffDays <= 3) {
          rowUrgencyClass = 'row-future-3days';
        } else if (diffDays > 3 && diffDays <= 7) {
          rowUrgencyClass = 'row-future-7days';
        }
      }
    }

    // Type Badge & Status rendering
    let typeCellContent = '';
    if (isIncome) {
      typeCellContent = '<span class="badge badge-emerald"><i class="fa-solid fa-circle-chevron-down mr-1"></i> รายรับ</span>';
    } else if (isFutureType) {
      typeCellContent = `<span class="badge badge-amber"><i class="fa-regular fa-clock mr-1"></i> จ่ายล่วงหน้า</span>`;
    } else if (isTransferOut || isTransferIn) {
      typeCellContent = '<span class="badge badge-indigo" style="background-color: var(--primary-light); color: var(--primary); border: 1px solid rgba(79,70,229,0.15);"><i class="fa-solid fa-money-bill-transfer mr-1"></i> ย้ายเงิน</span>';
    } else {
      typeCellContent = '<span class="badge badge-rose"><i class="fa-solid fa-circle-chevron-up mr-1"></i> รายจ่าย</span>';
    }

    let quickPayBtn = '';
    if (t.type === 'future' && t.status !== 'paid') {
      quickPayBtn = `
        <button class="btn-quick-pay" onclick="markAsPaid('${t.id}')" title="ชำระเงินแล้ว">
          <i class="fa-solid fa-check mr-1"></i> ชำระแล้ว
        </button>`;
    }

    let detailHTML = `<div class="table-text-main">${t.notes || '-'}</div>`;
    if (t.type === 'future') {
      const todayStr = new Date().toLocaleDateString('sv-SE');
      const isPaid = t.status === 'paid';
      const isOverdue = !isPaid && (t.dueDate || t.date) < todayStr;
      
      let statusBadge = '';
      if (isPaid) {
        statusBadge = '<span class="badge badge-emerald" style="font-size: 0.7rem; padding: 0.15rem 0.35rem;"><i class="fa-solid fa-check"></i> ชำระแล้ว</span>';
      } else if (isOverdue) {
        statusBadge = '<span class="badge badge-rose" style="font-size: 0.7rem; padding: 0.15rem 0.35rem; border:1px solid var(--amber);"><i class="fa-solid fa-triangle-exclamation"></i> เกินกำหนด</span>';
      } else {
        statusBadge = '<span class="badge badge-slate" style="font-size: 0.7rem; padding: 0.15rem 0.35rem;"><i class="fa-regular fa-clock"></i> ค้างชำระ</span>';
      }

      const formattedDueDate = formatDateThShort(t.dueDate || t.date);
      detailHTML += `
        <div class="table-text-sub" style="margin-top: 0.35rem; display: flex; flex-direction: column; gap: 0.2rem;">
          <div><i class="fa-regular fa-calendar-check text-amber-hover mr-1"></i> กำหนดชำระ: <strong>${formattedDueDate}</strong></div>
          <div style="margin-top: 0.15rem; display: flex; align-items: center; gap: 0.25rem;">สถานะ: ${statusBadge}</div>
        </div>`;
    }
    
    let accountCellHTML = '';
    if (t.paymentMethod === 'Unspecified' || t.accountId === 'acc-unspecified') {
      accountCellHTML = `<span class="text-slate">-</span>`;
    } else {
      accountCellHTML = `<div class="table-text-main">${!t.accountId ? '<span class="text-slate">-</span>' : (acc ? acc.name : 'ถูกลบ')}</div>
                         <div class="table-text-sub">${acc && acc.type === 'bank' ? `${acc.bankName}` : '-'}</div>`;
    }

    if (isTransferOut || isTransferIn) {
      const otherTx = (Array.isArray(State.transactions) ? State.transactions : []).find(tx => tx.id === t.transferTxId);
      let fromAccId = isTransferOut ? t.accountId : (otherTx ? otherTx.accountId : '');
      let toAccId = isTransferIn ? t.accountId : (otherTx ? otherTx.accountId : '');
      
      const fromAcc = State.accounts.find(a => a.id === fromAccId);
      const toAcc = State.accounts.find(a => a.id === toAccId);
      const fromName = fromAcc ? fromAcc.name : 'ไม่ระบุ';
      const toName = toAcc ? toAcc.name : 'ไม่ระบุ';
      
      detailHTML = `<div class="table-text-main" style="color: var(--primary); font-weight: 600;">
                      <i class="fa-solid fa-right-long mr-1"></i> ย้ายเงิน: ${fromName} ➔ ${toName}
                    </div>
                    <div class="table-text-sub" style="font-style: italic;">
                      ${t.notes ? `หมายเหตุ: ${t.notes}` : 'ไม่มีหมายเหตุเพิ่มเติม'}
                    </div>`;
    }
      
      const isPos = t.subType === 'pos' || (t.category && t.category.includes('POS'));
      const isDelivery = t.subType === 'delivery' || (t.category && t.category.includes('สายส่ง'));
      const docCode = t.documentCode || t.documentNumber || t.id;

      let discrepancyBadge = '';
      if (isDelivery && t.hasDiscrepancy) {
        discrepancyBadge = `<div style="margin-top:0.25rem;"><span class="badge badge-rose" style="font-size: 0.7rem;" title="ยอดชำระไม่ตรงกับยอดเอกสาร"><i class="fa-solid fa-triangle-exclamation"></i> ยอดไม่ตรง</span></div>`;
      }

      // Compact Category & Details Column (Col 3)
      let categoryDetailHTML = '';
      if (isPos) {
        const machine = t.posMachine || 'POS 1';
        const shift = t.posShift || 'รอบที่ 1';
        const time = t.posTime ? `${t.posTime} น.` : '';
        categoryDetailHTML = `
          <div style="font-weight: 700; color: var(--primary); font-size: 0.9rem;">
            <i class="fa-solid fa-cash-register text-emerald mr-1"></i> ${machine} / ${shift}${time ? ` / ${time}` : ''}
          </div>`;
      } else if (isDelivery) {
        const docNum = t.documentNumber || t.documentCode || docCode;
        categoryDetailHTML = `
          <div style="font-weight: 700; color: var(--primary); font-size: 0.9rem;">
            <i class="fa-solid fa-truck-ramp-box text-indigo mr-1"></i> เลขที่เอกสาร: ${docNum}
          </div>`;
      } else {
        categoryDetailHTML = `
          <span class="category-pill" style="font-size: 0.85rem; font-weight: 700;">${t.category}</span>
          ${t.notes ? `<div class="table-text-sub" style="margin-top:0.15rem;">${t.notes}</div>` : ''}`;
      }

      const rowHTML = `
        <tr class="${rowUrgencyClass}">
          <td class="col-date" style="white-space: nowrap;">
            <div style="font-weight: 700;">${t.date}</div>
            ${t.posTime ? `<div style="font-size: 0.75rem; color: var(--text-light);"><i class="fa-regular fa-clock"></i> ${t.posTime} น.</div>` : ''}
          </td>
          <td class="col-type" style="white-space: nowrap;">
            ${typeCellContent}
            <div style="font-size: 0.75rem; font-weight: 700; color: var(--primary); font-family: var(--font-mono); margin-top: 0.2rem;">${docCode}</div>
            ${discrepancyBadge}
          </td>
          <td class="col-category">
            ${categoryDetailHTML}
          </td>
          <td class="col-amount text-right ${amountClass}" ${amountStyle}>
            ${amountPrefix}${formatCurrency(t.amount)}
          </td>
          <td class="col-attachment text-center">
            ${attachmentBtn}
          </td>
          <td class="col-actions text-center" style="white-space: nowrap;">
            <button class="btn-table-action action-view" onclick="viewDocumentSummary('${docCode}')" title="ดูรายละเอียด">
              <i class="fa-solid fa-file-invoice"></i>
            </button>
            ${quickPayBtn}
            <button class="btn-table-action action-edit" onclick="openEditTransactionModal('${t.id}')" title="แก้ไขรายการ">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn-table-action action-delete" onclick="deleteTransaction('${t.id}')" title="ลบรายการ">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>`;
      
      tbody.innerHTML += rowHTML;
    });

    // Append Daily Subtotal Row for this date group
    tbody.innerHTML += `
      <tr class="daily-subtotal-row" style="background-color: rgba(79, 70, 229, 0.05); font-weight: 800; border-bottom: 2px solid var(--border-color);">
        <td colspan="3" class="text-right" style="padding: 0.75rem 1rem; color: var(--text-main); font-size: 0.88rem;">
          <i class="fa-solid fa-calculator text-indigo"></i> ยอดรับรวมประจำวันที่ ${formatDateThShort(dateKey)} (${dateTxs.length} รายการ):
        </td>
        <td colspan="3" style="font-size: 1.05rem; color: var(--emerald); font-weight: 800; padding: 0.75rem 1rem;">
          ${formatCurrency(dailyNetIncome)}
        </td>
      </tr>`;
  });
}

function renderPaginationControls(totalPages) {
  const pagDiv = document.getElementById('table-pagination');
  pagDiv.innerHTML = '';

  const currentPage = State.pagination.page;

  // Previous btn
  const prevBtn = document.createElement('button');
  prevBtn.className = 'pagination-btn';
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => {
    if (State.pagination.page > 1) {
      State.pagination.page--;
      refreshTransactionsTable();
    }
  };
  pagDiv.appendChild(prevBtn);

  // Determine pages range to show
  const range = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) {
      range.push(i);
    }
  } else {
    range.push(1);

    let start = Math.max(2, currentPage - 1);
    let end = Math.min(totalPages - 1, currentPage + 1);

    if (currentPage <= 4) {
      end = 5;
    } else if (currentPage >= totalPages - 3) {
      start = totalPages - 4;
    }

    if (start > 2) {
      range.push('...');
    }

    for (let i = start; i <= end; i++) {
      range.push(i);
    }

    if (end < totalPages - 1) {
      range.push('...');
    }

    range.push(totalPages);
  }

  // Numeric buttons & ellipses
  range.forEach(item => {
    if (item === '...') {
      const span = document.createElement('span');
      span.className = 'pagination-ellipsis';
      span.innerText = '...';
      span.style.width = '32px';
      span.style.height = '32px';
      span.style.display = 'inline-flex';
      span.style.alignItems = 'center';
      span.style.justifyContent = 'center';
      span.style.color = 'var(--text-helper)';
      span.style.fontWeight = '600';
      pagDiv.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = `pagination-btn ${item === currentPage ? 'active' : ''}`;
      btn.innerText = item;
      btn.onclick = () => {
        State.pagination.page = item;
        refreshTransactionsTable();
      };
      pagDiv.appendChild(btn);
    }
  });

  // Next btn
  const nextBtn = document.createElement('button');
  nextBtn.className = 'pagination-btn';
  nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => {
    if (State.pagination.page < totalPages) {
      State.pagination.page++;
      refreshTransactionsTable();
    }
  };
  pagDiv.appendChild(nextBtn);
}

// 3. ACCOUNTS PAGE REFRESH
function refreshAccountsList() {
  const container = document.getElementById('accounts-cards-container');
  container.innerHTML = '';

  const accCountEl = document.getElementById('accounts-count');
  if (accCountEl) accCountEl.innerText = `${State.accounts.length} บัญชี`;

  State.accounts.forEach(acc => {
    const isCash = acc.type === 'cash';
    const iconClass = isCash ? 'fa-solid fa-wallet' : 'fa-solid fa-building-columns';
    const bgClass = isCash ? 'bg-cash text-white' : getBankColorClass(acc.bankName);
    
    const cardBorderAccentClass = isCash ? 'bank-cash' : `bank-${getBankBrandSlug(acc.bankName)}`;

    // Generate Cards
    container.innerHTML += `
      <div class="bank-card ${cardBorderAccentClass}">
        <div class="bank-card-header">
          <div class="bank-logo-box ${bgClass}">
            <i class="${iconClass}"></i>
          </div>
          <div class="bank-card-actions">
            <button class="btn-table-action" onclick="loadAccountToForm('${acc.id}')" title="แก้ไขบัญชี">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            ${acc.id !== 'acc-cash' ? `
              <button class="btn-table-action action-delete" onclick="deleteAccount('${acc.id}')" title="ลบบัญชี">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            ` : ''}
          </div>
        </div>
        
        <div class="bank-card-info">
          <h4 class="bank-card-name">${acc.name}</h4>
          <span class="bank-card-details">${isCash ? 'เงินสดคงเหลือ' : `${acc.bankName} • เลขบัญชี: ${acc.accountNumber}`}</span>
        </div>

        <div class="bank-card-balance-section">
          <span class="bank-card-lbl">เงินคงเหลือปัจจุบัน</span>
          <h3 class="bank-card-val">${formatCurrency(acc.balance)}</h3>
          <span class="bank-card-initial">ยอดเริ่มต้น: ${formatCurrency(acc.initialBalance)}</span>
        </div>
      </div>`;
  });
}

function getBankBrandSlug(bankName) {
  if (bankName === 'กสิกรไทย') return 'kbank';
  if (bankName === 'ไทยพาณิชย์') return 'scb';
  if (bankName === 'กรุงเทพ') return 'bbl';
  if (bankName === 'กรุงไทย') return 'ktb';
  if (bankName === 'กรุงศรีอยุธยา') return 'bay';
  if (bankName === 'ทหารไทยธนชาต') return 'ttb';
  if (bankName === 'ออมสิน') return 'gsb';
  return 'other';
}

// 4. CATEGORIES TAB REFRESH
function refreshCategoriesLists() {
  const incList = document.getElementById('income-categories-list');
  const expList = document.getElementById('expense-categories-list');
  
  incList.innerHTML = '';
  expList.innerHTML = '';

  const incomeCats = State.categories
    .filter(c => c.type === 'income')
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, 'th'));
  const expenseCats = State.categories
    .filter(c => c.type === 'expense')
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, 'th'));

  const incCatCount = document.getElementById('income-categories-count');
  if (incCatCount) incCatCount.innerText = incomeCats.length;
  const expCatCount = document.getElementById('expense-categories-count');
  if (expCatCount) expCatCount.innerText = expenseCats.length;

  // Render Income Categories
  incomeCats.forEach(cat => {
    const editBtn = `<button class="btn-table-action" onclick="loadCategoryToForm('${cat.id}')" title="แก้ไขหมวดหมู่"><i class="fa-solid fa-pen-to-square"></i></button>`;
    const deleteBtn = `<button class="btn-table-action action-delete" onclick="deleteCategory('${cat.id}')" title="ลบหมวดหมู่"><i class="fa-solid fa-trash-can"></i></button>`;

    incList.innerHTML += `
      <div class="category-list-item" draggable="true" data-id="${cat.id}" ondragstart="handleDragStart(event)" ondragover="handleDragOver(event)" ondrop="handleDrop(event)" style="cursor: move;">
        <span class="category-item-text">
          <i class="fa-solid fa-bars text-slate mr-2" style="font-size:0.8rem; opacity:0.5;"></i>
          <i class="fa-solid fa-circle-arrow-down text-emerald"></i> ${cat.name}
        </span>
        <div class="category-item-actions" style="display: flex; gap: 0.25rem;">
          ${editBtn}
          ${deleteBtn}
        </div>
      </div>`;
  });

  // Render Expense Categories
  expenseCats.forEach(cat => {
    const editBtn = `<button class="btn-table-action" onclick="loadCategoryToForm('${cat.id}')" title="แก้ไขหมวดหมู่"><i class="fa-solid fa-pen-to-square"></i></button>`;
    const deleteBtn = `<button class="btn-table-action action-delete" onclick="deleteCategory('${cat.id}')" title="ลบหมวดหมู่"><i class="fa-solid fa-trash-can"></i></button>`;

    expList.innerHTML += `
      <div class="category-list-item" draggable="true" data-id="${cat.id}" ondragstart="handleDragStart(event)" ondragover="handleDragOver(event)" ondrop="handleDrop(event)" style="cursor: move;">
        <span class="category-item-text">
          <i class="fa-solid fa-bars text-slate mr-2" style="font-size:0.8rem; opacity:0.5;"></i>
          <i class="fa-solid fa-circle-arrow-up text-rose"></i> ${cat.name}
        </span>
        <div class="category-item-actions" style="display: flex; gap: 0.25rem;">
          ${editBtn}
          ${deleteBtn}
        </div>
      </div>`;
  });
}

// 5. REPORTS TAB DATA REFRESH
function refreshReportsTable() {
  const tbody = document.getElementById('reports-summary-body');
  tbody.innerHTML = '';

  const todayStr = new Date().toLocaleDateString('sv-SE');

  // Filter transactions (guard against non-array)
  const txList2 = Array.isArray(State.transactions) ? State.transactions : [];
  let filtered = txList2.filter(t => {
    if (State.filters.type === 'income' && t.type !== 'income') return false;
    if (State.filters.type === 'expense' && t.type !== 'expense') return false;
    if (State.filters.type === 'future' && t.type !== 'future') return false;

    if (State.filters.category !== 'all' && t.category !== State.filters.category) return false;
    if (State.filters.account !== 'all' && t.accountId !== State.filters.account) return false;

    if (State.filters.dateStart && t.date < State.filters.dateStart) return false;
    if (State.filters.dateEnd && t.date > State.filters.dateEnd) return false;

    return true;
  });

  // Calculate scope stats
  const totalIncome = filtered
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const totalExpense = filtered
    .filter(t => t.type === 'expense' || t.type === 'future')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const netBalance = totalIncome - totalExpense;

  const repInc = document.getElementById('report-scope-income');
  if (repInc) repInc.innerText = formatCurrency(totalIncome);
  const repExp = document.getElementById('report-scope-expense');
  if (repExp) repExp.innerText = formatCurrency(totalExpense);
  
  const netEl = document.getElementById('report-scope-net');
  if (netEl) {
    netEl.innerText = formatCurrency(netBalance);
    if (netBalance >= 0) {
      netEl.className = 'stat-mini-val text-emerald';
    } else {
      netEl.className = 'stat-mini-val text-rose';
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-12 text-slate">
          ไม่มีรายการตามช่วงเวลาที่กรอง กรุณาตั้งค่าตัวกรองในแถบ บันทึกรายรับ-รายจ่าย
        </td>
      </tr>`;
    return;
  }

  // Draw max 50 rows in mini table
  const showData = filtered.slice(0, 50);

  showData.forEach(t => {
    const acc = State.accounts.find(a => a.id === t.accountId);
    
    tbody.innerHTML += `
      <tr>
        <td>${formatDateThShort(t.date)}</td>
        <td>
          ${t.documentNumber ? `<span class="badge badge-indigo" style="background: var(--primary-light); color: var(--primary); font-size: 0.75rem; font-weight: 700; border: 1px solid rgba(79,70,229,0.15);"><i class="fa-solid fa-hashtag"></i> ${t.documentNumber}</span>` : '<span class="text-slate">-</span>'}
        </td>
        <td>
          ${t.type === 'income' 
            ? '<span class="badge badge-emerald">รายรับ</span>' 
            : t.type === 'future'
              ? '<span class="badge badge-amber">จ่ายล่วงหน้า</span>'
              : '<span class="badge badge-rose">รายจ่าย</span>'}
        </td>
        <td class="table-text-main">${t.category}</td>
        <td>${acc ? acc.name : 'ไม่ระบุ'}</td>
        <td>${t.notes || '-'}</td>
        <td class="${t.type === 'income' ? 'text-amount-inc' : t.type === 'future' ? 'text-amount-future' : 'text-amount-exp'} text-right">
          ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
        </td>
      </tr>`;
  });

  // Refresh POS Shift Summary Report
  refreshPOSReport();
}

// --- Event Listeners and Setup ---
function setupEventListeners() {
  // 1. Sidebar Tab Switching Navigation
  const navButtons = document.querySelectorAll('.sidebar-nav .nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-target');
      
      // Update sidebar buttons active state
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update header title (Translate Dashboard to English)
      let viewTitle = btn.querySelector('span').innerText;
      if (targetView === 'dashboard') {
        viewTitle = 'Dashboard';
      }
      document.getElementById('pageTitle').innerText = viewTitle;

      // Update active view
      const views = document.querySelectorAll('.app-viewport .tab-view');
      views.forEach(v => v.classList.remove('active'));
      document.getElementById(`view-${targetView}`).classList.add('active');

      // Close mobile sidebar if open
      document.getElementById('appSidebar').classList.remove('active');
      const overlay = document.getElementById('sidebarOverlay');
      if (overlay) overlay.classList.remove('active');
    });
  });

  // Sidebar Toggle (Mobile & Desktop)
  document.getElementById('sidebarToggle').addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.innerWidth > 768) {
      document.querySelector('.app-container').classList.toggle('sidebar-collapsed');
    } else {
      document.getElementById('appSidebar').classList.add('active');
      const overlay = document.getElementById('sidebarOverlay');
      if (overlay) overlay.classList.add('active');
    }
  });

  // Close Mobile sidebar when clicking overlay
  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) {
    overlay.addEventListener('click', () => {
      document.getElementById('appSidebar').classList.remove('active');
      overlay.classList.remove('active');
    });
  }

  // Close Mobile sidebar when clicking the X close button
  const closeBtn = document.getElementById('sidebarCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      document.getElementById('appSidebar').classList.remove('active');
      const overlay = document.getElementById('sidebarOverlay');
      if (overlay) overlay.classList.remove('active');
    });
  }  // 2. Quick Action Buttons
  document.getElementById('btn-quick-transaction').addEventListener('click', () => {
    openCreateTransactionModal();
  });
  
  const btnQuickPos = document.getElementById('btn-quick-pos');
  if (btnQuickPos) {
    btnQuickPos.addEventListener('click', () => {
      openPOSIncomeModal();
    });
  }

  const btnQuickDelivery = document.getElementById('btn-quick-delivery');
  if (btnQuickDelivery) {
    btnQuickDelivery.addEventListener('click', () => {
      openDeliveryIncomeModal();
    });
  }
  
  document.getElementById('btn-quick-add-account').addEventListener('click', () => {
    // Go to Accounts view and focus on Account Form
    document.getElementById('btn-nav-accounts').click();
    document.getElementById('account-name').focus();
  });

  // 3. Transactions Filters Handlers
  document.getElementById('tx-search').addEventListener('input', (e) => {
    State.filters.search = e.target.value;
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('filter-type').addEventListener('change', (e) => {
    State.filters.type = e.target.value;
    State.filters.futureStatus = 'all';
    
    // Toggle future-specific filters
    const statusGroup = document.getElementById('filter-status-group');
    const dueDateGroup = document.getElementById('filter-due-date-group');
    if (e.target.value === 'future') {
      statusGroup.style.display = 'block';
      dueDateGroup.style.display = 'block';
    } else {
      statusGroup.style.display = 'none';
      dueDateGroup.style.display = 'none';
      // Reset future filters
      document.getElementById('filter-status').value = 'all';
      document.getElementById('filter-due-date-start').value = '';
      document.getElementById('filter-due-date-end').value = '';
      State.filters.futureStatus = 'all';
      State.filters.dueDateStart = '';
      State.filters.dueDateEnd = '';
    }
    
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('filter-category').addEventListener('change', (e) => {
    State.filters.category = e.target.value;
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('filter-account').addEventListener('change', (e) => {
    State.filters.account = e.target.value;
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('filter-date-start').addEventListener('change', (e) => {
    State.filters.dateStart = e.target.value;
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('filter-date-end').addEventListener('change', (e) => {
    State.filters.dateEnd = e.target.value;
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('filter-status').addEventListener('change', (e) => {
    State.filters.futureStatus = e.target.value;
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('filter-due-date-start').addEventListener('change', (e) => {
    State.filters.dueDateStart = e.target.value;
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('filter-due-date-end').addEventListener('change', (e) => {
    State.filters.dueDateEnd = e.target.value;
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  document.getElementById('btn-reset-filters').addEventListener('click', () => {
    document.getElementById('tx-search').value = '';
    document.getElementById('filter-type').value = 'all';
    document.getElementById('filter-category').value = 'all';
    document.getElementById('filter-account').value = 'all';
    document.getElementById('filter-date-start').value = '';
    document.getElementById('filter-date-end').value = '';
    document.getElementById('filter-status').value = 'all';
    document.getElementById('filter-due-date-start').value = '';
    document.getElementById('filter-due-date-end').value = '';
    
    document.getElementById('filter-status-group').style.display = 'none';
    document.getElementById('filter-due-date-group').style.display = 'none';

    State.filters = {
      type: 'all',
      category: 'all',
      account: 'all',
      search: '',
      dateStart: '',
      dateEnd: '',
      futureStatus: 'all',
      dueDateStart: '',
      dueDateEnd: ''
    };
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  // 4. Modal Triggers
  document.getElementById('btn-close-tx-modal').addEventListener('click', closeTransactionModal);
  document.getElementById('btn-cancel-tx-modal').addEventListener('click', closeTransactionModal);

  // Redirection from future details modal to filter on transactions view
  document.getElementById('btn-view-future-details-page').addEventListener('click', () => {
    closeFutureDetailsModal();
    
    // Navigate to transactions tab
    const navBtn = document.getElementById('btn-nav-transactions');
    if (navBtn) navBtn.click();
    
    // Apply filters
    State.filters.type = 'future';
    State.filters.futureStatus = 'unpaid';
    State.filters.category = 'all';
    State.filters.account = 'all';
    State.filters.dateStart = '';
    State.filters.dateEnd = '';
    State.filters.search = '';
    
    document.getElementById('filter-type').value = 'future';
    document.getElementById('filter-category').value = 'all';
    document.getElementById('filter-account').value = 'all';
    document.getElementById('filter-date-start').value = '';
    document.getElementById('filter-date-end').value = '';
    document.getElementById('tx-search').value = '';
    
    State.pagination.page = 1;
    refreshTransactionsTable();
    refreshReportsTable();
  });

  // Daily alert modal close events
  document.getElementById('btn-close-daily-alert').addEventListener('click', closeDailyAlertModal);
  document.getElementById('btn-close-daily-alert-footer').addEventListener('click', closeDailyAlertModal);
  document.getElementById('modal-daily-alert').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-daily-alert')) {
      closeDailyAlertModal();
    }
  });
  
  // Transaction Type Blocks logic
  const typeButtons = document.querySelectorAll('.transaction-type-blocks .type-block-btn');
  typeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      typeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const selectedType = btn.getAttribute('data-type');
      document.getElementById('tx-type').value = selectedType;
      handleTypeChange(selectedType);
    });
  });

  // Handle Payment Method changing account field in form (Interactive!)
  document.getElementById('tx-payment-method').addEventListener('change', () => {
    updateTransactionFormAccounts();
  });

  // Close modal when clicking on backdrop (main window background)
  document.getElementById('modal-transaction').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-transaction')) {
      closeTransactionModal();
    }
  });

  document.getElementById('modal-preview-attachment').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-preview-attachment')) {
      closePreviewModal();
    }
  });

  // --- 5. DRAG & DROP ATTACHMENT FILE UPLOAD ---
  const dropZone = document.getElementById('attachment-upload-zone');
  const fileInput = document.getElementById('tx-attachment-input');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--primary)';
    dropZone.style.backgroundColor = 'var(--primary-light-soft)';
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border-color)';
    dropZone.style.backgroundColor = 'var(--bg-app)';
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border-color)';
    dropZone.style.backgroundColor = 'var(--bg-app)';

    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      await handleAttachmentUpload(file);
    }
  });

  fileInput.addEventListener('change', async () => {
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      await handleAttachmentUpload(file);
    }
  });

  document.getElementById('btn-remove-attachment').addEventListener('click', removeUploadedAttachment);

  // 6. Submit Transaction Form
  document.getElementById('transaction-form').addEventListener('submit', handleTransactionSubmit);

  // 7. Accounts Form Logic & CRUD
  const accTypeSelect = document.getElementById('account-type');
  accTypeSelect.addEventListener('change', () => {
    const isBank = accTypeSelect.value === 'bank';
    document.getElementById('group-bank-name').style.display = isBank ? 'flex' : 'none';
    document.getElementById('group-account-number').style.display = isBank ? 'flex' : 'none';
  });

  document.getElementById('account-form').addEventListener('submit', handleAccountSubmit);
  document.getElementById('btn-cancel-account').addEventListener('click', resetAccountForm);

  // 8. Categories Form Logic & CRUD
  document.getElementById('category-form').addEventListener('submit', handleCategorySubmit);
  document.getElementById('btn-cancel-category').addEventListener('click', resetCategoryForm);

  // 9. Excel Export Banner
  document.getElementById('btn-export-excel-report').addEventListener('click', () => {
    ExcelExport.exportToExcel(State.transactions, State.accounts, State.categories);
  });

  // 10. Backup & Restore System Actions
  document.getElementById('btn-sidebar-backup').addEventListener('click', async () => {
    try {
      const data = await API.getBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `Smart_Wealth_Tracker_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('ล้มเหลวในการดาวน์โหลดไฟล์ Backup: ' + err.message);
    }
  });

  const sidebarRestoreBtn = document.getElementById('btn-sidebar-restore');
  const restoreFileInput = document.getElementById('file-restore-input');

  sidebarRestoreBtn.addEventListener('click', () => restoreFileInput.click());

  restoreFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const backupData = JSON.parse(event.target.result);
        const confirmRestore = confirm('⚠️ คำเตือน: การนำเข้าไฟล์สำรองข้อมูล (Restore) จะล้างฐานข้อมูลการเงินทั้งหมดในระบบปัจจุบันเพื่อแทนที่ด้วยไฟล์นี้ คุณแน่ใจที่จะดำเนินการต่อหรือไม่?');
        
        if (confirmRestore) {
          showLoader();
          const res = await API.restoreBackup(backupData);
          alert(res.message || 'กู้คืนข้อมูลระบบเสร็จสิ้น!');
          await reloadAppData();
        }
      } catch (err) {
        alert('เกิดข้อผิดพลาดในการอ่านไฟล์ Backup: โครงสร้างไฟล์ JSON ไม่ถูกต้อง');
      } finally {
        restoreFileInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  // 11. Custom Slip PDF Previews Close modals events
  const btnClosePreview = document.getElementById('btn-close-preview-modal');
  if (btnClosePreview) btnClosePreview.addEventListener('click', closePreviewModal);
  const btnClosePreviewFooter = document.getElementById('btn-close-preview-modal-footer');
  if (btnClosePreviewFooter) btnClosePreviewFooter.addEventListener('click', closePreviewModal);

  // 12. Future Expenses Modal Click Trigger & Close Events
  const metricFuture = document.getElementById('metric-future-expense');
  if (metricFuture) {
    metricFuture.style.cursor = 'pointer';
    metricFuture.addEventListener('click', openFutureDetailsModal);
  }
  
  const metricOverdue = document.getElementById('metric-overdue-expense');
  if (metricOverdue) {
    metricOverdue.style.cursor = 'pointer';
    metricOverdue.addEventListener('click', openFutureDetailsModal);
  }
  
  const btnCloseFuture = document.getElementById('btn-close-future-modal');
  if (btnCloseFuture) btnCloseFuture.addEventListener('click', closeFutureDetailsModal);
  const btnCloseFutureFooter = document.getElementById('btn-close-future-modal-footer');
  if (btnCloseFutureFooter) btnCloseFutureFooter.addEventListener('click', closeFutureDetailsModal);

  // Close future details modal when clicking on backdrop
  const modalFutureDetails = document.getElementById('modal-future-details');
  if (modalFutureDetails) {
    modalFutureDetails.addEventListener('click', (e) => {
      if (e.target === modalFutureDetails) {
        closeFutureDetailsModal();
      }
    });
  }

  // 13. Login Form Submit Handler
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = (document.getElementById('loginUsername')?.value || '').trim();
      const password  = document.getElementById('loginPasscode').value;
      const errorDiv  = document.getElementById('loginError');
      if (errorDiv) errorDiv.style.display = 'none';
      
      if (!username || !password) {
        if (errorDiv) { errorDiv.textContent = 'กรุณากรอก username และ password'; errorDiv.style.display = 'block'; }
        return;
      }
      
      try {
        showLoader();
        await API.login(username, password);
        const loginOverlay = document.getElementById('loginOverlay');
        if (loginOverlay) loginOverlay.classList.add('hidden');
        document.body.classList.remove('modal-open');
        
        // Show admin nav
        if (API.isAdmin()) {
          const adminBtn = document.getElementById('btn-nav-admin');
          if (adminBtn) adminBtn.style.display = '';
        }
        // Show username
        const user = API.getCurrentUser();
        const usernameEl = document.getElementById('sidebar-username');
        if (usernameEl) usernameEl.textContent = user.username;
        
        await reloadAppData();
      } catch (error) {
        if (errorDiv) { errorDiv.textContent = error.message; errorDiv.style.display = 'block'; }
        else alert(error.message);
      } finally {
        hideLoader();
      }
    });
  }

  // 14. Passcode Visibility Toggle Handler
  const toggleBtn = document.getElementById('btnTogglePasscode');
  const passcodeField = document.getElementById('loginPasscode');
  if (toggleBtn && passcodeField) {
    toggleBtn.addEventListener('click', () => {
      const type = passcodeField.getAttribute('type') === 'password' ? 'text' : 'password';
      passcodeField.setAttribute('type', type);
      const icon = toggleBtn.querySelector('i');
      if (icon) {
        icon.className = type === 'password' ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
      }
    });
  }

  // 15. Logout Button Handler
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
        await API.logout();
        location.reload();
      }
    });
  }

  // 16. Interactive Dashboard Metrics click handlers
  const totalWealthCard = document.getElementById('metric-total-wealth');
  if (totalWealthCard) {
    totalWealthCard.style.cursor = 'pointer';
    totalWealthCard.addEventListener('click', () => {
      document.getElementById('btn-nav-accounts').click();
    });
  }

  const totalIncomeCard = document.getElementById('metric-total-income');
  if (totalIncomeCard) {
    totalIncomeCard.style.cursor = 'pointer';
    totalIncomeCard.addEventListener('click', () => {
      document.getElementById('btn-nav-transactions').click();
      document.getElementById('filter-type').value = 'income';
      State.filters.type = 'income';
      
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
      const monthStart = today.slice(0, 8) + '01';
      document.getElementById('filter-date-start').value = monthStart;
      document.getElementById('filter-date-end').value = today;
      State.filters.dateStart = monthStart;
      State.filters.dateEnd = today;
      
      State.pagination.page = 1;
      refreshTransactionsTable();
      refreshReportsTable();
    });
  }

  const totalExpenseCard = document.getElementById('metric-total-expense');
  if (totalExpenseCard) {
    totalExpenseCard.style.cursor = 'pointer';
    totalExpenseCard.addEventListener('click', () => {
      document.getElementById('btn-nav-transactions').click();
      document.getElementById('filter-type').value = 'expense';
      State.filters.type = 'expense';
      
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
      const monthStart = today.slice(0, 8) + '01';
      document.getElementById('filter-date-start').value = monthStart;
      document.getElementById('filter-date-end').value = today;
      State.filters.dateStart = monthStart;
      State.filters.dateEnd = today;
      
      State.pagination.page = 1;
      refreshTransactionsTable();
      refreshReportsTable();
    });
  }
}

// --- Attachment Selection Logic ---
async function handleAttachmentUpload(file) {
  // Validate extension
  const ext = file.name.split('.').pop().toLowerCase();
  const allowed = ['jpg', 'jpeg', 'png', 'pdf'];
  if (!allowed.includes(ext)) {
    alert('รูปแบบไฟล์แนบไม่ถูกต้อง! รองรับเฉพาะไฟล์รูปภาพ JPG, PNG หรือ เอกสาร PDF เท่านั้น');
    return;
  }

  // Validate size (10MB limit)
  if (file.size > 10 * 1024 * 1024) {
    alert('ไฟล์มีขนาดใหญ่เกินไป! ขนาดไฟล์แนบต้องไม่เกิน 10MB');
    return;
  }

  // Store file locally, do NOT upload yet
  State.pendingFile = file;
  State.uploadedFileName = file.name;

  // Display Badge immediately
  document.getElementById('attachment-upload-zone').style.display = 'none';
  
  const badge = document.getElementById('uploaded-file-badge');
  const badgeIcon = document.getElementById('badge-file-icon');
  const badgeName = document.getElementById('badge-file-name');
  
  badgeName.innerText = file.name;
  badgeIcon.className = ext === 'pdf' ? 'fa-regular fa-file-pdf text-rose' : 'fa-regular fa-image text-indigo';
  
  badge.style.display = 'flex';
}

function removeUploadedAttachment() {
  State.uploadedFileUrl = null;
  State.uploadedFileName = null;
  State.pendingFile = null;
  
  document.getElementById('uploaded-file-badge').style.display = 'none';
  document.getElementById('attachment-upload-zone').style.display = 'flex';
  document.getElementById('tx-attachment-input').value = '';
}

// --- Modals Control Handlers ---

function openCreateTransactionModal() {
  // Reset Form
  document.getElementById('transaction-form').reset();
  document.getElementById('tx-id').value = '';
  document.getElementById('tx-slip-url').value = '';
  
  // Set date to today and reset due date and document number
  document.getElementById('tx-date').value = new Date().toLocaleDateString('sv-SE');
  document.getElementById('tx-due-date').value = '';
  document.getElementById('tx-document-number').value = '';
  
  // Reset Upload badge
  removeUploadedAttachment();
  
  // Reset type hidden field and select active button
  document.getElementById('tx-type').value = 'expense';
  const typeButtons = document.querySelectorAll('.transaction-type-blocks .type-block-btn');
  typeButtons.forEach(btn => {
    if (btn.getAttribute('data-type') === 'expense') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  handleTypeChange('expense');
  
  // Set default payment method and update accounts dropdown
  document.getElementById('tx-payment-method').value = 'Transfer';
  updateTransactionFormAccounts();

  document.getElementById('tx-modal-title').innerHTML = '<i class="fa-solid fa-money-bill-transfer text-indigo"></i> บันทึกธุรกรรมการเงิน';
  document.getElementById('modal-transaction').classList.add('active');
  document.body.classList.add('modal-open');
}

function openEditTransactionModal(id) {
  const t = (Array.isArray(State.transactions) ? State.transactions : []).find(tx => tx.id === id);
  if (!t) return;

  const isPos = t.subType === 'pos' || (t.category && t.category.includes('POS'));
  const isDelivery = t.subType === 'delivery' || (t.category && t.category.includes('สายส่ง'));

  if (isPos) {
    openPOSIncomeModal(t);
  } else if (isDelivery) {
    openDeliveryIncomeModal(t);
  } else {
    openGeneralEditTransactionModal(t);
  }
}

function openGeneralEditTransactionModal(t) {
  // Reset form first
  document.getElementById('transaction-form').reset();
  
  const isTransfer = t.type === 'transfer_out' || t.type === 'transfer_in';
  const formType = isTransfer ? 'transfer' : t.type;

  // Load data
  document.getElementById('tx-id').value = t.id;
  document.getElementById('tx-type').value = formType;
  document.getElementById('tx-date').value = t.date;
  
  // Update active type button state
  const typeButtons = document.querySelectorAll('.transaction-type-blocks .type-block-btn');
  typeButtons.forEach(btn => {
    if (btn.getAttribute('data-type') === formType) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  handleTypeChange(formType);
  
  if (formType === 'future') {
    document.getElementById('tx-status').value = t.status || 'pending';
    const otherTx = (Array.isArray(State.transactions) ? State.transactions : []).find(tx => tx.id === t.transferTxId);
    populateTransferAccountSelects();
    
    if (t.type === 'transfer_out') {
      document.getElementById('tx-account').value = t.accountId;
      if (otherTx) {
        document.getElementById('tx-to-account').value = otherTx.accountId;
      }
    } else {
      if (otherTx) {
        document.getElementById('tx-account').value = otherTx.accountId;
      }
      document.getElementById('tx-to-account').value = t.accountId;
    }
  } else {
    // Populate category based on loaded type and set value
    updateTransactionFormCategories();
    document.getElementById('tx-category').value = t.category;
    
    document.getElementById('tx-payment-method').value = t.paymentMethod;
    
    updateTransactionFormAccounts();
    document.getElementById('tx-account').value = t.accountId;
  }

  document.getElementById('tx-notes').value = t.notes || '';
  document.getElementById('tx-document-number').value = t.documentNumber || '';
  document.getElementById('tx-slip-url').value = t.slipUrl || '';

  // Setup uploaded badge
  if (t.slipUrl) {
    State.uploadedFileUrl = t.slipUrl;
    // Extract file name
    const filename = t.slipUrl.split('/').pop();
    State.uploadedFileName = filename;
    
    document.getElementById('attachment-upload-zone').style.display = 'none';
    
    const badge = document.getElementById('uploaded-file-badge');
    const badgeIcon = document.getElementById('badge-file-icon');
    const badgeName = document.getElementById('badge-file-name');
    
    badgeName.innerText = filename;
    
    const ext = filename.split('.').pop().toLowerCase();
    badgeIcon.className = ext === 'pdf' ? 'fa-regular fa-file-pdf text-rose' : 'fa-regular fa-image text-indigo';
    badge.style.display = 'flex';
  } else {
    removeUploadedAttachment();
  }

  document.getElementById('tx-modal-title').innerHTML = '<i class="fa-solid fa-pen-to-square text-indigo"></i> แก้ไขข้อมูลธุรกรรมการเงิน';
  document.getElementById('modal-transaction').classList.add('active');
  document.body.classList.add('modal-open');
}

function closeTransactionModal() {
  document.getElementById('modal-transaction').classList.remove('active');
  document.body.classList.remove('modal-open');
}

// Preview PDF or Slip image attachment
function previewAttachment(fileUrl) {
  const ext = fileUrl.split('.').pop().toLowerCase();
  
  document.getElementById('preview-img-container').style.display = 'none';
  document.getElementById('preview-pdf-container').style.display = 'none';
  document.getElementById('preview-error-container').style.display = 'none';
  
  document.getElementById('btn-download-preview-file').href = fileUrl;

  if (ext === 'pdf') {
    document.getElementById('preview-pdf').src = fileUrl;
    document.getElementById('preview-pdf-container').style.display = 'block';
  } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
    document.getElementById('preview-img').src = fileUrl;
    document.getElementById('preview-img-container').style.display = 'block';
  } else {
    document.getElementById('preview-error-container').style.display = 'block';
  }

  document.getElementById('modal-preview-attachment').classList.add('active');
  document.body.classList.add('modal-open');
}

function closePreviewModal() {
  document.getElementById('modal-preview-attachment').classList.remove('active');
  document.body.classList.remove('modal-open');
  // Clear iframe src to stop video/pdf reloading
  document.getElementById('preview-pdf').src = '';
}

// --- Future Expenses Modal Handlers ---
function openFutureDetailsModal() {
  const todayStr = new Date().toLocaleDateString('sv-SE');
  
  const sevenDaysLater = new Date();
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  const sevenDaysLaterStr = sevenDaysLater.toLocaleDateString('sv-SE');

  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);
  const thirtyDaysLaterStr = thirtyDaysLater.toLocaleDateString('sv-SE');

  // Filter future type transactions that are NOT paid
  const allPendingFuture = (Array.isArray(State.transactions) ? State.transactions : []).filter(t => t.type === 'future' && t.status !== 'paid');
  
  const todayList = allPendingFuture.filter(t => (t.dueDate || t.date) === todayStr);
  const weekList = allPendingFuture.filter(t => (t.dueDate || t.date) > todayStr && (t.dueDate || t.date) <= sevenDaysLaterStr);
  const monthList = allPendingFuture.filter(t => (t.dueDate || t.date) > todayStr && (t.dueDate || t.date) <= thirtyDaysLaterStr);
  const customTotal = allPendingFuture.reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const todayTotal = todayList.reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const weekTotal = weekList.reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const monthTotal = monthList.reduce((sum, t) => sum + Number(t.amount || 0), 0);

  // Set Block Values
  const fbTodayVal = document.getElementById('future-block-today-val');
  if (fbTodayVal) fbTodayVal.innerText = formatCurrency(todayTotal);
  const fbTodayCount = document.getElementById('future-block-today-count');
  if (fbTodayCount) fbTodayCount.innerText = `${todayList.length} รายการ`;

  const fbWeekVal = document.getElementById('future-block-week-val');
  if (fbWeekVal) fbWeekVal.innerText = formatCurrency(weekTotal);
  const fbWeekCount = document.getElementById('future-block-week-count');
  if (fbWeekCount) fbWeekCount.innerText = `${weekList.length} รายการ`;

  const fbMonthVal = document.getElementById('future-block-month-val');
  if (fbMonthVal) fbMonthVal.innerText = formatCurrency(monthTotal);
  const fbMonthCount = document.getElementById('future-block-month-count');
  if (fbMonthCount) fbMonthCount.innerText = `${monthList.length} รายการ`;

  const fbCustomVal = document.getElementById('future-block-custom-val');
  if (fbCustomVal) fbCustomVal.innerText = formatCurrency(customTotal);
  const fbCustomCount = document.getElementById('future-block-custom-count');
  if (fbCustomCount) fbCustomCount.innerText = `${allPendingFuture.length} รายการ`;

  const blockToday = document.getElementById('block-future-today');
  const blockWeek = document.getElementById('block-future-week');
  const blockMonth = document.getElementById('block-future-month');
  const blockCustom = document.getElementById('block-future-custom');
  const customInputs = document.getElementById('future-custom-range-inputs');

  // Set default custom dates (start = today, end = today + 30)
  if (!document.getElementById('future-custom-start').value) {
    document.getElementById('future-custom-start').value = todayStr;
    document.getElementById('future-custom-end').value = thirtyDaysLaterStr;
  }

  let activeTab = 'today';

  function updateModalList() {
    blockToday.classList.remove('active');
    blockWeek.classList.remove('active');
    blockMonth.classList.remove('active');
    blockCustom.classList.remove('active');
    customInputs.style.display = 'none';

    let displayList = [];
    let titleText = '';

    if (activeTab === 'today') {
      blockToday.classList.add('active');
      titleText = '<i class="fa-solid fa-calendar-day text-rose"></i> รายการที่ต้องชำระวันนี้';
      displayList = todayList;
    } else if (activeTab === 'week') {
      blockWeek.classList.add('active');
      titleText = '<i class="fa-solid fa-calendar-week text-amber-hover"></i> รายการค้างจ่ายในอีก 7 วันข้างหน้า';
      displayList = weekList;
    } else if (activeTab === 'month') {
      blockMonth.classList.add('active');
      titleText = '<i class="fa-solid fa-calendar-days text-indigo"></i> รายการค้างจ่ายในอีก 30 วันข้างหน้า';
      displayList = monthList;
    } else if (activeTab === 'custom') {
      blockCustom.classList.add('active');
      customInputs.style.display = 'flex';
      titleText = '<i class="fa-solid fa-sliders text-slate"></i> รายการค้างจ่าย (กำหนดระยะเวลาเอง)';

      const startVal = document.getElementById('future-custom-start').value;
      const endVal = document.getElementById('future-custom-end').value;

      displayList = allPendingFuture.filter(t => {
        const targetDate = t.dueDate || t.date;
        if (startVal && targetDate < startVal) return false;
        if (endVal && targetDate > endVal) return false;
        return true;
      });

      const currentCustomTotal = displayList.reduce((sum, t) => sum + Number(t.amount || 0), 0);
      document.getElementById('future-block-custom-val').innerText = formatCurrency(currentCustomTotal);
      document.getElementById('future-block-custom-count').innerText = `${displayList.length} รายการ`;
    }

    document.getElementById('future-details-title').innerHTML = titleText;

    const listContainer = document.getElementById('future-details-list-container');
    listContainer.innerHTML = '';

    if (displayList.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state py-8">
          <i class="fa-regular fa-calendar-xmark empty-icon text-slate text-xl mb-2"></i>
          <p class="empty-text text-sm">ไม่พบรายการค้างชำระในช่วงเวลาที่เลือก</p>
        </div>`;
    } else {
      displayList.forEach(t => renderFutureDetailRow(t, listContainer));
    }
  }

  blockToday.onclick = () => { activeTab = 'today'; updateModalList(); };
  blockWeek.onclick = () => { activeTab = 'week'; updateModalList(); };
  blockMonth.onclick = () => { activeTab = 'month'; updateModalList(); };
  blockCustom.onclick = () => { activeTab = 'custom'; updateModalList(); };

  document.getElementById('future-custom-start').onchange = () => { if (activeTab === 'custom') updateModalList(); };
  document.getElementById('future-custom-end').onchange = () => { if (activeTab === 'custom') updateModalList(); };

  // Set default active tab
  activeTab = todayList.length > 0 ? 'today' : weekList.length > 0 ? 'week' : monthList.length > 0 ? 'month' : 'custom';
  updateModalList();

  document.getElementById('modal-future-details').classList.add('active');
  document.body.classList.add('modal-open');
}

function renderFutureDetailRow(t, container) {
  const acc = State.accounts.find(a => a.id === t.accountId);
  container.innerHTML += `
    <div class="future-detail-item">
      <div class="future-detail-left">
        <span class="future-detail-date"><i class="fa-solid fa-clock"></i> ${formatDateThShort(t.dueDate || t.date)}</span>
        <span class="future-detail-title">${t.notes || t.category}</span>
        <span class="future-detail-cat">หมวดหมู่: ${t.category}</span>
      </div>
      <div class="future-detail-right">
        <span class="future-detail-amount">-${formatCurrency(t.amount)}</span>
        <span class="future-detail-acc">${acc ? acc.name : 'ไม่ระบุ'}</span>
      </div>
    </div>`;
}

function closeFutureDetailsModal() {
  document.getElementById('modal-future-details').classList.remove('active');
  document.body.classList.remove('modal-open');
}

// --- API Actions Form Submissions ---

// Transaction Form Submit
async function handleTransactionSubmit(e) {
  e.preventDefault();
  
  const id = document.getElementById('tx-id').value;
  const type = document.getElementById('tx-type').value;
  const date = document.getElementById('tx-date').value;
  const category = document.getElementById('tx-category').value;
  const amount = Number(document.getElementById('tx-amount').value);
  const paymentMethod = document.getElementById('tx-payment-method').value;
  
  // If payment method is Cash, force accountId to cash
  const accountId = paymentMethod === 'Cash' ? 'acc-cash' : (paymentMethod === 'Unspecified' ? '' : document.getElementById('tx-account').value);
  const toAccountId = document.getElementById('tx-to-account').value;
  
  const dueDate = document.getElementById('tx-due-date').value;

  // Check if future transaction is being paid but account is unspecified
  if (type === 'future') {
    if (!dueDate) {
      alert('กรุณาระบุวันครบกำหนดชำระ');
      document.getElementById('tx-due-date').focus();
      return;
    }
    const status = document.getElementById('tx-status').value;
    if (status === 'paid' && (paymentMethod === 'Unspecified' || !accountId)) {
      alert('กรุณาระบุวิธีการชำระเงินและบัญชีที่ใช้จ่ายก่อนทำรายการชำระเงิน');
      document.getElementById('tx-payment-method').focus();
      return;
    }
  }

  const notes = document.getElementById('tx-notes').value;
  const documentNumber = (document.getElementById('tx-document-number').value || '').trim();

  showLoader();
  
  let slipUrl = document.getElementById('tx-slip-url').value || State.uploadedFileUrl;
  
  // Upload file first if there is a pending file selection
  if (State.pendingFile) {
    try {
      const uploadRes = await API.uploadAttachment(State.pendingFile);
      slipUrl = uploadRes.fileUrl;
    } catch (uploadError) {
      hideLoader();
      alert('อัปโหลดไฟล์แนบล้มเหลว: ' + uploadError.message);
      return;
    }
  }

  const txData = {
    date,
    type,
    category: type === 'transfer' ? 'โอนย้ายเงิน' : category,
    amount,
    paymentMethod: type === 'transfer' ? 'Transfer' : paymentMethod,
    accountId: type === 'transfer' ? document.getElementById('tx-account').value : accountId,
    toAccountId: type === 'transfer' ? toAccountId : undefined,
    documentNumber,
    notes,
    slipUrl: slipUrl || null,
    status: type === 'future' ? document.getElementById('tx-status').value : undefined,
    dueDate: type === 'future' ? dueDate : undefined
  };

  try {
    if (id) {
      await API.updateTransaction(id, txData);
    } else {
      await API.createTransaction(txData);
    }
    
    // Reset pending file
    State.pendingFile = null;
    
    closeTransactionModal();
    await reloadAppData();
  } catch (error) {
    alert('บันทึกธุรกรรมล้มเหลว: ' + error.message);
  } finally {
    hideLoader();
  }
}

// Delete Transaction
async function deleteTransaction(id) {
  const confirmDelete = confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการธุรกรรมการเงินนี้? (รายการจะถูกย้ายไปที่ถังขยะและคุณสามารถกู้คืนได้ภายหลัง)');
  if (!confirmDelete) return;

  showLoader();
  try {
    await API.deleteTransaction(id);
    await reloadAppData();
  } catch (error) {
    alert('ลบรายการล้มเหลว: ' + error.message);
  } finally {
    hideLoader();
  }
}

// Account Form Submit
async function handleAccountSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('account-id').value;
  const name = document.getElementById('account-name').value;
  const type = document.getElementById('account-type').value;
  const bankName = type === 'bank' ? document.getElementById('account-bank').value : '-';
  const accountNumber = type === 'bank' ? document.getElementById('account-number').value : '-';
  const initialBalance = Number(document.getElementById('account-initial-balance').value);

  const accData = {
    name,
    type,
    bankName,
    accountNumber,
    initialBalance
  };

  showLoader();
  try {
    if (id) {
      await API.updateAccount(id, accData);
    } else {
      await API.createAccount(accData);
    }
    
    resetAccountForm();
    await reloadAppData();
  } catch (error) {
    alert('บันทึกบัญชีล้มเหลว: ' + error.message);
  } finally {
    hideLoader();
  }
}

function loadAccountToForm(id) {
  const acc = State.accounts.find(a => a.id === id);
  if (!acc) return;

  document.getElementById('account-id').value = acc.id;
  document.getElementById('account-name').value = acc.name;
  
  const typeSelect = document.getElementById('account-type');
  typeSelect.value = acc.type;
  
  if (acc.type === 'cash') {
    document.getElementById('group-bank-name').style.display = 'none';
    document.getElementById('group-account-number').style.display = 'none';
  } else {
    document.getElementById('group-bank-name').style.display = 'flex';
    document.getElementById('group-account-number').style.display = 'flex';
    document.getElementById('account-bank').value = acc.bankName;
    document.getElementById('account-number').value = acc.accountNumber || '';
  }

  // For default cash account, prevent changing type to bank
  if (acc.id === 'acc-cash') {
    typeSelect.disabled = true;
  } else {
    typeSelect.disabled = false;
  }

  document.getElementById('account-initial-balance').value = acc.initialBalance;
  
  document.getElementById('account-form-title').innerHTML = '<i class="fa-solid fa-pen-to-square text-indigo"></i> แก้ไขข้อมูลบัญชีการเงิน';
  document.getElementById('btn-submit-account').innerText = 'บันทึกการแก้ไข';
  
  // Scroll to form (on mobile/tablets)
  document.getElementById('account-name').focus();
}

function resetAccountForm() {
  document.getElementById('account-form').reset();
  document.getElementById('account-id').value = '';
  document.getElementById('account-type').disabled = false;
  
  // Reset bank fields display
  document.getElementById('group-bank-name').style.display = 'flex';
  document.getElementById('group-account-number').style.display = 'flex';

  document.getElementById('account-form-title').innerHTML = '<i class="fa-solid fa-plus-minus text-indigo"></i> สร้างบัญชีการเงินใหม่';
  document.getElementById('btn-submit-account').innerText = 'บันทึกบัญชี';
}

// Delete Account
async function deleteAccount(id) {
  const confirmDelete = confirm('⚠️ คำเตือน: การลบบัญชีการเงินนี้จะทำให้ธุรกรรมต่างๆ ที่เคยผูกกับบัญชีนี้เป็นสถานะ "ไม่ระบุบัญชี" และคุณไม่สามารถลบบัญชีหลัก "เงินสด" ได้ คุณต้องการดำเนินการลบบัญชีนี้จริงหรือไม่?');
  if (!confirmDelete) return;

  showLoader();
  try {
    await API.deleteAccount(id);
    await reloadAppData();
  } catch (error) {
    alert('ลบบัญชีล้มเหลว: ' + error.message);
  } finally {
    hideLoader();
  }
}

// Category Form Submit
async function handleCategorySubmit(e) {
  e.preventDefault();

  const id = document.getElementById('category-id').value;
  const name = document.getElementById('category-name').value;
  const type = document.getElementById('category-type').value;
  const sortOrder = Number(document.getElementById('category-sort-order')?.value || 0);

  const catData = { name, type, sortOrder };

  showLoader();
  try {
    if (id) {
      await API.updateCategory(id, catData);
    } else {
      await API.createCategory(catData);
    }
    resetCategoryForm();
    await reloadAppData();
  } catch (error) {
    alert('บันทึกหมวดหมู่ล้มเหลว: ' + error.message);
  } finally {
    hideLoader();
  }
}

function loadCategoryToForm(id) {
  const cat = State.categories.find(c => c.id === id);
  if (!cat) return;

  document.getElementById('category-id').value = cat.id;
  document.getElementById('category-name').value = cat.name;
  document.getElementById('category-type').value = cat.type;
  
  const sortOrderInput = document.getElementById('category-sort-order');
  if (sortOrderInput) sortOrderInput.value = cat.sortOrder !== undefined ? cat.sortOrder : 0;

  document.getElementById('category-form-title').innerHTML = '<i class="fa-solid fa-pen-to-square text-indigo"></i> แก้ไขข้อมูลหมวดหมู่';
  document.getElementById('btn-submit-category').innerText = 'บันทึกการแก้ไข';
  document.getElementById('category-name').focus();
}

function resetCategoryForm() {
  document.getElementById('category-form').reset();
  document.getElementById('category-id').value = '';
  
  const sortOrderInput = document.getElementById('category-sort-order');
  if (sortOrderInput) sortOrderInput.value = '0';

  document.getElementById('category-form-title').innerHTML = '<i class="fa-solid fa-tags text-indigo"></i> จัดการหมวดหมู่รายรับ-รายจ่าย';
  document.getElementById('btn-submit-category').innerText = 'บันทึกหมวดหมู่';
}

// Delete Category
async function deleteCategory(id) {
  const confirmDelete = confirm('คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่นี้?');
  if (!confirmDelete) return;

  showLoader();
  try {
    await API.deleteCategory(id);
    await reloadAppData();
  } catch (error) {
    alert('ลบหมวดหมู่ล้มเหลว: ' + error.message);
  } finally {
    hideLoader();
  }
}

// Expose category methods globally
window.loadCategoryToForm = loadCategoryToForm;
window.deleteCategory = deleteCategory;


// --- Helper Formatting Utilities ---

// Thai Currency Formatter (฿1,234.56)
function formatCurrency(value) {
  const num = Number(value || 0);
  return '฿' + new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// Number representation of currency (1,234.56 without ฿ symbol)
function formatCurrencyNumber(value) {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

// Convert YYYY-MM-DD to short Thai format (e.g. 29 พ.ค. 69)
function formatDateThShort(dateStr) {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d     = new Date(parts[0], parts[1] - 1, parts[2]);
  const day   = d.getDate();
  const month = d.toLocaleDateString('th-TH', { month: 'short' });
  const year  = String(d.getFullYear() + 543).slice(-2);
  return `${day} ${month} ${year}`;
}

function handleTypeChange(type) {
  const statusGroup = document.getElementById('group-tx-status');
  const dueDateGroup = document.getElementById('group-tx-due-date');
  const catGroup = document.getElementById('group-tx-category');
  const methodGroup = document.getElementById('group-tx-payment-method');
  const toAccGroup = document.getElementById('group-tx-to-account');
  const accLabel = document.querySelector('#group-tx-account label');
  const dateLabel = document.querySelector('label[for="tx-date"]');

  if (statusGroup) statusGroup.style.display = type === 'future' ? 'flex' : 'none';
  if (dueDateGroup) dueDateGroup.style.display = type === 'future' ? 'flex' : 'none';
  if (dateLabel) {
    dateLabel.innerHTML = 'วันที่ทำรายการ <span class="text-rose">*</span>';
  }

  if (type === 'transfer') {
    if (catGroup) catGroup.style.display = 'none';
    if (methodGroup) methodGroup.style.display = 'none';
    if (toAccGroup) toAccGroup.style.display = 'flex';
    if (accLabel) accLabel.innerHTML = 'จากบัญชี (ต้นทาง) <span class="text-rose">*</span>';
    populateTransferAccountSelects();
  } else {
    if (catGroup) catGroup.style.display = 'flex';
    if (methodGroup) methodGroup.style.display = 'flex';
    if (toAccGroup) toAccGroup.style.display = 'none';
    if (accLabel) {
      accLabel.innerHTML = type === 'future' ? 'บัญชีที่ใช้จ่ายเงิน' : 'บัญชีการเงินที่ผูก <span class="text-rose">*</span>';
    }
    if (type === 'future') {
      document.getElementById('tx-payment-method').value = 'Unspecified';
    } else {
      if (document.getElementById('tx-payment-method').value === 'Unspecified') {
        document.getElementById('tx-payment-method').value = 'Transfer';
      }
    }
    updateTransactionFormCategories();
    updateTransactionFormAccounts();
  }
}

// ─── TRASH PAGE ───────────────────────────────────────────────────────────────
async function loadTrashPage() {
  const container = document.getElementById('trash-transactions-container');
  if (!container) return;
  container.innerHTML = '<p class="text-slate" style="padding:1rem;">กำลังโหลด...</p>';
  try {
    const { transactions, accounts } = await API.getTrash();
    if (!transactions?.length && !accounts?.length) {
      container.innerHTML = '<div class="empty-state"><p class="empty-text">ถังขยะว่างเปล่า</p></div>';
      return;
    }
    
    let html = '';
    
    // 1. Transactions section
    if (transactions && transactions.length > 0) {
      html += '<h4 style="margin-bottom: 0.5rem; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 0.5rem;"><i class="fa-solid fa-list-check text-indigo"></i> รายการธุรกรรมที่ลบ</h4>';
      html += '<div class="table-container scrollbar" style="max-height:250px; margin-bottom: 1.5rem;"><table class="premium-table compact"><thead><tr><th>วันที่</th><th>ประเภท</th><th>หมวดหมู่</th><th>จำนวนเงิน</th><th>จัดการ</th></tr></thead><tbody>';
      transactions.forEach(t => {
        const dt  = formatDateThShort(t.date);
        const cls = t.type === 'income' ? 'text-amount-inc' : 'text-amount-exp';
        const typeLabel = t.type === 'income' ? 'รายรับ' : (t.type === 'future' ? 'จ่ายล่วงหน้า' : 'รายจ่าย');
        html += '<tr><td>' + dt + '</td><td>' + typeLabel + '</td><td>' + t.category + '</td><td class="' + cls + '">' + formatCurrency(t.amount) + '</td><td><button class="btn btn-outline btn-xs" onclick="restoreTrashItem(\'transaction\',\'' + t.id + '\')">กู้คืน</button> <button class="btn btn-xs" style="background:var(--rose);color:#fff;" onclick="permanentDeleteItem(\'transaction\',\'' + t.id + '\')">ลบถาวร</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    
    // 2. Accounts section
    if (accounts && accounts.length > 0) {
      html += '<h4 style="margin-bottom: 0.5rem; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 0.5rem;"><i class="fa-solid fa-building-columns text-indigo"></i> บัญชีที่ลบ</h4>';
      html += '<div class="table-container scrollbar" style="max-height:200px;"><table class="premium-table compact"><thead><tr><th>ชื่อบัญชี</th><th>ประเภท</th><th>ยอดเงินเริ่มต้น</th><th>จัดการ</th></tr></thead><tbody>';
      accounts.forEach(a => {
        const typeLabel = a.type === 'cash' ? 'เงินสด' : 'บัญชีธนาคาร';
        html += '<tr><td>' + a.name + '</td><td>' + typeLabel + '</td><td>' + formatCurrency(a.initialBalance) + '</td><td><button class="btn btn-outline btn-xs" onclick="restoreTrashItem(\'account\',\'' + a.id + '\')">กู้คืน</button> <button class="btn btn-xs" style="background:var(--rose);color:#fff;" onclick="permanentDeleteItem(\'account\',\'' + a.id + '\')">ลบถาวร</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<p class="text-rose">เกิดข้อผิดพลาด: ' + e.message + '</p>';
  }
}

async function restoreTrashItem(type, id) {
  try { await API.restoreFromTrash(type, id); await reloadAppData(); await loadTrashPage(); }
  catch (e) { alert('กู้คืนไม่สำเร็จ: ' + e.message); }
}

async function permanentDeleteItem(type, id) {
  if (!confirm('ลบถาวร? ไม่สามารถกู้คืนได้อีก')) return;
  try { await API.permanentDelete(type, id); await reloadAppData(); await loadTrashPage(); }
  catch (e) { alert('ลบไม่สำเร็จ: ' + e.message); }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────────────────────
async function loadAdminPanel() {
  if (!API.isAdmin()) return;
  try {
    const stats = await API.getAdminStats();
    const el = document.getElementById('admin-stats-container');
    if (el) el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;padding:0.5rem 0;">
        <div class="stat-mini-box"><span class="stat-mini-lbl">Transactions</span><span class="stat-mini-val text-indigo">${stats.transactions||0}</span></div>
        <div class="stat-mini-box"><span class="stat-mini-lbl">Accounts</span><span class="stat-mini-val text-indigo">${stats.accounts||0}</span></div>
        <div class="stat-mini-box"><span class="stat-mini-lbl">Categories</span><span class="stat-mini-val text-indigo">${stats.categories||0}</span></div>
        <div class="stat-mini-box"><span class="stat-mini-lbl">Last Backup</span><span class="stat-mini-val" style="font-size:0.8rem;">${stats.lastBackup?(stats.lastBackup.status==='success'?'✅':'❌')+' '+(stats.lastBackup.created_at?.slice(0,10)||'-'):'ไม่มีข้อมูล'}</span></div>
      </div>`;
  } catch {}
  try {
    const users = await API.getUsers();
    const me    = API.getCurrentUser();
    const el    = document.getElementById('admin-users-list');
    if (el) el.innerHTML = users.map(u => {
      const isSelf = me && u.username === me.username;
      const toggleLabel = u.is_active ? '<i class="fa-solid fa-ban"></i> ปิดใช้งาน' : '<i class="fa-solid fa-check"></i> เปิดใช้งาน';
      const resetBtn = `<button class="btn btn-xs" style="background:var(--amber);color:#fff;" onclick="adminResetPassword('${u.id}','${u.username}')"><i class="fa-solid fa-key"></i> รีเซ็ตรหัส</button>`;
      const deleteBtn = isSelf ? '' : `<button class="btn btn-xs" style="background:var(--rose);color:#fff;" onclick="adminDeleteUser('${u.id}','${u.username}')"><i class="fa-solid fa-trash-can"></i> ลบ</button>`;
      const selfBadge = isSelf ? '<span class="badge badge-emerald" style="margin-left:0.25rem;">ตัวคุณ</span>' : '';
      const inactiveBadge = !u.is_active ? '<span class="badge badge-rose" style="margin-left:0.25rem;">ปิดใช้งาน</span>' : '';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid var(--border-color);gap:0.5rem;flex-wrap:wrap;">
        <div><span style="font-weight:600;">${u.username}</span>
          <span class="badge ${u.role==='admin'?'badge-indigo':'badge-slate'}" style="margin-left:0.5rem;">${u.role}</span>
          ${inactiveBadge}${selfBadge}</div>
        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
          <button class="btn btn-outline btn-xs" onclick="toggleUserActive('${u.id}',${!u.is_active})">${toggleLabel}</button>
          ${resetBtn}${deleteBtn}
        </div></div>`;
    }).join('');
  } catch {}
  try {
    const logs = await API.getAuditLogs(100);
    const tbody = document.getElementById('audit-table-body');
    if (tbody) tbody.innerHTML = logs.length
      ? logs.map(l => `<tr>
          <td style="white-space:nowrap;font-size:0.78rem;">${(l.created_at||'').slice(0,16)}</td>
          <td>${l.username||'-'}</td>
          <td><span class="badge badge-slate" style="font-size:0.7rem;">${l.action}</span></td>
          <td>${l.resource}${l.resource_id?' #'+l.resource_id.slice(0,8):''}</td>
          <td style="font-size:0.78rem;">${l.ip_address||'-'}</td></tr>`).join('')
      : '<tr><td colspan="5" class="text-center text-slate">ไม่มีข้อมูล</td></tr>';
  } catch {}

  const showFormBtn = document.getElementById('btn-show-create-user');
  if (showFormBtn && !showFormBtn._bound) {
    showFormBtn._bound = true;
    showFormBtn.addEventListener('click', () => {
      const form = document.getElementById('admin-create-user-form');
      if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
    });
  }
  const createUserBtn = document.getElementById('btn-create-user');
  if (createUserBtn && !createUserBtn._bound) {
    createUserBtn._bound = true;
    createUserBtn.addEventListener('click', async () => {
      const username = document.getElementById('new-user-username').value.trim();
      const password = document.getElementById('new-user-password').value;
      if (!username || !password) { alert('กรุณากรอก username และ password'); return; }
      try {
        await API.createUser({ username, password, role: 'user' });
        alert('สร้างผู้ใช้สำเร็จ');
        document.getElementById('new-user-username').value = '';
        document.getElementById('new-user-password').value = '';
        document.getElementById('admin-create-user-form').style.display = 'none';
        await loadAdminPanel();
      } catch (e) { alert('สร้างผู้ใช้ไม่สำเร็จ: ' + e.message); }
    });
  }
  // จัดการตั้งค่า LINE Bot
  await loadLineSettings();

  // ตั้งค่าเริ่มต้นของวันที่และเดือนย้อนหลังในหน้ารายงาน
  const dailyInput = document.getElementById('report-daily-date');
  const monthlyInput = document.getElementById('report-monthly-date');
  if (dailyInput && !dailyInput.value) {
    dailyInput.value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  }
  if (monthlyInput && !monthlyInput.value) {
    monthlyInput.value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  }
}

async function toggleUserActive(userId, isActive) {
  try { await API.updateUser(userId, { isActive }); await loadAdminPanel(); }
  catch (e) { alert('อัปเดตไม่สำเร็จ: ' + e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  const trashBtn = document.getElementById('btn-nav-trash');
  if (trashBtn) trashBtn.addEventListener('click', () => loadTrashPage());
  const adminBtn = document.getElementById('btn-nav-admin');
  if (adminBtn) adminBtn.addEventListener('click', () => loadAdminPanel());
});

window.restoreTrashItem    = restoreTrashItem;
window.permanentDeleteItem = permanentDeleteItem;
window.toggleUserActive    = toggleUserActive;

// ─── Admin User Management ────────────────────────────────────────────────────

/** รีเซ็ตรหัสผ่านของ user */
async function adminResetPassword(userId, username) {
  const newPass = prompt(`รีเซ็ตรหัสผ่านของ "${username}"\n\nใส่รหัสผ่านใหม่ (ขั้นต่ำ 6 ตัวอักษร):`);
  if (!newPass) return;
  if (newPass.length < 6) { alert('❌ รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
  try {
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('swt_session_token')}`,
      },
      body: JSON.stringify({ newPassword: newPass }),
    });
    const data = await res.json();
    if (res.ok) alert(`✅ รีเซ็ตรหัสผ่านของ "${username}" สำเร็จ`);
    else        alert('❌ ' + (data.error || 'รีเซ็ตไม่สำเร็จ'));
  } catch (e) { alert('❌ เกิดข้อผิดพลาด: ' + e.message); }
}

/** ลบ user ออกจากระบบ */
async function adminDeleteUser(userId, username) {
  if (!confirm(`⚠️ ลบผู้ใช้ "${username}" ออกจากระบบ?\n\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method : 'DELETE',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('swt_session_token')}` },
    });
    const data = await res.json();
    if (res.ok) { alert(`✅ ลบผู้ใช้ "${username}" สำเร็จ`); await loadAdminPanel(); }
    else        alert('❌ ' + (data.error || 'ลบไม่สำเร็จ'));
  } catch (e) { alert('❌ เกิดข้อผิดพลาด: ' + e.message); }
}

window.adminResetPassword = adminResetPassword;
window.adminDeleteUser    = adminDeleteUser;

async function markAsPaid(id) {
  const t = (Array.isArray(State.transactions) ? State.transactions : []).find(tx => tx.id === id);
  if (!t) return;
  
  if (t.paymentMethod === 'Unspecified' || !t.accountId || t.accountId === 'unspecified' || t.accountId === '') {
    alert('กรุณาระบุวิธีการชำระเงินและบัญชีที่ใช้จ่ายก่อนทำรายการชำระเงิน');
    openEditTransactionModal(id);
    return;
  }
  
  showLoader();
  try {
    await API.updateTransaction(id, {
      ...t,
      status: 'paid'
    });
    await reloadAppData();
  } catch (error) {
    alert('ไม่สามารถอัปเดตสถานะได้: ' + error.message);
  } finally {
    hideLoader();
  }
}
window.markAsPaid = markAsPaid;

// ─── LINE Messaging Bot — Admin Functions ─────────────────────────────────────

/** โหลดสถานะ LINE จาก API แล้วอัปเดต UI */
async function loadLineSettings() {
  try {
    const res  = await fetch('/api/admin/line-settings', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('swt_session_token')}` },
    });
    if (!res.ok) return;
    const data = await res.json();

    const badge   = document.getElementById('line-bot-status-badge');
    const statusText = document.getElementById('line-bot-status-text');

    if (data.configured) {
      badge.textContent = '✅ ตั้งค่าแล้ว';
      badge.className   = 'badge badge-emerald';
      const src = data.usingEnvVar ? 'Cloudflare Secret (env)' : `Database (Group: ${data.groupIdHint || '-'})`;
      statusText.textContent = `Bot พร้อมใช้งาน — ใช้ credential จาก ${src}`;
    } else if (data.hasToken && !data.hasGroupId) {
      badge.textContent = '⚠️ ขาด Group ID';
      badge.className   = 'badge badge-amber';
      statusText.textContent = 'มี Channel Token แล้ว แต่ยังไม่ได้ตั้งค่า Group ID';
    } else {
      badge.textContent = '❌ ยังไม่ตั้งค่า';
      badge.className   = 'badge badge-rose';
      statusText.textContent = 'กรุณาใส่ Channel Access Token และ Group ID แล้วกดบันทึก';
    }
  } catch (e) {
    console.warn('[LINE] loadLineSettings error:', e.message);
  }
}

/** เปิด Modal ตั้งค่า LINE */
function openLineSettingsModal() {
  const modal = document.getElementById('lineSettingsModal');
  if (modal) {
    modal.style.display = 'flex';
    // Clear input fields initially to prevent accidentally showing old typed data
    document.getElementById('line-channel-token').value = '';
  }
}

/** ปิด Modal ตั้งค่า LINE */
function closeLineSettingsModal() {
  const modal = document.getElementById('lineSettingsModal');
  if (modal) modal.style.display = 'none';
}

/** บันทึก Channel Token + Group ID ลง Database */
async function saveLineSettings() {
  const token   = document.getElementById('line-channel-token')?.value?.trim();
  const groupId = document.getElementById('line-group-id')?.value?.trim();

  if (!token || !groupId) {
    alert('❌ กรุณาใส่ Channel Access Token และ Group ID ให้ครบ');
    return;
  }

  const btn = document.getElementById('btn-save-line-settings');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...'; }

  try {
    const res = await fetch('/api/admin/line-settings', {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('swt_session_token')}`,
      },
      body: JSON.stringify({ channelToken: token, groupId }),
    });
    const data = await res.json();
    if (res.ok) {
      alert('✅ ' + data.message);
      document.getElementById('line-channel-token').value = '';  // Clear for security
      closeLineSettingsModal(); // ปิด Modal อัตโนมัติเมื่อสำเร็จ
      await loadLineSettings();
    } else {
      alert('❌ ' + (data.error || 'บันทึกไม่สำเร็จ'));
    }
  } catch (e) {
    alert('❌ เกิดข้อผิดพลาด: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึก'; }
  }
}

/** ทดสอบส่งข้อความเข้ากลุ่ม LINE */
async function testLineBot() {
  const btn = document.getElementById('btn-test-line');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังส่ง...'; }
  try {
    const res = await fetch('/api/admin/test-line', {
      method : 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('swt_session_token')}` },
    });
    const data = await res.json();
    if (res.ok) {
      alert('✅ ' + data.message);
      await loadLineSettings();
    } else {
      alert('❌ ' + (data.error || 'ส่งไม่สำเร็จ'));
    }
  } catch (e) {
    alert('❌ เกิดข้อผิดพลาด: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ทดสอบส่ง'; }
  }
}

/** ส่ง Daily Report เข้ากลุ่ม LINE ทันที */
async function sendLineReport() {
  const selectedDate = document.getElementById('report-daily-date')?.value || '';
  if (!confirm(`ส่ง Daily Report ของวันที่ ${selectedDate || 'วันนี้'} เข้ากลุ่ม LINE ตอนนี้เลยใช่ไหม?`)) return;
  const btn = document.getElementById('btn-send-report');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังส่ง...'; }
  try {
    const res = await fetch('/api/admin/send-report', {
      method : 'POST',
      headers: { 
        'Authorization': `Bearer ${localStorage.getItem('swt_session_token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ date: selectedDate })
    });
    const data = await res.json();
    if (res.ok) alert('✅ ' + data.message);
    else        alert('❌ ' + (data.error || 'ส่งไม่สำเร็จ'));
  } catch (e) {
    alert('❌ เกิดข้อผิดพลาด: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-chart-bar"></i> ส่ง Daily'; }
  }
}

/** Toggle แสดง/ซ่อน token */
function toggleLineTokenVisibility() {
  const input = document.getElementById('line-channel-token');
  const icon  = document.getElementById('line-token-eye');
  if (!input) return;
  if (input.type === 'password') {
    input.type    = 'text';
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type    = 'password';
    icon.className = 'fa-solid fa-eye';
  }
}

/** ส่ง Monthly Report เข้ากลุ่ม LINE ทันที */
async function sendLineMonthlyReport() {
  const selectedMonth = document.getElementById('report-monthly-date')?.value || '';
  if (!confirm(`ส่ง Monthly Report ของเดือน ${selectedMonth || 'เดือนนี้'} เข้ากลุ่ม LINE ตอนนี้เลยใช่ไหม?`)) return;
  const btn = document.getElementById('btn-send-monthly-report');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังส่ง...'; }
  try {
    const data = await API.sendMonthlyReport(selectedMonth);
    alert('✅ ' + (data.message || 'ส่งสำเร็จ'));
  } catch (e) {
    alert('❌ เกิดข้อผิดพลาด: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-calendar-check"></i> ส่ง Monthly'; }
  }
}

window.loadLineSettings          = loadLineSettings;
window.saveLineSettings          = saveLineSettings;
window.testLineBot               = testLineBot;
window.sendLineReport            = sendLineReport;
window.sendLineMonthlyReport     = sendLineMonthlyReport;
window.toggleLineTokenVisibility = toggleLineTokenVisibility;

let draggedId = null;

function handleDragStart(e) {
  draggedId = e.currentTarget.getAttribute('data-id');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedId);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

async function handleDrop(e) {
  e.preventDefault();
  const targetId = e.currentTarget.getAttribute('data-id');
  if (draggedId === targetId) return;

  const draggedCat = State.categories.find(c => c.id === draggedId);
  const targetCat = State.categories.find(c => c.id === targetId);
  if (!draggedCat || !targetCat || draggedCat.type !== targetCat.type) return;

  const typeCats = State.categories
    .filter(c => c.type === draggedCat.type)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, 'th'));

  const draggedIndex = typeCats.findIndex(c => c.id === draggedId);
  const targetIndex = typeCats.findIndex(c => c.id === targetId);

  typeCats.splice(draggedIndex, 1);
  typeCats.splice(targetIndex, 0, draggedCat);

  showLoader();
  try {
    for (let i = 0; i < typeCats.length; i++) {
      typeCats[i].sortOrder = i + 1;
      await API.updateCategory(typeCats[i].id, {
        name: typeCats[i].name,
        sortOrder: typeCats[i].sortOrder
      });
    }
    await reloadAppData();
  } catch (err) {
    alert('อัปเดตลำดับหมวดหมู่ล้มเหลว: ' + err.message);
  } finally {
    hideLoader();
  }
}

window.handleDragStart = handleDragStart;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;

function checkDailyAlert() {
  const token = localStorage.getItem('swt_session_token');
  if (!token) return;

  const todayStr = new Date().toLocaleDateString('sv-SE');
  const lastAlertDate = localStorage.getItem('swt_last_alert_date');

  if (lastAlertDate === todayStr) {
    return;
  }

  const sevenDaysLater = new Date();
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  const sevenDaysLaterStr = sevenDaysLater.toLocaleDateString('sv-SE');

  const txList = Array.isArray(State.transactions) ? State.transactions : [];
  
  const overdueList = txList.filter(t => t.type === 'future' && t.status !== 'paid' && (t.dueDate || t.date) < todayStr);
  const upcomingList = txList.filter(t => t.type === 'future' && t.status !== 'paid' && (t.dueDate || t.date) >= todayStr && (t.dueDate || t.date) <= sevenDaysLaterStr);

  if (overdueList.length === 0 && upcomingList.length === 0) {
    localStorage.setItem('swt_last_alert_date', todayStr);
    return;
  }

  const overdueContainer = document.getElementById('daily-alert-overdue-list');
  const upcomingContainer = document.getElementById('daily-alert-upcoming-list');
  
  overdueContainer.innerHTML = '';
  upcomingContainer.innerHTML = '';

  if (overdueList.length > 0) {
    document.getElementById('daily-alert-overdue-section').style.display = 'block';
    overdueList.forEach(t => {
      const acc = State.accounts.find(a => a.id === t.accountId);
      overdueContainer.innerHTML += `
        <div class="future-detail-item" style="border-left: 4px solid var(--rose);">
          <div class="future-detail-left">
            <span class="future-detail-date text-rose"><i class="fa-solid fa-calendar-xmark"></i> ${formatDateThShort(t.dueDate || t.date)} (เกินกำหนด)</span>
            <span class="future-detail-title">${t.notes || t.category}</span>
          </div>
          <div class="future-detail-right">
            <span class="future-detail-amount">-${formatCurrency(t.amount)}</span>
            <span class="future-detail-acc">${acc ? acc.name : 'ไม่ระบุ'}</span>
          </div>
        </div>`;
    });
  } else {
    document.getElementById('daily-alert-overdue-section').style.display = 'none';
  }

  if (upcomingList.length > 0) {
    document.getElementById('daily-alert-upcoming-section').style.display = 'block';
    upcomingList.forEach(t => {
      const acc = State.accounts.find(a => a.id === t.accountId);
      upcomingContainer.innerHTML += `
        <div class="future-detail-item" style="border-left: 4px solid var(--amber);">
          <div class="future-detail-left">
            <span class="future-detail-date text-amber-hover"><i class="fa-solid fa-clock"></i> ${formatDateThShort(t.dueDate || t.date)}</span>
            <span class="future-detail-title">${t.notes || t.category}</span>
          </div>
          <div class="future-detail-right">
            <span class="future-detail-amount">-${formatCurrency(t.amount)}</span>
            <span class="future-detail-acc">${acc ? acc.name : 'ไม่ระบุ'}</span>
          </div>
        </div>`;
    });
  } else {
    document.getElementById('daily-alert-upcoming-section').style.display = 'none';
  }

  const dailyAlertModal = document.getElementById('modal-daily-alert');
  if (dailyAlertModal) {
    dailyAlertModal.classList.add('active');
    document.body.classList.add('modal-open');
  }

  localStorage.setItem('swt_last_alert_date', todayStr);
}

function closeDailyAlertModal() {
  document.getElementById('modal-daily-alert').classList.remove('active');
  document.body.classList.remove('modal-open');
}

window.checkDailyAlert = checkDailyAlert;
window.closeDailyAlertModal = closeDailyAlertModal;

// Export POS & Delivery Modal functions to global window object
window.openPOSIncomeModal = openPOSIncomeModal;
window.closePOSIncomeModal = closePOSIncomeModal;
window.openDeliveryIncomeModal = openDeliveryIncomeModal;
window.closeDeliveryIncomeModal = closeDeliveryIncomeModal;
window.calculatePOSTotal = calculatePOSTotal;
window.updateDeliveryValidation = updateDeliveryValidation;

// ─── POS MACHINE MANAGEMENT ─────────────────────────────────────────

function getPOSMachines() {
  if (!State.posMachines || State.posMachines.length === 0) {
    const saved = localStorage.getItem('swt_pos_machines');
    if (saved) {
      try { State.posMachines = JSON.parse(saved); } catch (e) {}
    }
  }
  if (!State.posMachines || State.posMachines.length === 0) {
    State.posMachines = [
      { id: 'pos-1', name: 'POS 1', cashier: 'สมชาย' },
      { id: 'pos-2', name: 'POS 2', cashier: 'สมหญิง' },
      { id: 'pos-3', name: 'POS 3', cashier: 'พนักงาน A' }
    ];
    savePOSMachines();
  }
  return State.posMachines;
}

function savePOSMachines() {
  localStorage.setItem('swt_pos_machines', JSON.stringify(State.posMachines));
}

function populatePOSMachineDropdowns() {
  const machines = getPOSMachines();
  const select = document.getElementById('pos-machine');
  if (select) {
    select.innerHTML = machines.map(m => 
      `<option value="${m.name}">${m.name} (พนักงาน: ${m.cashier})</option>`
    ).join('');
  }

  const reportFilterSelect = document.getElementById('report-pos-filter-machine');
  if (reportFilterSelect) {
    const currentVal = reportFilterSelect.value;
    reportFilterSelect.innerHTML = `<option value="all">แสดงทุกเครื่อง (All Machines)</option>` + 
      machines.map(m => `<option value="${m.name}">${m.name} (${m.cashier})</option>`).join('');
    if (currentVal) reportFilterSelect.value = currentVal;
  }
}

function openManagePOSModal() {
  renderPOSMachinesList();
  document.getElementById('modal-manage-pos').classList.add('active');
  document.body.classList.add('modal-open');
}

function closeManagePOSModal() {
  document.getElementById('modal-manage-pos').classList.remove('active');
  document.body.classList.remove('modal-open');
  populatePOSMachineDropdowns();
  refreshPOSReport();
}

function renderPOSMachinesList() {
  const container = document.getElementById('pos-machines-list-container');
  if (!container) return;
  const machines = getPOSMachines();
  if (machines.length === 0) {
    container.innerHTML = '<p class="text-slate text-center py-4">ยังไม่มีเครื่อง POS ในระบบ</p>';
    return;
  }
  container.innerHTML = machines.map(m => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: #ffffff; border: 1px solid var(--border-color); border-radius: var(--radius-md);">
      <div>
        <strong style="color: var(--text-main); font-size: 0.95rem;">${m.name}</strong>
        <span style="font-size: 0.82rem; color: var(--text-muted); display: block;"><i class="fa-solid fa-user text-emerald"></i> พนักงานประจำเครื่อง: <strong>${m.cashier}</strong></span>
      </div>
      <button type="button" class="btn btn-xs btn-outline" style="color: var(--rose); border-color: rgba(239, 68, 68, 0.3);" onclick="deletePOSMachine('${m.id}')" title="ลบเครื่องนี้"><i class="fa-solid fa-trash"></i> ลบ</button>
    </div>
  `).join('');
}

function handleAddPOSMachine(e) {
  e.preventDefault();
  const nameInput = document.getElementById('new-pos-name');
  const cashierInput = document.getElementById('new-pos-cashier');
  const name = nameInput ? nameInput.value.trim() : '';
  const cashier = cashierInput ? cashierInput.value.trim() : '';
  if (!name || !cashier) return;

  const newMachine = {
    id: 'pos-' + Date.now(),
    name,
    cashier
  };

  getPOSMachines().push(newMachine);
  savePOSMachines();
  if (nameInput) nameInput.value = '';
  if (cashierInput) cashierInput.value = '';
  renderPOSMachinesList();
  populatePOSMachineDropdowns();
}

function deletePOSMachine(id) {
  if (!confirm('ยืนยันลบเครื่อง POS นี้?')) return;
  State.posMachines = getPOSMachines().filter(m => m.id !== id);
  savePOSMachines();
  renderPOSMachinesList();
  populatePOSMachineDropdowns();
}

window.openManagePOSModal = openManagePOSModal;
window.closeManagePOSModal = closeManagePOSModal;
window.deletePOSMachine = deletePOSMachine;

// ─── POS & DELIVERY INCOME HANDLERS ─────────────────────────────────────────

function updatePOSShiftAuto() {
  const machineEl = document.getElementById('pos-machine');
  const dateEl = document.getElementById('pos-date');
  const shiftEl = document.getElementById('pos-shift');
  if (!machineEl || !dateEl || !shiftEl) return;

  const machineName = machineEl.value || 'POS 1';
  const selDate = dateEl.value || new Date().toLocaleDateString('sv-SE');

  const existingEntries = (Array.isArray(State.transactions) ? State.transactions : []).filter(t => 
    t.date === selDate &&
    (t.subType === 'pos' || (t.category && t.category.includes('POS'))) &&
    (t.posMachine === machineName || (t.notes && t.notes.includes(machineName)))
  );

  shiftEl.value = `รอบที่ ${existingEntries.length + 1}`;
}

function openPOSIncomeModal(t = null) {
  document.getElementById('pos-income-form').reset();
  populatePOSMachineDropdowns();

  const editIdEl = document.getElementById('edit-pos-id');
  const submitBtn = document.getElementById('btn-submit-pos');
  const titleEl = document.getElementById('pos-modal-title');

  if (t) {
    if (editIdEl) editIdEl.value = t.id;
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square text-emerald"></i> แก้ไขบันทึกรายรับปิดกะ POS';

    const dateEl = document.getElementById('pos-date');
    const timeEl = document.getElementById('pos-time');
    if (dateEl) dateEl.value = t.date || new Date().toLocaleDateString('sv-SE');
    if (timeEl) timeEl.value = t.posTime || t.pos_time || '00:00';

    const machineEl = document.getElementById('pos-machine');
    if (machineEl) machineEl.value = t.posMachine || t.pos_machine || 'POS 1';

    const shiftEl = document.getElementById('pos-shift');
    if (shiftEl) shiftEl.value = t.posShift || t.pos_shift || 'รอบที่ 1';

    let cash = Number(t.cashAmount ?? t.cash_amount ?? 0);
    let transfer = Number(t.transferAmount ?? t.transfer_amount ?? 0);
    let coupon = Number(t.couponAmount ?? t.coupon_amount ?? 0);

    if (cash === 0 && transfer === 0 && coupon === 0 && Number(t.amount || 0) > 0) {
      const amt = Number(t.amount || 0);
      if (t.paymentMethod === 'Transfer' || (t.category && t.category.includes('โอน'))) {
        transfer = amt;
      } else if (t.paymentMethod === 'Coupon' || (t.category && t.category.includes('คูปอง'))) {
        coupon = amt;
      } else {
        cash = amt;
      }
    }

    document.getElementById('pos-cash-amount').value = cash;
    document.getElementById('pos-transfer-amount').value = transfer;
    document.getElementById('pos-coupon-amount').value = coupon;

    const rawNotes = t.notes || '';
    const cleanNotes = rawNotes.replace(/\[POS-.*?\]\s*/, '').replace(/\[POS \d+ \/ รอบที่ \d+ \/ POS-.*?\]\s*/, '').trim();
    document.getElementById('pos-notes').value = cleanNotes;
    calculatePOSTotal();

    if (submitBtn) submitBtn.innerText = 'บันทึกแก้ไข POS';
  } else {
    if (editIdEl) editIdEl.value = '';
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-cash-register text-emerald"></i> บันทึกรายรับปิดกะ POS';

    const now = new Date();
    const dateStr = now.toLocaleDateString('sv-SE');
    const timeStr = now.toTimeString().slice(0, 5);

    const dateEl = document.getElementById('pos-date');
    const timeEl = document.getElementById('pos-time');
    if (dateEl) dateEl.value = dateStr;
    if (timeEl) timeEl.value = timeStr;

    updatePOSShiftAuto();

    document.getElementById('pos-cash-amount').value = '0';
    document.getElementById('pos-transfer-amount').value = '0';
    document.getElementById('pos-coupon-amount').value = '0';
    document.getElementById('pos-notes').value = '';
    document.getElementById('pos-modal-total').innerText = formatCurrency(0);

    if (submitBtn) submitBtn.innerText = 'บันทึกรายรับ POS';
  }

  // Populate Accounts
  const cashAccounts = State.accounts.filter(a => a.type === 'cash' || a.name.includes('เงินสด'));
  const bankAccounts = State.accounts.filter(a => a.type === 'bank' || a.name.includes('ธนาคาร') || a.name.includes('โอน'));
  const couponAccounts = State.accounts.filter(a => a.type === 'coupon' || a.name.includes('คูปอง') || a.name.includes('ประชารัฐ') || a.name.includes('สวัสดิการ'));

  const cashSelect = document.getElementById('pos-cash-account');
  const transferSelect = document.getElementById('pos-transfer-account');
  const couponSelect = document.getElementById('pos-coupon-account');

  cashSelect.innerHTML = cashAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('') || '<option value="acc-cash">เงินสด</option>';
  transferSelect.innerHTML = bankAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('') || State.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  couponSelect.innerHTML = couponAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('') || State.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

  if (t) {
    if (t.cashAccountId && cashSelect) cashSelect.value = t.cashAccountId;
    if (t.transferAccountId && transferSelect) transferSelect.value = t.transferAccountId;
    if (t.couponAccountId && couponSelect) couponSelect.value = t.couponAccountId;
  }

  document.getElementById('modal-pos-income').classList.add('active');
  document.body.classList.add('modal-open');
}

function closePOSIncomeModal() {
  document.getElementById('modal-pos-income').classList.remove('active');
  document.body.classList.remove('modal-open');
}

function calculatePOSTotal() {
  const cash = Number(document.getElementById('pos-cash-amount').value || 0);
  const transfer = Number(document.getElementById('pos-transfer-amount').value || 0);
  const coupon = Number(document.getElementById('pos-coupon-amount').value || 0);
  const total = cash + transfer + coupon;
  document.getElementById('pos-modal-total').innerText = formatCurrency(total);
}

async function handlePOSIncomeSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('edit-pos-id')?.value || '';
  const date = document.getElementById('pos-date').value || new Date().toLocaleDateString('sv-SE');
  const posTime = document.getElementById('pos-time').value || '00:00';
  const posMachine = document.getElementById('pos-machine').value;
  const posShift = document.getElementById('pos-shift').value;
  const cashAmount = Number(document.getElementById('pos-cash-amount').value || 0);
  const cashAccountId = document.getElementById('pos-cash-account').value;
  const transferAmount = Number(document.getElementById('pos-transfer-amount').value || 0);
  const transferAccountId = document.getElementById('pos-transfer-account').value;
  const couponAmount = Number(document.getElementById('pos-coupon-amount').value || 0);
  const couponAccountId = document.getElementById('pos-coupon-account').value;
  const notes = document.getElementById('pos-notes').value || '';

  const netTotal = cashAmount + transferAmount + couponAmount;
  if (netTotal <= 0) {
    alert('กรุณากรอกยอดเงินอย่างน้อย 1 รายการ (เงินสด, เงินโอน หรือ คูปองประชารัฐ)');
    return;
  }

  const docCode = `POS-${date.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  const primaryAccId = cashAmount > 0 ? cashAccountId : (transferAmount > 0 ? transferAccountId : couponAccountId);

  const btnSubmit = document.getElementById('btn-submit-pos');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';

  try {
    const payload = {
      date,
      type: 'income',
      subType: 'pos',
      posMachine,
      posShift,
      posTime,
      documentCode: docCode,
      cashAmount,
      cashAccountId,
      transferAmount,
      transferAccountId,
      couponAmount,
      couponAccountId,
      category: `รายรับ POS (${posMachine})`,
      amount: netTotal,
      paymentMethod: 'Multiple',
      accountId: primaryAccId,
      notes: notes ? `[${posMachine} / ${posShift} / ${docCode}] ${notes}` : `[${posMachine} / ${posShift} / ${docCode}] รายรับปิดกะ POS`
    };

    if (editId) {
      await API.updateTransaction(editId, payload);
      alert(`บันทึกแก้ไขรายรับปิดกะ POS สำเร็จ!`);
    } else {
      await API.createTransaction(payload);
      alert(`บันทึกรายรับปิดกะ POS สำเร็จ!\nรหัสเอกสาร: ${docCode}`);
    }

    closePOSIncomeModal();
    await reloadAppData();
    viewDocumentSummary(editId || docCode);
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = editId ? 'บันทึกแก้ไข POS' : 'บันทึกรายรับ POS';
  }
}

function openDeliveryIncomeModal(t = null) {
  document.getElementById('delivery-income-form').reset();
  const bankAccounts = State.accounts.filter(a => a.type === 'bank' || a.name.includes('ธนาคาร') || a.name.includes('โอน'));
  const transferSelect = document.getElementById('delivery-transfer-account');
  if (transferSelect) {
    transferSelect.innerHTML = bankAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('') || State.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  }

  const editIdEl = document.getElementById('edit-delivery-id');
  const submitBtn = document.getElementById('btn-submit-delivery');
  const titleEl = document.getElementById('delivery-modal-title');

  if (t) {
    if (editIdEl) editIdEl.value = t.id;
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-pen-to-square text-indigo"></i> แก้ไขบันทึกรายรับ สายส่ง';

    document.getElementById('delivery-date').value = t.date || new Date().toLocaleDateString('sv-SE');
    document.getElementById('delivery-doc-number').value = t.documentNumber || t.document_number || (t.documentCode || t.document_code ? (t.documentCode || t.document_code).replace(/^DEL-/, '') : '');
    document.getElementById('delivery-customer-count').value = t.customerCount ?? t.customer_count ?? 1;
    document.getElementById('delivery-doc-total').value = t.documentTotalAmount ?? t.document_total_amount ?? t.amount ?? 0;

    let cash = Number(t.cashAmount ?? t.cash_amount ?? 0);
    let transfer = Number(t.transferAmount ?? t.transfer_amount ?? 0);

    if (cash === 0 && transfer === 0 && Number(t.amount || 0) > 0) {
      const amt = Number(t.amount || 0);
      if (t.paymentMethod === 'Transfer' || (t.category && t.category.includes('โอน'))) {
        transfer = amt;
      } else {
        cash = amt;
      }
    }

    document.getElementById('delivery-cash-amount').value = cash;
    document.getElementById('delivery-transfer-amount').value = transfer;
    if ((t.transferAccountId || t.transfer_account_id) && transferSelect) transferSelect.value = t.transferAccountId || t.transfer_account_id;
    document.getElementById('delivery-cn-amount').value = t.cnAmount ?? t.cn_amount ?? 0;

    const rawNotes = t.notes || '';
    const cleanNotes = rawNotes.replace(/\[สายส่ง:.*?\]\s*/, '').trim();
    document.getElementById('delivery-notes').value = cleanNotes;
    updateDeliveryValidation();

    if (submitBtn) submitBtn.innerText = 'บันทึกแก้ไข สายส่ง';
  } else {
    if (editIdEl) editIdEl.value = '';
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-truck-ramp-box text-indigo"></i> บันทึกรายรับ สายส่ง';

    document.getElementById('delivery-date').value = new Date().toLocaleDateString('sv-SE');
    document.getElementById('delivery-doc-number').value = '';
    document.getElementById('delivery-customer-count').value = '';
    document.getElementById('delivery-doc-total').value = '';
    document.getElementById('delivery-cash-amount').value = '0';
    document.getElementById('delivery-transfer-amount').value = '0';
    document.getElementById('delivery-cn-amount').value = '0';
    document.getElementById('delivery-notes').value = '';
    updateDeliveryValidation();

    if (submitBtn) submitBtn.innerText = 'บันทึกรายรับ สายส่ง';
  }

  document.getElementById('modal-delivery-income').classList.add('active');
  document.body.classList.add('modal-open');
}

function closeDeliveryIncomeModal() {
  document.getElementById('modal-delivery-income').classList.remove('active');
  document.body.classList.remove('modal-open');
}

function updateDeliveryValidation() {
  const docTotal = Number(document.getElementById('delivery-doc-total').value || 0);
  const cash = Number(document.getElementById('delivery-cash-amount').value || 0);
  const transfer = Number(document.getElementById('delivery-transfer-amount').value || 0);
  const cn = Number(document.getElementById('delivery-cn-amount').value || 0);

  const checkSum = cash + transfer + cn;
  const diff = checkSum - docTotal;

  document.getElementById('delivery-check-sum').innerText = formatCurrency(checkSum);
  document.getElementById('delivery-doc-sum-display').innerText = formatCurrency(docTotal);

  const alertBox = document.getElementById('delivery-cn-alert');
  const statusEl = document.getElementById('delivery-validation-status');

  if (Math.abs(diff) < 0.01) {
    alertBox.style.background = 'rgba(16, 185, 129, 0.08)';
    alertBox.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    statusEl.innerHTML = `<span style="color: var(--emerald);"><i class="fa-solid fa-circle-check"></i> ผลรวมตรงตามยอดเอกสารเรียบร้อย</span>`;
  } else {
    alertBox.style.background = 'rgba(244, 63, 94, 0.08)';
    alertBox.style.borderColor = 'rgba(244, 63, 94, 0.3)';
    const diffText = diff > 0 ? `เกินอยู่ +${formatCurrency(diff)}` : `ขาดอยู่ -${formatCurrency(Math.abs(diff))}`;
    statusEl.innerHTML = `<span style="color: var(--rose);"><i class="fa-solid fa-triangle-exclamation"></i> ผลรวมไม่เท่ากับยอดเอกสาร (${diffText}) แต่ยังคงสามารถบันทึกได้</span>`;
  }
}

async function handleDeliveryIncomeSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('edit-delivery-id')?.value || '';
  const date = document.getElementById('delivery-date').value;
  const docNumber = document.getElementById('delivery-doc-number').value.trim();
  const customerCount = Number(document.getElementById('delivery-customer-count').value || 0);
  const docTotal = Number(document.getElementById('delivery-doc-total').value || 0);
  const cashAmount = Number(document.getElementById('delivery-cash-amount').value || 0);
  const transferAmount = Number(document.getElementById('delivery-transfer-amount').value || 0);
  const transferAccountId = document.getElementById('delivery-transfer-account').value;
  const cnAmount = Number(document.getElementById('delivery-cn-amount').value || 0);
  const notes = document.getElementById('delivery-notes').value || '';

  const netReceived = cashAmount + transferAmount;
  const checkSum = netReceived + cnAmount;
  const diff = checkSum - docTotal;
  const hasDiscrepancy = Math.abs(diff) >= 0.01;

  if (hasDiscrepancy) {
    const confirmSave = confirm(`⚠️ ยอดรับชำระ (เงินสด+เงินโอน+CN = ${formatCurrency(checkSum)}) ไม่เท่ากับยอดเอกสาร (${formatCurrency(docTotal)})\nผลต่าง: ${diff > 0 ? '+' : ''}${formatCurrency(diff)} บาท\n\nคุณต้องการบันทึกรายการนี้พร้อมสัญลักษณ์เตือนใช่หรือไม่?`);
    if (!confirmSave) return;
  }

  const docCode = docNumber ? `DEL-${docNumber}` : `DEL-${date.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

  const cashAccObj = State.accounts.find(a => a.type === 'cash' || a.name.includes('เงินสด'));
  const primaryAccId = cashAmount > 0 ? (cashAccObj ? cashAccObj.id : 'acc-cash') : transferAccountId;

  const btnSubmit = document.getElementById('btn-submit-delivery');
  btnSubmit.disabled = true;
  btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';

  try {
    const payload = {
      date,
      type: 'income',
      subType: 'delivery',
      documentNumber: docNumber,
      documentCode: docCode,
      customerCount,
      documentTotalAmount: docTotal,
      cnAmount,
      cashAmount,
      transferAmount,
      transferAccountId,
      hasDiscrepancy,
      category: 'รายรับ สายส่ง',
      amount: netReceived,
      paymentMethod: 'Multiple',
      accountId: primaryAccId,
      notes: `[สายส่ง: ${docCode} | บิล ${customerCount} ราย | CN: ฿${cnAmount}] ${notes}`
    };

    if (editId) {
      await API.updateTransaction(editId, payload);
      alert(`บันทึกแก้ไขรายรับสายส่งสำเร็จ!`);
    } else {
      await API.createTransaction(payload);
      alert(`บันทึกรายรับสายส่งสำเร็จ!\nรหัสเอกสาร: ${docCode}`);
    }

    closeDeliveryIncomeModal();
    await reloadAppData();
    viewDocumentSummary(editId || docCode);
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.innerText = editId ? 'บันทึกแก้ไข สายส่ง' : 'บันทึกรายรับ สายส่ง';
  }
}

// ─── DIGITAL DOCUMENT SUMMARY VOUCHER HANDLERS ────────────────────────────────

function viewDocumentSummary(docCode) {
  if (!docCode) return;
  const cleanCode = String(docCode).trim();
  const tx = (Array.isArray(State.transactions) ? State.transactions : []).find(t => 
    (t.id && String(t.id).trim() === cleanCode) ||
    (t.documentCode && String(t.documentCode).trim() === cleanCode) ||
    (t.documentNumber && (String(t.documentNumber).trim() === cleanCode || `DEL-${String(t.documentNumber).trim()}` === cleanCode || cleanCode === `DEL-${String(t.documentNumber).trim()}`)) ||
    (t.notes && String(t.notes).includes(cleanCode))
  );

  const container = document.getElementById('document-voucher-content');
  if (!container) return;

  if (!tx) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate">
        <i class="fa-solid fa-triangle-exclamation text-3xl mb-2 text-rose"></i>
        <p>ไม่พบข้อมูลใบเอกสารสรุปในระบบ (${docCode})</p>
      </div>`;
    openDocumentModal();
    return;
  }

  const isPos = tx.subType === 'pos' || (tx.category && tx.category.includes('POS'));
  const isDelivery = tx.subType === 'delivery' || (tx.category && tx.category.includes('สายส่ง'));

  let cashAmt = Number(tx.cashAmount ?? tx.cash_amount ?? 0);
  let transferAmt = Number(tx.transferAmount ?? tx.transfer_amount ?? 0);
  let couponAmt = Number(tx.couponAmount ?? tx.coupon_amount ?? 0);

  if (cashAmt === 0 && transferAmt === 0 && couponAmt === 0 && Number(tx.amount || 0) > 0) {
    const totalAmt = Number(tx.amount || 0);
    if (tx.paymentMethod === 'Transfer' || (tx.category && tx.category.includes('โอน'))) {
      transferAmt = totalAmt;
    } else if (tx.paymentMethod === 'Coupon' || (tx.category && tx.category.includes('คูปอง'))) {
      couponAmt = totalAmt;
    } else {
      cashAmt = totalAmt;
    }
  }

  const mainAcc = State.accounts.find(a => a.id === (tx.accountId || tx.account_id));
  const cashAcc = State.accounts.find(a => a.id === (tx.cashAccountId || tx.cash_account_id || tx.accountId || tx.account_id));
  const transferAcc = State.accounts.find(a => a.id === (tx.transferAccountId || tx.transfer_account_id || tx.accountId || tx.account_id));
  const couponAcc = State.accounts.find(a => a.id === (tx.couponAccountId || tx.coupon_account_id || tx.accountId || tx.account_id));

  const mainAccName = mainAcc ? mainAcc.name : '-';
  const cashAccName = cashAcc ? cashAcc.name : 'เงินสด';
  const transferAccName = transferAcc ? transferAcc.name : '-';
  const couponAccName = couponAcc ? couponAcc.name : '-';

  const netTotal = Number(tx.amount || (cashAmt + transferAmt + couponAmt));
  
  let docTitle = `ใบสรุปธุรกรรมการเงิน (${tx.category})`;
  if (isPos) {
    docTitle = `ใบสรุปการปิดกะ POS (${tx.posMachine || 'POS 1'})`;
  } else if (isDelivery) {
    docTitle = `ใบเอกสารสรุปรายรับ สายส่ง (เลขที่ ${tx.documentNumber || tx.documentCode || docCode})`;
  }

  let detailsHtml = '';
  if (isPos) {
    const machineObj = getPOSMachines().find(m => m.name === tx.posMachine);
    const cashierName = machineObj ? machineObj.cashier : 'ไม่ระบุพนักงาน';

    detailsHtml = `
      <div style="background: var(--bg-app); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.25rem;">
        <h4 style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--primary);"><i class="fa-solid fa-circle-info"></i> ข้อมูลหลักการปิดกะ POS</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.65rem; font-size: 0.9rem;">
          <div><span class="text-slate">รหัสเอกสาร:</span> <strong style="font-family: var(--font-mono);">${tx.documentCode || docCode}</strong></div>
          <div><span class="text-slate">เครื่อง POS:</span> <strong>${tx.posMachine || 'POS 1'}</strong></div>
          <div><span class="text-slate">พนักงานประจำเครื่อง:</span> <strong class="text-emerald">${cashierName}</strong></div>
          <div><span class="text-slate">รอบเวลา / รอบกะ:</span> <strong style="color: var(--primary);">${tx.posShift || 'รอบที่ 1'}</strong></div>
          <div><span class="text-slate">วันที่บันทึก:</span> <strong>${tx.date}</strong></div>
          <div><span class="text-slate">เวลาปิดกะ:</span> <strong>${tx.posTime ? `${tx.posTime} น.` : (tx.posDatetime ? tx.posDatetime.slice(11,16) : '-')}</strong></div>
        </div>
      </div>`;
  } else if (isDelivery) {
    const docTotal = Number(tx.documentTotalAmount || 0);
    const cnAmt = Number(tx.cnAmount || 0);
    const expected = docTotal - cnAmt;
    const diff = (cashAmt + transferAmt) - expected;
    const hasDiscrepancy = Boolean(tx.hasDiscrepancy || Math.abs(diff) >= 0.01);

    detailsHtml = `
      <div style="background: var(--bg-app); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.25rem;">
        <h4 style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--primary);"><i class="fa-solid fa-circle-info"></i> ข้อมูลหลักเอกสารสายส่ง</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.65rem; font-size: 0.9rem;">
          <div><span class="text-slate">รหัสเอกสาร:</span> <strong style="font-family: var(--font-mono);">${tx.documentCode || docCode}</strong></div>
          <div><span class="text-slate">เลขที่เอกสารส่งของ:</span> <strong>${tx.documentNumber || docCode}</strong></div>
          <div><span class="text-slate">วันที่ทำรายการ:</span> <strong>${tx.date}</strong></div>
          <div><span class="text-slate">จำนวนบิล / ลูกค้า:</span> <strong>${tx.customerCount || 0} ราย</strong></div>
          <div><span class="text-slate">ยอดรวมตามเอกสาร:</span> <strong>${formatCurrency(docTotal)}</strong></div>
          <div><span class="text-slate">ยอดส่วนลด CN:</span> <strong class="text-rose">- ${formatCurrency(cnAmt)}</strong></div>
        </div>
        ${hasDiscrepancy ? `
          <div style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: rgba(244,63,94,0.1); border-radius: var(--radius-sm); color: var(--rose); font-size: 0.85rem; font-weight: 700;">
            ⚠️ ยอดรับชำระไม่ตรงตามเอกสาร (ผลต่าง: ${diff > 0 ? '+' : ''}${formatCurrency(diff)})
          </div>
        ` : ''}
      </div>`;
  } else {
    detailsHtml = `
      <div style="background: var(--bg-app); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1.25rem; margin-bottom: 1.25rem;">
        <h4 style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--primary);"><i class="fa-solid fa-circle-info"></i> ข้อมูลหลักธุรกรรมการเงิน</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.65rem; font-size: 0.9rem;">
          <div><span class="text-slate">รหัสเอกสาร:</span> <strong style="font-family: var(--font-mono);">${tx.id}</strong></div>
          <div><span class="text-slate">ประเภท:</span> <strong>${tx.type === 'income' ? 'รายรับ' : (tx.type === 'expense' ? 'รายจ่าย' : (tx.type === 'future' ? 'รายจ่ายล่วงหน้า' : 'ย้ายเงิน'))}</strong></div>
          <div><span class="text-slate">หมวดหมู่:</span> <strong style="color: var(--primary);">${tx.category}</strong></div>
          <div><span class="text-slate">วันที่ทำรายการ:</span> <strong>${tx.date}</strong></div>
          <div><span class="text-slate">บัญชีการเงิน:</span> <strong>${mainAccName}</strong></div>
        </div>
      </div>`;
  }

  let paymentBreakdownHtml = '';
  if (isPos) {
    paymentBreakdownHtml = `
      <h4 style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--text-main);"><i class="fa-solid fa-list-check text-emerald"></i> รายละเอียดแจกแจงยอดเงินชำระ</h4>
      <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.92rem; margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; background: var(--bg-app); border-radius: var(--radius-sm);">
          <span><i class="fa-solid fa-money-bill-wave text-emerald mr-1"></i> เงินสด (เข้าบัญชี: <strong>${cashAccName}</strong>)</span>
          <strong class="text-emerald">${formatCurrency(cashAmt)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; background: var(--bg-app); border-radius: var(--radius-sm);">
          <span><i class="fa-solid fa-building-columns text-primary mr-1"></i> เงินโอน (เข้าบัญชี: <strong>${transferAccName}</strong>)</span>
          <strong class="text-primary">${formatCurrency(transferAmt)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; background: var(--bg-app); border-radius: var(--radius-sm);">
          <span><i class="fa-solid fa-id-card text-sky mr-1"></i> คูปองประชารัฐ (เข้าบัญชี: <strong>${couponAccName}</strong>)</span>
          <strong style="color: #0284c7;">${formatCurrency(couponAmt)}</strong>
        </div>
      </div>`;
  } else if (isDelivery) {
    paymentBreakdownHtml = `
      <h4 style="font-weight: 700; font-size: 0.95rem; margin-bottom: 0.75rem; color: var(--text-main);"><i class="fa-solid fa-list-check text-emerald"></i> รายละเอียดแจกแจงยอดเงินชำระสายส่ง</h4>
      <div style="display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.92rem; margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; background: var(--bg-app); border-radius: var(--radius-sm);">
          <span><i class="fa-solid fa-money-bill-wave text-emerald mr-1"></i> เงินสด</span>
          <strong class="text-emerald">${formatCurrency(cashAmt)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0.75rem; background: var(--bg-app); border-radius: var(--radius-sm);">
          <span><i class="fa-solid fa-building-columns text-primary mr-1"></i> เงินโอน (เข้าบัญชี: <strong>${transferAccName}</strong>)</span>
          <strong class="text-primary">${formatCurrency(transferAmt)}</strong>
        </div>
      </div>`;
  }

  const rawNotes = tx.notes || '';
  const cleanNotes = rawNotes.replace(/\[POS-.*?\]\s*/, '').replace(/\[POS \d+ \/ รอบที่ \d+ \/ POS-.*?\]\s*/, '').replace(/\[สายส่ง:.*?\]\s*/, '').trim();

  container.innerHTML = `
    <div style="text-align: center; border-bottom: 2px dashed var(--border-color); padding-bottom: 1rem; margin-bottom: 1.25rem;">
      <h3 style="font-weight: 800; font-size: 1.35rem; color: var(--primary);"><i class="fa-solid fa-store"></i> ร้านเทพบัวทอง</h3>
      <p style="font-size: 0.88rem; color: var(--text-muted); margin-top: 0.2rem;">${docTitle}</p>
      <div style="display: inline-block; background: rgba(79,70,229,0.1); color: var(--primary); font-weight: 700; padding: 0.25rem 0.85rem; border-radius: 999px; font-size: 0.82rem; margin-top: 0.5rem;">
        รหัสเอกสาร: ${tx.documentCode || tx.documentNumber || docCode}
      </div>
    </div>

    ${detailsHtml}
    ${paymentBreakdownHtml}

    ${cleanNotes ? `
      <div style="margin-bottom: 1.25rem; padding: 0.85rem 1rem; background: var(--bg-app); border-radius: var(--radius-sm); font-size: 0.88rem; border-left: 3px solid var(--primary);">
        <strong>หมายเหตุเพิ่มเติม:</strong> ${cleanNotes}
      </div>
    ` : ''}

    ${tx.slipUrl ? `
      <div style="margin-bottom: 1.25rem; text-align: center;">
        <button class="btn btn-outline btn-sm" onclick="previewAttachment('${tx.slipUrl}')"><i class="fa-solid fa-paperclip text-indigo"></i> ดูไฟล์แนบเอกสาร (สลิป/บิล)</button>
      </div>
    ` : ''}

    <!-- Grand Total Box -->
    <div style="background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; border-radius: var(--radius-md); padding: 1.25rem; text-align: center; box-shadow: var(--shadow-sm);">
      <span style="font-size: 0.85rem; opacity: 0.9;">กล่องแสดงยอดเงินรับสุทธิรวมทั้งสิ้น (Grand Total)</span>
      <h2 style="font-size: 1.75rem; font-weight: 800; margin-top: 0.25rem; color: #ffffff;">${formatCurrency(netTotal)}</h2>
    </div>
  `;

  openDocumentModal();
}

function openDocumentModal() {
  const modal = document.getElementById('modal-view-document');
  if (modal) {
    modal.classList.add('active');
    document.body.classList.add('modal-open');
  }
}

function closeDocumentModal() {
  const modal = document.getElementById('modal-view-document');
  if (modal) {
    modal.classList.remove('active');
    document.body.classList.remove('modal-open');
  }
}

window.viewDocumentSummary = viewDocumentSummary;
window.openDocumentModal = openDocumentModal;
window.closeDocumentModal = closeDocumentModal;

// ─── POS SHIFT REPORT RENDERING ──────────────────────────────────────────────

function refreshPOSReport() {
  const container = document.getElementById('pos-report-summary-container');
  if (!container) return;

  const dateInput = document.getElementById('report-pos-date');
  const reportDate = dateInput?.value || '';
  const machineFilter = document.getElementById('report-pos-filter-machine')?.value || 'all';

  // Filter POS transactions
  const allTxs = Array.isArray(State.transactions) ? State.transactions : [];
  let posTxs = allTxs.filter(t => 
    t.subType === 'pos' || 
    (t.category && t.category.includes('POS')) ||
    (t.documentCode && String(t.documentCode).startsWith('POS-'))
  );

  if (reportDate) {
    posTxs = posTxs.filter(t => t.date === reportDate);
  }

  const posMachines = getPOSMachines();
  const machineNames = posMachines.map(m => m.name);
  const displayMachines = machineFilter === 'all' ? machineNames : [machineFilter];

  let grandCash = 0;
  let grandTransfer = 0;
  let grandCoupon = 0;
  let grandTotal = 0;

  let html = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem;">`;

  displayMachines.forEach(mName => {
    const machineObj = posMachines.find(m => m.name === mName);
    const cashierName = machineObj ? machineObj.cashier : 'ไม่ระบุพนักงาน';
    const mTxs = posTxs.filter(t => t.posMachine === mName || (t.category && t.category.includes(mName)));
    let cash = 0;
    let transfer = 0;
    let coupon = 0;

    mTxs.forEach(t => {
      if (t.cashAmount !== undefined || t.transferAmount !== undefined || t.couponAmount !== undefined) {
        cash += Number(t.cashAmount || 0);
        transfer += Number(t.transferAmount || 0);
        coupon += Number(t.couponAmount || 0);
      } else {
        const amt = Number(t.amount || 0);
        if (t.category.includes('คูปอง') || (t.notes && t.notes.includes('คูปอง'))) {
          coupon += amt;
        } else if (t.paymentMethod === 'Cash' || (t.category && t.category.includes('เงินสด'))) {
          cash += amt;
        } else {
          transfer += amt;
        }
      }
    });

    const mTotal = cash + transfer + coupon;

    grandCash += cash;
    grandTransfer += transfer;
    grandCoupon += coupon;
    grandTotal += mTotal;

    html += `
      <div style="background: #ffffff; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 1.25rem; box-shadow: var(--shadow-sm);">
        <div style="border-bottom: 2px solid var(--primary-light); padding-bottom: 0.75rem; margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <h4 style="font-weight: 800; font-size: 1.15rem; color: var(--text-main);"><i class="fa-solid fa-cash-register text-emerald"></i> ${mName}</h4>
            <span class="badge badge-emerald" style="font-weight: 700;">${mTxs.length} รายการปิดกะ</span>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.25rem;">
            <i class="fa-solid fa-user text-slate"></i> พนักงานประจำเครื่อง: <strong style="color: var(--text-main);">${cashierName}</strong>
          </div>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 0.55rem; font-size: 0.95rem;">
          <div style="display: flex; justify-content: space-between;">
            <span class="text-slate">เงินสด:</span>
            <span style="font-weight: 700; color: var(--emerald);">${formatCurrency(cash)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="text-slate">เงินโอน:</span>
            <span style="font-weight: 700; color: var(--primary);">${formatCurrency(transfer)}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span class="text-slate">คูปองประชารัฐ:</span>
            <span style="font-weight: 700; color: #0284c7;">${formatCurrency(coupon)}</span>
          </div>
          <div style="border-top: 1px dashed var(--border-color); padding-top: 0.65rem; margin-top: 0.3rem; display: flex; justify-content: space-between; font-weight: 800; font-size: 1.05rem;">
            <span>รวม ${mName}:</span>
            <span style="color: var(--text-main);">${formatCurrency(mTotal)}</span>
          </div>
        </div>
      </div>`;
  });

  html += `</div>`;

  // Grand Total Summary Box
  html += `
    <div style="margin-top: 1.5rem; background: linear-gradient(135deg, #0f172a, #1e293b); color: #ffffff; border-radius: var(--radius-md); padding: 1.5rem; box-shadow: var(--shadow-md);">
      <div style="border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 0.75rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-weight: 800; font-size: 1.2rem; color: #ffffff;"><i class="fa-solid fa-calculator text-emerald"></i> สรุปรวมสุทธิ${machineFilter !== 'all' ? ` (${machineFilter})` : 'ทุกเครื่อง'} ${reportDate ? `ประจำวันที่ ${formatDateThShort(reportDate)}` : '(ทุกวันที่ในระบบ)'}</h3>
        <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 0.25rem 0.75rem; border-radius: 999px; font-weight: 700; font-size: 0.85rem;">Grand Total</span>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1.25rem; margin-bottom: 1rem;">
        <div>
          <span style="font-size: 0.82rem; color: #94a3b8; display: block;">เงินสดรวมสุทธิ</span>
          <span style="font-weight: 700; font-size: 1.15rem; color: #34d399;">${formatCurrency(grandCash)}</span>
        </div>
        <div>
          <span style="font-size: 0.82rem; color: #94a3b8; display: block;">เงินโอนรวมสุทธิ</span>
          <span style="font-weight: 700; font-size: 1.15rem; color: #818cf8;">${formatCurrency(grandTransfer)}</span>
        </div>
        <div>
          <span style="font-size: 0.82rem; color: #94a3b8; display: block;">คูปองประชารัฐรวมสุทธิ</span>
          <span style="font-weight: 700; font-size: 1.15rem; color: #38bdf8;">${formatCurrency(grandCoupon)}</span>
        </div>
      </div>

      <div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 1rem; display: flex; justify-content: space-between; align-items: center; font-size: 1.25rem; font-weight: 800;">
        <span style="color: #f8fafc;">รวมรายรับทั้งสิ้น:</span>
        <span style="color: #34d399; font-size: 1.4rem;">${formatCurrency(grandTotal)} บาท</span>
      </div>
    </div>`;

  container.innerHTML = html;
}

// ─── DELIVERY ROUTE REPORT RENDERING ──────────────────────────────────────────

function refreshDeliveryReport() {
  const container = document.getElementById('delivery-report-summary-container');
  if (!container) return;

  const dateInput = document.getElementById('report-delivery-date');
  const reportDate = dateInput?.value || '';

  // Filter Delivery transactions
  const allTxs = Array.isArray(State.transactions) ? State.transactions : [];
  let delTxs = allTxs.filter(t => 
    t.subType === 'delivery' || 
    (t.category && t.category.includes('สายส่ง')) ||
    (t.notes && t.notes.includes('สายส่ง')) ||
    (t.documentCode && String(t.documentCode).startsWith('DEL-'))
  );

  if (reportDate) {
    delTxs = delTxs.filter(t => t.date === reportDate);
  }

  if (delTxs.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate">
        <i class="fa-solid fa-truck-ramp-box text-3xl mb-2 text-slate-400"></i>
        <p>ยังไม่มีข้อมูลบันทึกรายรับสายส่ง ${reportDate ? `ประจำวันที่ ${formatDateThShort(reportDate)}` : 'ในระบบ'}</p>
        ${reportDate ? `<button class="btn btn-xs btn-outline mt-2" onclick="document.getElementById('report-delivery-date').value=''; refreshDeliveryReport();">ดูข้อมูลสายส่งทั้งหมด</button>` : ''}
      </div>`;
    return;
  }

  // Group by Document Number
  const docGroups = {};
  delTxs.forEach(t => {
    const docKey = t.documentNumber || t.documentCode || t.id;
    if (!docGroups[docKey]) docGroups[docKey] = [];
    docGroups[docKey].push(t);
  });

  let grandDocTotal = 0;
  let grandCash = 0;
  let grandTransfer = 0;
  let grandCN = 0;
  let grandNet = 0;
  let totalBills = 0;

  let tableRows = '';

  Object.keys(docGroups).forEach(docKey => {
    const txs = docGroups[docKey];
    const sample = txs[0];
    const docTotal = Number(sample.documentTotalAmount || 0);
    const bills = Number(sample.customerCount || 0);
    const cn = Number(sample.cnAmount || 0);

    let cash = 0;
    let transfer = 0;
    txs.forEach(t => {
      if (t.cashAmount !== undefined || t.transferAmount !== undefined) {
        cash += Number(t.cashAmount || 0);
        transfer += Number(t.transferAmount || 0);
      } else {
        const amt = Number(t.amount || 0);
        if (t.paymentMethod === 'Cash' || (t.category && t.category.includes('เงินสด'))) {
          cash += amt;
        } else {
          transfer += amt;
        }
      }
    });

    const net = Number(sample.amount || (cash + transfer));
    const expected = docTotal - cn;
    const diff = (cash + transfer) - expected;
    const hasDiscrepancy = Boolean(sample.hasDiscrepancy || Math.abs(diff) >= 0.01);

    grandDocTotal += docTotal;
    totalBills += bills;
    grandCash += cash;
    grandTransfer += transfer;
    grandCN += cn;
    grandNet += net;

    tableRows += `
      <tr>
        <td style="font-weight: 700; color: var(--primary);">${sample.date}</td>
        <td><strong>${docKey}</strong></td>
        <td class="text-center">${bills} บิล</td>
        <td class="text-right">${formatCurrency(docTotal)}</td>
        <td class="text-right text-emerald">${formatCurrency(cash)}</td>
        <td class="text-right text-indigo">${formatCurrency(transfer)}</td>
        <td class="text-right text-rose">${formatCurrency(cn)}</td>
        <td class="text-right" style="font-weight: 800; color: var(--emerald);">${formatCurrency(net)}</td>
        <td class="text-center">
          ${hasDiscrepancy 
            ? `<span class="badge badge-rose" style="font-size: 0.75rem;"><i class="fa-solid fa-triangle-exclamation"></i> ยอดไม่ตรง (${diff > 0 ? '+' : ''}${formatCurrency(diff)})</span>`
            : `<span class="badge badge-emerald" style="font-size: 0.75rem;"><i class="fa-solid fa-check"></i> ตรงตามเอกสาร</span>`
          }
        </td>
      </tr>`;
  });

  const html = `
    <div class="table-container scrollbar">
      <table class="premium-table compact">
        <thead>
          <tr>
            <th>วันที่</th>
            <th>เลขที่เอกสาร</th>
            <th class="text-center">จำนวนบิล</th>
            <th class="text-right">ยอดตามเอกสาร</th>
            <th class="text-right">เงินสด</th>
            <th class="text-right">เงินโอน</th>
            <th class="text-right">ยอด CN</th>
            <th class="text-right">รายรับสุทธิ</th>
            <th class="text-center">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <!-- Delivery Summary Box -->
    <div style="margin-top: 1.5rem; background: linear-gradient(135deg, #1e1b4b, #312e81); color: #ffffff; border-radius: var(--radius-md); padding: 1.5rem; box-shadow: var(--shadow-md);">
      <div style="border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 0.75rem; margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-weight: 800; font-size: 1.2rem; color: #ffffff;"><i class="fa-solid fa-truck-ramp-box text-indigo"></i> สรุปรวมรายรับสายส่งทั้งหมด ${reportDate ? `ประจำวันที่ ${formatDateThShort(reportDate)}` : '(ทุกวันที่ในระบบ)'}</h3>
        <span style="background: rgba(99, 102, 241, 0.25); color: #a5b4fc; padding: 0.25rem 0.75rem; border-radius: 999px; font-weight: 700; font-size: 0.85rem;">Delivery Summary</span>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
        <div>
          <span style="font-size: 0.82rem; color: #c7d2fe; display: block;">จำนวนบิลรวม</span>
          <span style="font-weight: 700; font-size: 1.1rem; color: #ffffff;">${totalBills} ราย</span>
        </div>
        <div>
          <span style="font-size: 0.82rem; color: #c7d2fe; display: block;">ยอดรวมตามเอกสาร</span>
          <span style="font-weight: 700; font-size: 1.1rem; color: #ffffff;">${formatCurrency(grandDocTotal)}</span>
        </div>
        <div>
          <span style="font-size: 0.82rem; color: #c7d2fe; display: block;">เงินสดรวม</span>
          <span style="font-weight: 700; font-size: 1.1rem; color: #34d399;">${formatCurrency(grandCash)}</span>
        </div>
        <div>
          <span style="font-size: 0.82rem; color: #c7d2fe; display: block;">เงินโอนรวม</span>
          <span style="font-weight: 700; font-size: 1.1rem; color: #818cf8;">${formatCurrency(grandTransfer)}</span>
        </div>
        <div>
          <span style="font-size: 0.82rem; color: #c7d2fe; display: block;">ยอด CN รวม</span>
          <span style="font-weight: 700; font-size: 1.1rem; color: #f43f5e;">${formatCurrency(grandCN)}</span>
        </div>
      </div>

      <div style="border-top: 1px solid rgba(255,255,255,0.2); padding-top: 1rem; display: flex; justify-content: space-between; align-items: center; font-size: 1.25rem; font-weight: 800;">
        <span style="color: #f8fafc;">รายรับสุทธิสายส่งรวมทั้งสิ้น:</span>
        <span style="color: #34d399; font-size: 1.4rem;">${formatCurrency(grandNet)} บาท</span>
      </div>
    </div>`;

  container.innerHTML = html;
}

// Bind Form Submits & Input Listeners
document.addEventListener('DOMContentLoaded', () => {
  const posForm = document.getElementById('pos-income-form');
  if (posForm) posForm.addEventListener('submit', handlePOSIncomeSubmit);

  const delForm = document.getElementById('delivery-income-form');
  if (delForm) delForm.addEventListener('submit', handleDeliveryIncomeSubmit);

  const addPosMachineForm = document.getElementById('form-add-pos-machine');
  if (addPosMachineForm) addPosMachineForm.addEventListener('submit', handleAddPOSMachine);

  ['pos-cash-amount', 'pos-transfer-amount', 'pos-coupon-amount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calculatePOSTotal);
  });

  ['delivery-doc-total', 'delivery-cash-amount', 'delivery-transfer-amount', 'delivery-cn-amount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateDeliveryValidation);
  });

  const posCloseBtn = document.getElementById('btn-close-pos-modal');
  if (posCloseBtn) posCloseBtn.addEventListener('click', closePOSIncomeModal);
  const posCancelBtn = document.getElementById('btn-cancel-pos-modal');
  if (posCancelBtn) posCancelBtn.addEventListener('click', closePOSIncomeModal);

  const delCloseBtn = document.getElementById('btn-close-delivery-modal');
  if (delCloseBtn) delCloseBtn.addEventListener('click', closeDeliveryIncomeModal);
  const delCancelBtn = document.getElementById('btn-cancel-delivery-modal');
  if (delCancelBtn) delCancelBtn.addEventListener('click', closeDeliveryIncomeModal);

  const posFilterSelect = document.getElementById('report-pos-filter-machine');
  if (posFilterSelect) posFilterSelect.addEventListener('change', refreshPOSReport);

  const posDateInput = document.getElementById('report-pos-date');
  if (posDateInput) posDateInput.addEventListener('change', refreshPOSReport);

  const delDateInput = document.getElementById('report-delivery-date');
  if (delDateInput) delDateInput.addEventListener('change', refreshDeliveryReport);

  const posMachineSelect = document.getElementById('pos-machine');
  if (posMachineSelect) posMachineSelect.addEventListener('change', updatePOSShiftAuto);

  const posDateInputModal = document.getElementById('pos-date');
  if (posDateInputModal) posDateInputModal.addEventListener('change', updatePOSShiftAuto);

  // Initial populate of POS machine dropdowns
  populatePOSMachineDropdowns();
  refreshPOSReport();
  refreshDeliveryReport();
});

