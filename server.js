// server.js
const express = require('express');
const sql = require('mssql');
require('dotenv').config(); // For local development only

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Azure SQL Configuration (Private Endpoint)
// ============================================
const connectionString = process.env.DB_CONNECTION_STRING;

if (!connectionString) {
    console.error("❌ FATAL ERROR: DB_CONNECTION_STRING environment variable is not set!");
    process.exit(1);
}

const config = {
    connectionString: connectionString,
    options: {
        encrypt: true,                    // Required for Azure SQL
        trustServerCertificate: false,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Connection Pool
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
                console.error('❌ Database Connection Failed:', err.message);
                poolPromise = null; // Allow retry on next request
                throw err;
            });
    }
    return poolPromise;
}

// ============================================
// Routes
// ============================================

// Health check / Root route
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
        console.error('Database error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to connect to database',
            error: err.message
        });
    }
});

// Example route - Get data from a table (update table name as needed)
app.get('/users', async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT TOP 10 * FROM Users');

        res.json({
            success: true,
            count: result.recordset.length,
            data: result.recordset
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: 'Error fetching data',
            error: err.message
        });
    }
});

// ============================================
// Start Server
// ============================================
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (poolPromise) {
        try {
            const pool = await poolPromise;
            await pool.close();
            console.log('Database pool closed.');
        } catch (err) {
            console.error('Error closing database pool:', err);
        }
    }
    process.exit(0);
});
