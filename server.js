const express = require('express');
const cron = require('node-cron');
const { scrapeSilverPrice } = require('./scraper');
const { savePrice, getAllPrices, getLatestPrice } = require('./db');

const app = express();
app.set('view engine', 'ejs');

// Home page - shows silver price history
app.get('/', async (req, res) => {
  try {
    const prices = await getAllPrices();
    const latest = await getLatestPrice();

    res.render('index', { 
      prices: prices || [], 
      latest: latest || null,
      error: null 
    });
  } catch (err) {
    console.error('Database error:', err.message);
    res.render('index', { 
      prices: [], 
      latest: null, 
      error: 'Unable to load data from database. Please check connection settings.' 
    });
  }
});

// Manual scrape button
app.post('/scrape', async (req, res) => {
  try {
    const result = await scrapeSilverPrice();
    if (result) {
      await savePrice(result);
      res.json({ success: true, data: result });
    } else {
      res.status(500).json({ success: false, message: 'Failed to scrape price' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Scrape once when the app starts
  scrapeAndSave();

  // Schedule daily scrape at 9:00 AM
  cron.schedule('0 9 * * *', () => {
    console.log('Running scheduled silver price scrape...');
    scrapeAndSave();
  });
});

async function scrapeAndSave() {
  try {
    const data = await scrapeSilverPrice();
    if (data) {
      await savePrice(data);
      console.log('Silver price saved successfully:', data);
    }
  } catch (err) {
    console.error('Scheduled scrape failed:', err.message);
  }
}
