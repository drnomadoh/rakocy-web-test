// server.js
const express = require('express');
const sql = require('mssql');
require('dotenv').config(); // Optional: for local development

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Azure SQL Configuration (Private Endpoint)
// ============================================
const config = {
    connectionString: process.env.DB_CONNECTION_STRING,
    options: {
        encrypt: true,                    // Required for Azure SQL
        trustServerCertificate: false,    // Recommended for production
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Create a connection pool (recommended)
let poolPromise;

async function getPool() {
    if (!poolPromise) {
        poolPromise = new sql.ConnectionPool(config)
            .connect()
            .then(pool => {
                console.log('✅ Connected to Azure SQL via Private Endpoint');
                return pool;
            })
            .catch(err => {
                console.error('❌ Database Connection Failed:', err);
                poolPromise = null; // Allow retry
                throw err;
            });
    }
    return poolPromise;
}

// ============================================
// Routes
// ============================================

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Node.js app running on Azure App Service',
        privateConnection: 'Using Private Endpoint (if VNet Integration is enabled)'
    });
});

// Test database connection
app.get('/test-db', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT 1 AS test, GETDATE() AS currentTime');
        
        res.json({
            success: true,
            message: 'Successfully connected to Azure SQL via Private Endpoint',
            data: result.recordset[0]
        });
    } catch (err) {
        console.error('Database query error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to connect to database',
            error: err.message
        });
    }
});

// Example: Get some data from a table
app.get('/users', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT TOP 10 * FROM Users'); // Change table name
        
        res.json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: 'Error fetching users',
            error: err.message
        });
    }
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log('Using connection string from environment variable');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (poolPromise) {
        await (await poolPromise).close();
    }
    process.exit(0);
});
