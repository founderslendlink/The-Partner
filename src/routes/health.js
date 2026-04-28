const express = require('express');
const router = express.Router();
const { db } = require('../utils/supabase');

router.get('/', async (req, res) => {
  const supabase = db();
  const { error } = await supabase.from('businesses').select('id').limit(1);

  res.json({
    status: error ? 'degraded' : 'ok',
    service: 'the-partner',
    timestamp: new Date().toISOString(),
    db: error ? 'error' : 'connected',
  });
});

module.exports = router;
