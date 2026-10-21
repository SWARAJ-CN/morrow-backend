import mongoose from 'mongoose';

const storySchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mediaUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    caption: { type: String, trim: true, maxlength: 180, default: '' },
    // Users who have opened this story. Drives the seen/unseen indicator.
    viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: true },
);

export const Story = mongoose.model('Story', storySchema);
