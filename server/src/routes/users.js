const express = require('express');
const User = require('../models/User');

const router = express.Router();

router.get('/', async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } })
    .sort({ username: 1 })
    .select('username createdAt');

  return res.json({
    users: users.map((user) => ({
      _id: user._id,
      username: user.username,
      createdAt: user.createdAt,
    })),
  });
});

module.exports = router;
