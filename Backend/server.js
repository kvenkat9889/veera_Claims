const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3102;

// Enhanced configuration
const config = {
  db: {
    user: 'postgres',
    host: 'postgres',
    database: 'claims_portal',
    password: 'admin123',
    port: 5432,
  },
  uploads: {
    dir: path.join(__dirname, 'uploads'),
    maxFileSize: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  }
};

// Middleware setup
app.use(cors({
  origin: [
    'http://44.223.23.145:8204', 
    'http://localhost:8204',
    'http://44.223.23.145:8205',  // Add this line
    'http://localhost:8205'       // Add this line
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(config.uploads.dir));

// Ensure upload directory exists
if (!fs.existsSync(config.uploads.dir)) {
  fs.mkdirSync(config.uploads.dir, { recursive: true });
  console.log(Created upload directory at ${config.uploads.dir});
}

// Configure multer with enhanced validation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.uploads.dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (config.uploads.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(Invalid file type: ${file.mimetype}), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: config.uploads.maxFileSize,
    files: 5 // Maximum 5 files per claim
  }
});

// Database connection with retry logic
const pool = new Pool(config.db);

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

// Initialize database with enhanced schema
async function initializeDatabase() {
  let retries = 5;
  while (retries) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS claims (
          id SERIAL PRIMARY KEY,
          employee_id VARCHAR(7) NOT NULL,
          employee_name VARCHAR(100) NOT NULL,
          title VARCHAR(100) NOT NULL,
          date DATE NOT NULL,
          amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
          category VARCHAR(50) NOT NULL,
          description TEXT NOT NULL,
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
          response TEXT DEFAULT '',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS claim_attachments (
          id SERIAL PRIMARY KEY,
          claim_id INTEGER REFERENCES claims(id) ON DELETE CASCADE,
          file_name VARCHAR(255) NOT NULL,
          file_path VARCHAR(255) NOT NULL,
          file_size INTEGER NOT NULL,
          mime_type VARCHAR(100) NOT NULL,
          uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create index for better performance
      await pool.query('CREATE INDEX IF NOT EXISTS idx_claims_employee_id ON claims(employee_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_attachments_claim_id ON claim_attachments(claim_id)');

      console.log('Database initialized successfully');
      break;
    } catch (err) {
      retries--;
      console.error(Error initializing database (${retries} retries left):, err);
      if (retries === 0) {
        throw err;
      }
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

// Helper function to build file URLs
function buildFileUrl(filename) {
  return `http://44.223.23.145:3102/uploads/${encodeURIComponent(filename)}`;
}

// API Routes with enhanced error handling

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'healthy',
      db: 'connected',
      uploadDir: fs.existsSync(config.uploads.dir) ? 'accessible' : 'inaccessible'
    });
  } catch (err) {
    res.status(500).json({
      status: 'unhealthy',
      error: err.message
    });
  }
});

// Get all claims with pagination
app.get('/api/claims', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const claimsQuery = await pool.query(
      'SELECT * FROM claims ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    const countQuery = await pool.query('SELECT COUNT(*) FROM claims');
    const totalClaims = parseInt(countQuery.rows[0].count, 10);

    // Get attachments for each claim
    for (const claim of claimsQuery.rows) {
      const attachmentsQuery = await pool.query(
        'SELECT file_name, file_path, file_size FROM claim_attachments WHERE claim_id = $1',
        [claim.id]
      );
      claim.attachments = attachmentsQuery.rows.map(att => ({
        name: att.file_name,
        url: buildFileUrl(att.file_path),
        size: att.file_size
      }));
    }

    res.json({
      data: claimsQuery.rows,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: totalClaims,
        totalPages: Math.ceil(totalClaims / limit)
      }
    });
  } catch (err) {
    console.error('Error in GET /api/claims:', err);
    res.status(500).json({
      error: 'Failed to fetch claims',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Submit new claim with robust validation
app.post('/api/claims', upload.array('attachments', 5), async (req, res) => {
  const { employeeId, employeeName, title, amount, category, description } = req.body;
  const date = new Date().toISOString().split('T')[0];

  // Validate required fields
  if (!employeeId || !employeeName || !title || !amount || !category || !description) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['employeeId', 'employeeName', 'title', 'amount', 'category', 'description']
    });
  }

  // Validate employee ID format
  if (!/^ATS0\d{3}$/.test(employeeId)) {
    return res.status(400).json({
      error: 'Invalid employee ID format',
      expected: 'ATS followed by 4 digits (e.g., ATS0123)'
    });
  }

  // Validate amount is a positive number
  if (isNaN(amount) || parseFloat(amount) <= 0) {
    return res.status(400).json({
      error: 'Invalid amount',
      message: 'Amount must be a positive number'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check for existing claims for the same employee on the same day
    const existingClaims = await client.query(
      'SELECT id FROM claims WHERE employee_id = $1 AND date = $2 LIMIT 1',
      [employeeId, date]
    );

    if (existingClaims.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Duplicate claim',
        message: 'Cannot submit more than one claim per day per employee'
      });
    }

    // Insert claim
    const claimResult = await client.query(
      `INSERT INTO claims 
       (employee_id, employee_name, title, date, amount, category, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [employeeId, employeeName, title, date, parseFloat(amount), category, description]
    );

    const newClaim = claimResult.rows[0];

    // Process file attachments if any
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          await client.query(
            `INSERT INTO claim_attachments 
             (claim_id, file_name, file_path, file_size, mime_type)
             VALUES ($1, $2, $3, $4, $5)`,
            [newClaim.id, file.originalname, file.filename, file.size, file.mimetype]
          );
        } catch (fileError) {
          console.error('Error saving attachment:', fileError);
          throw new Error('Failed to save one or more attachments');
        }
      }
    }

    // Get attachments for response
    const attachmentsResult = await client.query(
      'SELECT file_name, file_path, file_size FROM claim_attachments WHERE claim_id = $1',
      [newClaim.id]
    );

    newClaim.attachments = attachmentsResult.rows.map(att => ({
      name: att.file_name,
      url: buildFileUrl(att.file_path),
      size: att.file_size
    }));

    await client.query('COMMIT');
    res.status(201).json(newClaim);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in POST /api/claims:', err);

    // Clean up uploaded files if transaction failed
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        try {
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
        } catch (cleanupError) {
          console.error('Error cleaning up file:', cleanupError);
        }
      });
    }

    res.status(500).json({
      error: 'Failed to submit claim',
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack
      })
    });
  } finally {
    client.release();
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled application error:', err);
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      error: 'File upload error',
      message: err.message,
      code: err.code
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    message: 'An unexpected error occurred',
    ...(process.env.NODE_ENV === 'development' && {
      details: err.message,
      stack: err.stack
    })
  });
});

// Start server with database initialization
async function startServer() {
  try {
    await initializeDatabase();
    app.listen(port, () => {
      console.log(Server running on http://44.223.23.145:${port});
      console.log(Upload directory: ${config.uploads.dir});
      console.log(Database config: ${JSON.stringify(config.db)});
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();