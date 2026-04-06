const express = require('express');
const Conversation = require('../models/Conversation');
const User = require('../models/User');

const router = express.Router();

function buildParticipantKey(userIdA, userIdB) {
  return [userIdA.toString(), userIdB.toString()].sort().join(':');
}

async function ensureDirectConversation(currentUserId, partnerId) {
  const participantKey = buildParticipantKey(currentUserId, partnerId);

  let conversation = await Conversation.findOne({ participantKey });
  if (!conversation) {
    conversation = await Conversation.create({
      participantKey,
      participants: [currentUserId, partnerId],
    });
  }

  return conversation;
}

router.get('/', async (req, res) => {
  const conversations = await Conversation.find({ participants: req.user.id })
    .sort({ updatedAt: -1 })
    .populate('participants', 'username')
    .populate({
      path: 'lastMessage',
      populate: { path: 'sender', select: 'username' },
    });

  const payload = conversations.map((conversation) => {
    const partner = conversation.participants.find((participant) => participant._id.toString() !== req.user.id);

    return {
      _id: conversation._id,
      partner: partner ? { _id: partner._id, username: partner.username } : null,
      lastMessage: conversation.lastMessage,
      lastMessageAt: conversation.lastMessageAt,
      updatedAt: conversation.updatedAt,
      createdAt: conversation.createdAt,
    };
  });

  return res.json({ conversations: payload });
});

router.post('/', async (req, res) => {
  const { partnerId } = req.body;

  if (!partnerId) {
    return res.status(400).json({ message: 'partnerId is required' });
  }

  if (partnerId === req.user.id) {
    return res.status(400).json({ message: 'You cannot create a direct conversation with yourself' });
  }

  const partner = await User.findById(partnerId);
  if (!partner) {
    return res.status(404).json({ message: 'Partner user not found' });
  }

  const conversation = await ensureDirectConversation(req.user.id, partnerId);
  await conversation.populate('participants', 'username');

  return res.status(201).json({
    conversation: {
      _id: conversation._id,
      participants: conversation.participants,
      lastMessage: conversation.lastMessage,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
  });
});

module.exports = router;
