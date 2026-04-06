const express = require('express');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');

const router = express.Router();

function buildParticipantKey(userIdA, userIdB) {
  return [userIdA.toString(), userIdB.toString()].sort().join(':');
}

async function getConversationForDirectChat(currentUserId, partnerId) {
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

function serializeMessage(message, userId) {
  const hiddenForUser = message.deletedForUsers.some((hiddenUserId) => hiddenUserId.toString() === userId);

  if (hiddenForUser) {
    return null;
  }

  if (message.deletedForEveryone) {
    return null;
  }

  const conversationParticipants = message.conversation?.participants || [];
  const recipient = conversationParticipants.find((participant) => participant._id.toString() !== userId) || null;

  return {
    _id: message._id,
    content: message.content,
    conversation: message.conversation
      ? {
          _id: message.conversation._id,
          participants: conversationParticipants.map((participant) => ({
            _id: participant._id,
            username: participant.username,
          })),
        }
      : null,
    sender: {
      _id: message.sender._id,
      username: message.sender.username,
    },
    recipient: recipient ? { _id: recipient._id, username: recipient.username } : null,
    deletedForEveryone: message.deletedForEveryone,
    pinned: message.pinned,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

async function emitConversationUpdate(io, conversationId) {
  io.to(conversationId.toString()).emit('messages:updated', { conversationId: conversationId.toString() });
}

router.get('/', async (req, res) => {
  const { conversationId, partnerId } = req.query;

  let conversation = null;

  if (conversationId) {
    conversation = await Conversation.findById(conversationId).populate('participants', 'username');
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!conversation.participants.some((participant) => participant._id.toString() === req.user.id)) {
      return res.status(403).json({ message: 'You are not part of this conversation' });
    }
  } else if (partnerId) {
    const partner = await User.findById(partnerId);
    if (!partner) {
      return res.status(404).json({ message: 'Partner user not found' });
    }

    conversation = await getConversationForDirectChat(req.user.id, partnerId);
  } else {
    return res.status(400).json({ message: 'conversationId or partnerId is required' });
  }

  const messages = await Message.find({ conversation: conversation._id })
    .sort({ createdAt: 1 })
    .populate('sender', 'username')
    .populate({
      path: 'conversation',
      populate: {
        path: 'participants',
        select: 'username',
      },
    });

  const visibleMessages = messages
    .map((message) => serializeMessage(message, req.user.id))
    .filter(Boolean);

  return res.json({ messages: visibleMessages });
});

router.post('/', async (req, res) => {
  const { content, partnerId, conversationId } = req.body;

  if (!content || content.trim().length === 0 || content.trim().length > 500) {
    return res.status(400).json({ message: 'Message content must be between 1 and 500 characters' });
  }

  let conversation = null;

  if (conversationId) {
    conversation = await Conversation.findById(conversationId).populate('participants', 'username');

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!conversation.participants.some((participant) => participant._id.toString() === req.user.id)) {
      return res.status(403).json({ message: 'You are not part of this conversation' });
    }
  } else if (partnerId) {
    if (partnerId === req.user.id) {
      return res.status(400).json({ message: 'You cannot send a direct message to yourself' });
    }

    const partner = await User.findById(partnerId);
    if (!partner) {
      return res.status(404).json({ message: 'Partner user not found' });
    }

    conversation = await getConversationForDirectChat(req.user.id, partnerId);
  } else {
    return res.status(400).json({ message: 'conversationId or partnerId is required' });
  }

  const message = await Message.create({
    conversation: conversation._id,
    content: content.trim(),
    sender: req.user.id,
  });

  conversation.lastMessage = message._id;
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();

  await message.populate('sender', 'username');
  await message.populate({
    path: 'conversation',
    populate: {
      path: 'participants',
      select: 'username',
    },
  });

  await emitConversationUpdate(req.app.get('io'), conversation._id);

  return res.status(201).json({ message: serializeMessage(message, req.user.id) });
});

router.delete('/:id/me', async (req, res) => {
  const message = await Message.findById(req.params.id);

  if (!message) {
    return res.status(404).json({ message: 'Message not found' });
  }

  if (message.conversation) {
    const conversation = await Conversation.findById(message.conversation);
    if (conversation && !conversation.participants.some((participant) => participant.toString() === req.user.id)) {
      return res.status(403).json({ message: 'You are not part of this conversation' });
    }
  }

  const userId = req.user.id;
  if (!message.deletedForUsers.some((hiddenUserId) => hiddenUserId.toString() === userId)) {
    message.deletedForUsers.push(userId);
    await message.save();
  }

  await emitConversationUpdate(req.app.get('io'), message.conversation);
  return res.json({ message: 'Message hidden for this user' });
});

router.delete('/:id/everyone', async (req, res) => {
  const message = await Message.findById(req.params.id);

  if (!message) {
    return res.status(404).json({ message: 'Message not found' });
  }

  if (message.conversation) {
    const conversation = await Conversation.findById(message.conversation);
    if (conversation && !conversation.participants.some((participant) => participant.toString() === req.user.id)) {
      return res.status(403).json({ message: 'You are not part of this conversation' });
    }
  }

  if (message.sender.toString() !== req.user.id) {
    return res.status(403).json({ message: 'Only the author can delete this message for everyone' });
  }

  message.deletedForEveryone = true;
  message.pinned = false;
  await message.save();

  await emitConversationUpdate(req.app.get('io'), message.conversation);
  return res.json({ message: 'Message deleted for everyone' });
});

router.patch('/:id/pin', async (req, res) => {
  const { pinned } = req.body;
  const message = await Message.findById(req.params.id);

  if (!message) {
    return res.status(404).json({ message: 'Message not found' });
  }

  if (message.deletedForEveryone) {
    return res.status(400).json({ message: 'Cannot pin a deleted message' });
  }

  if (message.conversation) {
    const conversation = await Conversation.findById(message.conversation);
    if (conversation && !conversation.participants.some((participant) => participant.toString() === req.user.id)) {
      return res.status(403).json({ message: 'You are not part of this conversation' });
    }
  }

  const shouldPin = Boolean(pinned);

  if (shouldPin) {
    await Message.updateMany(
      { conversation: message.conversation, _id: { $ne: message._id } },
      { $set: { pinned: false } },
    );
    message.pinned = true;
  } else {
    await Message.updateMany(
      { conversation: message.conversation },
      { $set: { pinned: false } },
    );
    message.pinned = false;
  }

  await message.save();

  await emitConversationUpdate(req.app.get('io'), message.conversation);
  return res.json({ message: 'Pin status updated' });
});

module.exports = router;

