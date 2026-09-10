const express=require('express');
const path=require('path');
const pool=require('./db');
const { generateShortCode } = require('./utils/shortCode');

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

app.get('/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  try {
    const result = await pool.query(
      'SELECT long_url FROM urls WHERE short_code = $1',
      [shortCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Short link not found');
    }

    res.redirect(result.rows[0].long_url);
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});

app.listen(PORT,()=>{
    console.log(`sever running on http://localhost:${PORT}`);
});