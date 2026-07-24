// Excel export helper using SheetJS (XLSX) for Smart Wealth Tracker

const ExcelExport = {
  exportToExcel(transactions, accounts, categories) {
    if (!window.XLSX) {
      alert('ระบบดาวน์โหลดไฟล์ผิดพลาด: ไม่พบตัวเชื่อมโยง SheetJS กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();

      // --- 1. SHEET: OVERVIEW (ภาพรวม) ---
      const totalInitial = accounts.reduce((sum, acc) => sum + Number(acc.initialBalance || 0), 0);
      const totalBalance = accounts.reduce((sum, acc) => sum + Number(acc.balance || 0), 0);
      
      const todayStr = new Date().toLocaleDateString('sv-SE');
      
      const pastAndPresentTx = transactions.filter(t => t.date <= todayStr);
      const futureTx = transactions.filter(t => t.date > todayStr);

      const totalIncome = pastAndPresentTx
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      const totalExpense = pastAndPresentTx
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      const totalFutureExpense = futureTx
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      const overviewData = [
        ['ระบบจัดการการเงินอัจฉริยะ (Smart Wealth Tracker) - รายงานภาพรวม'],
        ['วันที่ออกรายงาน:', new Date().toLocaleString('th-TH')],
        [],
        ['--- ดัชนีตัวเลขสำคัญ (Key Metrics) ---'],
        ['ตัวชี้วัด', 'จำนวนเงิน (บาท)'],
        ['เงินในบัญชีรวม ณ ปัจจุบัน (Current Balance)', totalBalance],
        ['เงินตั้งต้นรวมทั้งหมด (Total Initial)', totalInitial],
        ['รายรับสะสมทั้งหมด (Total Income)', totalIncome],
        ['รายจ่ายสะสมทั้งหมด (Total Expense)', totalExpense],
        ['รายจ่ายล่วงหน้าค้างจ่าย (Future Expense Pending)', totalFutureExpense],
        [],
        ['--- สรุปยอดเงินคงเหลือแยกรายบัญชี ---'],
        ['ชื่อบัญชี', 'ประเภท', 'เลขบัญชี/ธนาคาร', 'เงินตั้งต้น', 'ยอดปัจจุบัน'],
        ...accounts.map(acc => [
          acc.name,
          acc.type === 'cash' ? 'เงินสด' : 'บัญชีธนาคาร',
          acc.type === 'cash' ? '-' : `${acc.bankName} (${acc.accountNumber})`,
          acc.initialBalance,
          acc.balance
        ])
      ];

      const wsOverview = XLSX.utils.aoa_to_sheet(overviewData);
      
      // Auto-fit columns
      const overviewColsWidths = [{ wch: 35 }, { wch: 15 }, { wch: 25 }, { wch: 15 }, { wch: 15 }];
      wsOverview['!cols'] = overviewColsWidths;

      XLSX.utils.book_append_sheet(wb, wsOverview, 'ภาพรวมระบบ');


      // --- 2. SHEET: TRANSACTIONS (ธุรกรรมทั้งหมด) ---
      const txRows = transactions.map(t => {
        const acc = accounts.find(a => a.id === t.accountId);
        const isFuture = t.date > todayStr;
        
        return {
          'รหัสธุรกรรม': t.id,
          'วันที่ทำรายการ': t.date,
          'เลขที่เอกสาร': t.documentNumber || '-',
          'ประเภท': t.type === 'income' ? 'รายรับ (+)' : 
                   (t.type === 'transfer_out' ? 'ย้ายเงิน (โอนออก)' : 
                   (t.type === 'transfer_in' ? 'ย้ายเงิน (โอนเข้า)' : 'รายจ่าย (-)')),
          'หมวดหมู่': t.category,
          'จำนวนเงิน (บาท)': Number(t.amount || 0),
          'วิธีชำระเงิน': t.paymentMethod === 'Cash' ? 'เงินสด' : 'เงินโอน',
          'บัญชีการเงินที่ใช้': acc ? acc.name : 'ไม่ระบุ/ถูกลบ',
          'หมายเหตุ': t.notes || '-',
          'สถานะรายการ': isFuture ? 'จ่ายล่วงหน้า (Pre-recorded)' : 'ทำรายการแล้ว (Completed)',
          'มีบิลหรือสลิปแนบ': t.slipUrl ? 'มี (Yes)' : 'ไม่มี (No)'
        };
      });

      const wsTransactions = XLSX.utils.json_to_sheet(txRows);
      
      // Auto-fit columns
      wsTransactions['!cols'] = [
        { wch: 15 }, // ID
        { wch: 15 }, // Date
        { wch: 18 }, // Document Number
        { wch: 15 }, // Type
        { wch: 20 }, // Category
        { wch: 15 }, // Amount
        { wch: 15 }, // Payment Method
        { wch: 20 }, // Account Name
        { wch: 30 }, // Notes
        { wch: 25 }, // Status
        { wch: 18 }  // Slip status
      ];

      XLSX.utils.book_append_sheet(wb, wsTransactions, 'รายการธุรกรรมทั้งหมด');


      // --- 3. SHEET: ACCOUNTS (บัญชีการเงิน) ---
      const accRows = accounts.map(acc => ({
        'รหัสบัญชี': acc.id,
        'ชื่อบัญชี': acc.name,
        'ประเภทบัญชี': acc.type === 'cash' ? 'เงินสด' : 'บัญชีธนาคาร',
        'เลขบัญชี': acc.accountNumber || '-',
        'ชื่อธนาคาร': acc.bankName || '-',
        'ยอดเงินตั้งต้น (บาท)': Number(acc.initialBalance || 0),
        'ยอดเงินปัจจุบัน (บาท)': Number(acc.balance || 0)
      }));

      const wsAccounts = XLSX.utils.json_to_sheet(accRows);
      wsAccounts['!cols'] = [
        { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 18 }
      ];
      XLSX.utils.book_append_sheet(wb, wsAccounts, 'บัญชีการเงิน');


      // --- 4. SHEET: CATEGORIES (หมวดหมู่) ---
      const catRows = categories.map(cat => ({
        'รหัสหมวดหมู่': cat.id,
        'ชื่อหมวดหมู่': cat.name,
        'ประเภท': cat.type === 'income' ? 'รายรับ' : 'รายจ่าย',
        'หมวดหมู่ระบบ': cat.isSystem ? 'ใช่ (เริ่มต้น)' : 'ไม่ใช่ (สร้างเอง)'
      }));

      const wsCategories = XLSX.utils.json_to_sheet(catRows);
      wsCategories['!cols'] = [
        { wch: 15 }, { wch: 25 }, { wch: 15 }, { wch: 18 }
      ];
      XLSX.utils.book_append_sheet(wb, wsCategories, 'หมวดหมู่รายรับรายจ่าย');


      // --- SAVE AND EXPORT FILE ---
      const formattedDate = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `Smart_Wealth_Tracker_Report_${formattedDate}.xlsx`);
      
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      alert('เกิดข้อผิดพลาดในการสร้างไฟล์รายงาน Excel: ' + error.message);
    }
  }
};

window.ExcelExport = ExcelExport;
