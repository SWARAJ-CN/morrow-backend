import mongoose from 'mongoose';

/**
 * A saved conversation with the assistant.
 *
 * Threads are kept per user so the assistant can be picked up again later,
 * and so the user can delete anything they have asked.
 */
const assistantThreadSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 120, default: 'New chat' },
    // [{ role: 'user' | 'assistant', content: string }]
    messages: [
      {
        role: { type: String, enum: ['user', 'assistant'], required: true },
        content: { type: String, trim: true, maxlength: 8000, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
  },
  { timestamps: true },
);

assistantThreadSchema.index({ user: 1, updatedAt: -1 });

export const AssistantThread = mongoose.model('AssistantThread', assistantThreadSchema);
