/*
  # Create accounts and transactions tables for Personal Finance Tracker

  1. New Tables
    - `accounts`
      - `id` (uuid, primary key)
      - `name` (text) - Account name (e.g., BCA, GoPay)
      - `type` (text) - Account type (Bank Account, Cash, e-Wallet, Gold Savings)
      - `balance` (numeric) - Current account balance in IDR
      - `icon_name` (text) - Icon identifier for UI
      - `color` (text) - Tailwind color class
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
    
    - `transactions`
      - `id` (uuid, primary key)
      - `account_id` (uuid, foreign key to accounts)
      - `description` (text) - Transaction description
      - `category` (text) - Category of transaction
      - `amount` (numeric) - Transaction amount (positive for income, negative for expense)
      - `type` (text) - Transaction type (income, expense, transfer)
      - `transaction_date` (timestamp) - When transaction occurred
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on both tables
    - Add policies for public read access (can be restricted later for multi-user)
*/

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  icon_name text NOT NULL,
  color text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  description text NOT NULL,
  category text NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  transaction_date timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on accounts"
  ON accounts
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on accounts"
  ON accounts
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Allow public update on accounts"
  ON accounts
  FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read on transactions"
  ON transactions
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow public insert on transactions"
  ON transactions
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date DESC);
