const express=require('express');
const path=require('path');
const pool=require('./db');
const { generateShortCode } = require('./utils/shortCode');
const { UAParser } = require('ua-parser-js');
const geoip = require('geoip-lite');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { generateApiKey } = require('./utils/apiKey');
const { hashApiKey } = require('./utils/apiKey');

const app=express();


const PORT=process.env.PORT||3000;

app.set('view engine','ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({extended: true}));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));


function requireLogin(req, res, next) {
  if (!req.session.loggedIn) {
    return res.redirect('/login');
  }
  next();
} 

async function requireApiKey(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header. Use: Bearer <your_api_key>' });
  }

  const rawKey = authHeader.replace('Bearer ', '');
  const hash = hashApiKey(rawKey);

  try {
    const result = await pool.query(
      'SELECT id, revoked FROM api_keys WHERE key_hash = $1',
      [hash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const key = result.rows[0];

    if (key.revoked) {
      return res.status(401).json({ error: 'This API key has been revoked' });
    }

    pool.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
      [key.id]
    ).catch(err => console.error('Failed to update last_used_at:', err));

    req.apiKeyId = key.id;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
}


app.get('/',(req,res)=>{
    res.render('index');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (username !== process.env.ADMIN_USERNAME) {
    return res.render('login', { error: 'Invalid username or password' });
  }

  const match = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

  if (!match) {
    return res.render('login', { error: 'Invalid username or password' });
  }

  req.session.loggedIn = true;
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
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

app.get('/dashboard/api-keys', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, label, created_at, last_used_at, revoked FROM api_keys ORDER BY created_at DESC'
    );
    res.render('api-keys', { keys: result.rows, newKey: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});

app.post('/dashboard/api-keys', requireLogin, async (req, res) => {
  const { label } = req.body;

  try {
    const { rawKey, hash } = generateApiKey();

    await pool.query(
      'INSERT INTO api_keys (key_hash, label) VALUES ($1, $2)',
      [hash, label || null]
    );

    const result = await pool.query(
      'SELECT id, label, created_at, last_used_at, revoked FROM api_keys ORDER BY created_at DESC'
    );

    res.render('api-keys', { keys: result.rows, newKey: rawKey });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});

app.get('/dashboard/:shortCode',requireLogin, async (req, res) => {
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

    const dailyClicksResult = await pool.query(
  `SELECT
     DATE(clicked_at) AS day,
     COUNT(*) AS count
   FROM clicks
   WHERE url_id = $1
   GROUP BY DATE(clicked_at)
   ORDER BY day ASC`,
  [url.id]
);



const topReferrersResult = await pool.query(
  `SELECT
     COALESCE(referrer, 'Direct') AS referrer,
     COUNT(*) AS count
   FROM clicks
   WHERE url_id = $1
   GROUP BY referrer
   ORDER BY count DESC
   LIMIT 5`,
  [url.id]
);

const topCountriesResult = await pool.query(
  `SELECT
     COALESCE(country, 'Unknown') AS country,
     COUNT(*) AS count
   FROM clicks
   WHERE url_id = $1
   GROUP BY country
   ORDER BY count DESC
   LIMIT 5`,
  [url.id]
);

res.render('link-detail', {
  url,
  clicks: clicksResult.rows,
  dailyClicks: dailyClicksResult.rows,
  topReferrers: topReferrersResult.rows,
  topCountries: topCountriesResult.rows,
});    


  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});

app.get('/dashboard', requireLogin,async (req, res) => {
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

app.post('/api/shorten', requireApiKey, async (req, res) => {
  const { longUrl, customAlias } = req.body;

  if (!longUrl) {
    return res.status(400).json({ error: 'longUrl is required' });
  }

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
        return res.status(409).json({ error: 'That custom alias is already taken' });
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

    res.status(201).json({
      shortCode,
      shortUrl: `${req.protocol}://${req.get('host')}/${shortCode}`,
      longUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.listen(PORT,()=>{
    console.log(`sever running on http://localhost:${PORT}`);
});