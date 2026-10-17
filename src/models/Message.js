import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['text', 'image', 'video', 'audio', 'file', 'gif', 'sticker'], default: 'text' },
    text: { type: String, trim: true, maxlength: 4000, default: '' },
    mediaUrl: { type: String, default: null },
    mediaName: { type: String, trim: true, maxlength: 180, default: '' },
    mediaType: { type: String, trim: true, maxlength: 100, default: '' },
    durationSeconds: { type: Number, min: 0, default: null },
  },
  { timestamps: true },
);

export const Message = mongoose.model('Message', messageSchema);