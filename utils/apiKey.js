const crypto = require('crypto');

function generateApiKey() {
  const rawKey = 'tt_' + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { rawKey, hash };
}

function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

module.exports = { generateApiKey, hashApiKey };