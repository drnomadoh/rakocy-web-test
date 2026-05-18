const sql = require('mssql');

// Azure SQL Database configuration
// These values will come from Azure App Service settings later
const config = {
  server: process.env.DB_SERVER,           // e.g. yourserver.database.windows.net
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: true,                         // Required for Azure SQL
    trustServerCertificate: false
  }
};

let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log('Connected to Azure SQL Database');
  }
  return pool;
}

async function savePrice(data) {
  const pool = await getPool();
  
  await pool.request()
    .input('price_date', sql.Date, data.price_date)
    .input('price', sql.Decimal(10, 2), data.price)
    .input('change_amount', sql.Decimal(10, 2), data.change_amount)
    .input('change_percent', sql.Decimal(5, 2), data.change_percent)
    .query(`
      MERGE SilverPrices AS target
      USING (SELECT @price_date AS price_date) AS source
      ON target.price_date = source.price_date
      WHEN MATCHED THEN 
        UPDATE SET 
          price = @price, 
          change_amount = @change_amount, 
          change_percent = @change_percent,
          scraped_at = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (price_date, price, change_amount, change_percent)
        VALUES (@price_date, @price, @change_amount, @change_percent);
    `);
}

async function getAllPrices() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT price_date, price, change_amount, change_percent, scraped_at 
    FROM SilverPrices 
    ORDER BY price_date DESC
  `);
  return result.recordset;
}

async function getLatestPrice() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 * FROM SilverPrices 
    ORDER BY price_date DESC
  `);
  return result.recordset[0];
}

module.exports = {
  savePrice,
  getAllPrices,
  getLatestPrice
};