import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    directKey: { type: String, unique: true, required: true },
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    wallpaperUrl: { type: String, default: null },
    wallpaperBrightness: { type: Number, min: 0.25, max: 1, default: 1 },
  },
  { timestamps: true },
);

export const Conversation = mongoose.model('Conversation', conversationSchema);