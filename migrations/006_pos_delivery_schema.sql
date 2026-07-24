-- migrations/006_pos_delivery_schema.sql
-- Add POS & Delivery fields to transactions table
ALTER TABLE transactions ADD COLUMN sub_type TEXT;
ALTER TABLE transactions ADD COLUMN pos_machine TEXT;
ALTER TABLE transactions ADD COLUMN pos_shift TEXT;
ALTER TABLE transactions ADD COLUMN customer_count INTEGER DEFAULT 0;
ALTER TABLE transactions ADD COLUMN document_total_amount REAL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN cn_amount REAL DEFAULT 0;
