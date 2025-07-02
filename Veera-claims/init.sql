-- Create claims table
CREATE TABLE IF NOT EXISTS claims (
  id SERIAL PRIMARY KEY,
  employee_id VARCHAR(7) NOT NULL,
  employee_name VARCHAR(30) NOT NULL,
  title VARCHAR(30) NOT NULL,
  date DATE NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  response TEXT DEFAULT ''
);

-- Create claim_attachments table
CREATE TABLE IF NOT EXISTS claim_attachments (
  id SERIAL PRIMARY KEY,
  claim_id INTEGER REFERENCES claims(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL
);

-- Insert initial data into claims table
INSERT INTO claims (employee_id, employee_name, title, date, amount, category, description, status, response)
VALUES
  ('ATS0123', 'Veera', 'Travel Expense Reimbursement', '2024-05-15', 37500.50, 'Travel', 'Expenses for client meeting in Mumbai including flight, hotel, and meals.', 'pending', ''),
  ('ATS0456', 'Raghava', 'Office Supplies Purchase', '2024-05-10', 10450.30, 'Office Supplies', 'Purchased notebooks, pens, and printer paper for the marketing department.', 'approved', 'Approved. Reimbursement will be processed in the next payroll cycle.'),
  ('ATS0124', 'Pavan', 'Training Course Fee', '2024-05-05', 62500.00, 'Training', 'Fee for Advanced Project Management certification course.', 'rejected', 'Rejected. This training was not pre-approved by your department manager.'),
  ('ATS0789', 'Priya Sharma', 'Laptop Purchase', '2024-05-18', 85000.00, 'Equipment', 'New MacBook Pro for design team member', 'pending', ''),
  ('ATS0345', 'Rahul Patel', 'Medical Checkup', '2024-05-12', 5000.00, 'Medical', 'Annual health checkup at Apollo Hospital', 'approved', 'Approved as per company health policy');
