const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3640;

// Middleware
app.use(cors());
app.use(express.json());
// Update this line to ensure proper path resolution
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// PostgreSQL connection configuration
const dbConfig = {
  user: 'postgres',
  host: 'postgres',
  database: 'claims_portal',
  password: 'admin123',
  port: 5432,
};

const pool = new Pool(dbConfig);

// Initialize database table
async function initializeDatabase() {
  try {
    await pool.query(`
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
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS claim_attachments (
        id SERIAL PRIMARY KEY,
        claim_id INTEGER REFERENCES claims(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_size INTEGER NOT NULL,
        mime_type VARCHAR(100) NOT NULL
      );
    `);

    const { rowCount } = await pool.query('SELECT * FROM claims');
    if (rowCount === 0) {
      await pool.query(`
        INSERT INTO claims (employee_id, employee_name, title, date, amount, category, description, status, response)
        VALUES
          ('ATS0123', 'Veera', 'Travel Expense Reimbursement', '2024-05-15', 37500.50, 'Travel', 'Expenses for client meeting in Mumbai including flight, hotel, and meals.', 'pending', ''),
          ('ATS0456', 'Raghava', 'Office Supplies Purchase', '2024-05-10', 10450.30, 'Office Supplies', 'Purchased notebooks, pens, and printer paper for the marketing department.', 'approved', 'Approved. Reimbursement will be processed in the next payroll cycle.'),
          ('ATS0124', 'Pavan', 'Training Course Fee', '2024-05-05', 62500.00, 'Training', 'Fee for Advanced Project Management certification course.', 'rejected', 'Rejected. This training was not pre-approved by your department manager.'),
          ('ATS0789', 'Priya Sharma', 'Laptop Purchase', '2024-05-18', 85000.00, 'Equipment', 'New MacBook Pro for design team member', 'pending', ''),
          ('ATS0345', 'Rahul Patel', 'Medical Checkup', '2024-05-12', 5000.00, 'Medical', 'Annual health checkup at Apollo Hospital', 'approved', 'Approved as per company health policy')
      `);
    }
  } catch (err) {
    console.error('Error initializing database:', err);
    process.exit(1); // Exit if database initialization fails
  }
}

// Helper function to construct file URLs
function getFileUrl(filename) {
  const baseUrl = process.env.NODE_ENV === 'production' 
    ? 'https://your-production-domain.com' 
    : `http://44.223.23.145:${port}`;
  return `${baseUrl}/uploads/${encodeURIComponent(filename)}`;
}

// Get all claims
app.get('/api/claims', async (req, res) => {
  try {
    const { rows: claims } = await pool.query('SELECT * FROM claims ORDER BY date DESC');
    
    for (const claim of claims) {
      const { rows: attachments } = await pool.query(
        'SELECT file_name, file_path, file_size FROM claim_attachments WHERE claim_id = $1',
        [claim.id]
      );
      claim.attachments = attachments.map(att => ({
        name: att.file_name,
        url: getFileUrl(att.file_path),
        size: att.file_size
      }));
    }
    
    res.json(claims);
  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Get claim by ID
app.get('/api/claims/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM claims WHERE id = $1', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    
    const claim = rows[0];
    const { rows: attachments } = await pool.query(
      'SELECT file_name, file_path, file_size FROM claim_attachments WHERE claim_id = $1',
      [claim.id]
    );
    
    claim.attachments = attachments.map(att => ({
      name: att.file_name,
      url: getFileUrl(att.file_path),
      size: att.file_size
    }));
    
    res.json(claim);
  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Get claims by employee ID
app.get('/api/claims/employee/:employeeId', async (req, res) => {
  const { employeeId } = req.params;
  if (!/^ATS0(?!000)\d{3}$/.test(employeeId)) {
    return res.status(400).json({ error: 'Invalid Employee ID format' });
  }
  try {
    const { rows: claims } = await pool.query(
      'SELECT * FROM claims WHERE employee_id = $1 ORDER BY date DESC', 
      [employeeId]
    );
    
    for (const claim of claims) {
      const { rows: attachments } = await pool.query(
        'SELECT file_name, file_path, file_size FROM claim_attachments WHERE claim_id = $1',
        [claim.id]
      );
      claim.attachments = attachments.map(att => ({
        name: att.file_name,
        url: getFileUrl(att.file_path),
        size: att.file_size
      }));
    }
    
    res.json(claims);
  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Add a new claim with file uploads
app.post('/api/claims', upload.array('attachments'), async (req, res) => {
  // Validate required fields
  const requiredFields = ['employeeId', 'employeeName', 'title', 'amount', 'category', 'description'];
  const missingFields = requiredFields.filter(field => !req.body[field]);
  
  if (missingFields.length > 0) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      missing: missingFields
    });
  }

  const { employeeId, employeeName, title, amount, category, description } = req.body;
  const date = new Date().toISOString().split('T')[0];

  try {
    // Validate employee ID format
    if (!/^ATS0(?!000)\d{3}$/.test(employeeId)) {
      return res.status(400).json({ error: 'Invalid Employee ID format' });
    }

    // Check for existing claims
    const { rows: existing } = await pool.query(
      'SELECT * FROM claims WHERE employee_id = $1 AND date = $2',
      [employeeId, date]
    );
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Cannot submit more than one claim per day' });
    }

    // Start transaction
    await pool.query('BEGIN');

    // Insert claim
    const { rows } = await pool.query(
      `INSERT INTO claims (employee_id, employee_name, title, date, amount, category, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [employeeId, employeeName, title, date, parseFloat(amount), category, description]
    );

    const claim = rows[0];

    // Process file attachments
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          `INSERT INTO claim_attachments (claim_id, file_name, file_path, file_size, mime_type)
           VALUES ($1, $2, $3, $4, $5)`,
          [claim.id, file.originalname, file.filename, file.size, file.mimetype]
        );
      }
    }

    // Commit transaction
    await pool.query('COMMIT');

    // Get attachments for response
    const { rows: attachments } = await pool.query(
      'SELECT file_name, file_path, file_size FROM claim_attachments WHERE claim_id = $1',
      [claim.id]
    );

    claim.attachments = attachments.map(att => ({
      name: att.file_name,
      url: getFileUrl(att.file_path),
      size: att.file_size
    }));

    res.status(201).json(claim);
  } catch (err) {
    // Rollback transaction on error
    await pool.query('ROLLBACK');
    console.error('Error in POST /api/claims:', err);

    // Clean up uploaded files if any
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }

    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Update claim status and response
app.put('/api/claims/:id', async (req, res) => {
  const { id } = req.params;
  const { status, response } = req.body;

  if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE claims SET status = $1, response = $2 WHERE id = $3 RETURNING *',
      [status, response || '', id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start server
app.listen(port, async () => {
  try {
    await initializeDatabase();
    console.log(`Server running on http://44.223.23.145:${port}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
});

