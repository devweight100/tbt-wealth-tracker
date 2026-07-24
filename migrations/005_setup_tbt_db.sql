-- migrations/005_setup_tbt_db.sql
-- Add document_number column and seed default cash account
ALTER TABLE transactions ADD COLUMN document_number TEXT;

-- Seed default Cash account
INSERT OR IGNORE INTO accounts (id, name, type, account_number, bank_name, initial_balance, is_default, sort_order)
VALUES ('acc-cash', 'เงินสด', 'cash', '-', '-', 0, 1, 0);

-- Seed default categories if empty
INSERT OR IGNORE INTO categories (id, name, type, is_system, sort_order)
VALUES
  ('cat-inc-1', 'เงินเดือน', 'income', 0, 1),
  ('cat-inc-2', 'รายได้เสริม', 'income', 0, 2),
  ('cat-inc-3', 'โอนเงินเข้า', 'income', 0, 3),
  ('cat-inc-4', 'ดอกเบี้ย / เงินปันผล', 'income', 0, 4),
  ('cat-inc-5', 'อื่นๆ', 'income', 0, 5),
  ('cat-exp-1', 'อาหารและเครื่องดื่ม', 'expense', 0, 1),
  ('cat-exp-2', 'การเดินทาง / น้ำมัน', 'expense', 0, 2),
  ('cat-exp-3', 'ช้อปปิ้ง', 'expense', 0, 3),
  ('cat-exp-4', 'ค่าบ้าน / คอนโด / ค่าเช่า', 'expense', 0, 4),
  ('cat-exp-5', 'ค่าน้ำ / ค่าไฟ / ค่าอินเทอร์เน็ต', 'expense', 0, 5),
  ('cat-exp-6', 'ความบันเทิง / ท่องเที่ยว', 'expense', 0, 6),
  ('cat-exp-7', 'สุขภาพ / ยารักษาโรค', 'expense', 0, 7),
  ('cat-exp-8', 'อื่นๆ', 'expense', 0, 8);
