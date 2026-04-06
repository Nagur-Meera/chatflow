const { Schema, model, Types } = require('mongoose');

const conversationSchema = new Schema(
  {
    participantKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    participants: [{
      type: Types.ObjectId,
      ref: 'User',
      required: true,
    }],
    lastMessage: {
      type: Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

conversationSchema.pre('validate', function ensureDirectChat(next) {
  if (this.participants.length !== 2) {
    next(new Error('A direct conversation must contain exactly two participants'));
    return;
  }

  next();
});

module.exports = model('Conversation', conversationSchema);
