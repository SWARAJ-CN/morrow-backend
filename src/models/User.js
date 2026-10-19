import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    bio: { type: String, trim: true, maxlength: 160, default: '' },
    profilePhoto: { type: String, default: null },
    themeColor: { type: String, trim: true, default: null, maxlength: 9 },
    lastSeen: { type: Date, default: null },
    pushTokens: { type: [String], default: [] },
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);