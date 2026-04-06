const { Schema, model, Types } = require('mongoose');

const messageSchema = new Schema(
  {
    conversation: {
      type: Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    sender: {
      type: Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deletedForEveryone: {
      type: Boolean,
      default: false,
    },
    deletedForUsers: [
      {
        type: Types.ObjectId,
        ref: 'User',
      },
    ],
    pinned: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

module.exports = model('Message', messageSchema);

