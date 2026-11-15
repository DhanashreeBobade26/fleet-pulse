const express = require('express');

const router = express.Router();

let chaosSettings = {};

router.get('/', (req, res) => {
  res.json({ chaos: chaosSettings });
});

router.post('/', (req, res) => {
  chaosSettings = {
    ...chaosSettings,
    ...req.body
  };

  res.json({
    message: 'Chaos settings updated',
    chaos: chaosSettings
  });
});

router.delete('/', (req, res) => {
  chaosSettings = {};

  res.json({
    message: 'Chaos settings reset',
    chaos: chaosSettings
  });
});

function getChaosSettings() {
  return chaosSettings;
}

module.exports = router;
module.exports.getChaosSettings = getChaosSettings;