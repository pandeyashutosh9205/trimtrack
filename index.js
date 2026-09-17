const express=require('express');
const path=require('path');
const pool=require('./db');
const { generateShortCode } = require('./utils/shortCode');
const { UAParser } = require('ua-parser-js');
const geoip = require('geoip-lite');

const app=express();


const PORT=process.env.PORT||3000;

app.set('view engine','ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({extended: true}));

app.get('/',(req,res)=>{
    res.render('index');
});



app.post('/shorten', async (req, res) => {
  const { longUrl, customAlias } = req.body;

  let shortCode = customAlias && customAlias.trim() !== ''
    ? customAlias.trim()
    : generateShortCode();

  try {
    if (customAlias && customAlias.trim() !== '') {
      const existing = await pool.query(
        'SELECT id FROM urls WHERE short_code = $1',
        [shortCode]
      );
      if (existing.rows.length > 0) {
        return res.render('index', {
          error: 'That custom alias is already taken. Try another.',
        });
      }
    } else {
      let isUnique = false;
      while (!isUnique) {
        const existing = await pool.query(
          'SELECT id FROM urls WHERE short_code = $1',
          [shortCode]
        );
        if (existing.rows.length === 0) {
          isUnique = true;
        } else {
          shortCode = generateShortCode();
        }
      }
    }

    await pool.query(
      'INSERT INTO urls (short_code, long_url) VALUES ($1, $2)',
      [shortCode, longUrl]
    );

    res.render('index', {
      shortUrl: `${req.protocol}://${req.get('host')}/${shortCode}`,
    });
  } catch (err) {
    console.error(err);
    res.render('index', {
      error: 'Something went wrong. Please try again.',
    });
  }
});

app.get('/dashboard/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  try {
    const urlResult = await pool.query(
      'SELECT * FROM urls WHERE short_code = $1',
      [shortCode]
    );

    if (urlResult.rows.length === 0) {
      return res.status(404).send('Link not found');
    }

    const url = urlResult.rows[0];

    const clicksResult = await pool.query(
      'SELECT * FROM clicks WHERE url_id = $1 ORDER BY clicked_at DESC',
      [url.id]
    );

    res.render('link-detail', { url, clicks: clicksResult.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});

app.get('/dashboard', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        urls.id,
        urls.short_code,
        urls.long_url,
        urls.created_at,
        COUNT(clicks.id) AS click_count
      FROM urls
      LEFT JOIN clicks ON clicks.url_id = urls.id
      GROUP BY urls.id
      ORDER BY urls.created_at DESC
    `);

    res.render('dashboard', { links: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});

app.get('/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  try {
    const result = await pool.query(
      'SELECT id, long_url FROM urls WHERE short_code = $1',
      [shortCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Short link not found');
    }

    const url = result.rows[0];

    const referrer = req.get('Referrer') || req.get('Referer') || null;
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim()
      || req.socket.remoteAddress
      || null;

    const parser = new UAParser(req.headers['user-agent']);
    const deviceType = parser.getDevice().type || 'desktop';

    const geo = ipAddress ? geoip.lookup(ipAddress) : null;
    const country = geo ? geo.country : null;
    const city = geo ? geo.city : null;

    pool.query(
      `INSERT INTO clicks (url_id, referrer, ip_address, country, city, device_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [url.id, referrer, ipAddress, country, city, deviceType]
    ).catch(err => console.error('Failed to record click:', err));

    res.redirect(url.long_url);
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});

app.listen(PORT,()=>{
    console.log(`sever running on http://localhost:${PORT}`);
});