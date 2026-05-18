const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeSilverPrice() {
  try {
    const { data } = await axios.get('https://www.moneymetals.com/silver-price', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    let price = null;
    let changeAmount = null;
    let changePercent = null;

    // Find the row containing "Silver Price per Ounce"
    $('table tr').each((i, row) => {
      const rowText = $(row).text();
      if (rowText.includes('Silver Price per Ounce')) {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          // Extract price (remove $ and commas)
          price = parseFloat($(cells[1]).text().replace(/[$,]/g, ''));
          
          if (cells.length >= 3) {
            changeAmount = parseFloat($(cells[2]).text().replace(/[$,]/g, ''));
          }
          if (cells.length >= 4) {
            changePercent = parseFloat($(cells[3]).text().replace('%', ''));
          }
        }
      }
    });

    if (!price) {
      console.log('Could not extract silver price from the page');
      return null;
    }

    return {
      price_date: new Date().toISOString().split('T')[0], // Format: YYYY-MM-DD
      price: price,
      change_amount: changeAmount,
      change_percent: changePercent
    };

  } catch (error) {
    console.error('Scraping error:', error.message);
    return null;
  }
}

module.exports = { scrapeSilverPrice };