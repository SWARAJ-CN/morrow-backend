import mongoose from 'mongoose';

/**
 * App-wide settings that admins can change without a deploy.
 *
 * A single document with `key: 'app'` holds them; extra keys are reserved
 * for future settings groups.
 */
const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'app' },
    // Where "Invite to Morrow" links point. Empty means "use the default
    // store link".
    inviteUrl: { type: String, trim: true, maxlength: 500, default: '' },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const Settings = mongoose.model('Settings', settingsSchema);

/** Read the app settings, creating the default document on first use. */
export async function getAppSettings() {
  const settings = await Settings.findOneAndUpdate(
    { key: 'app' },
    { $setOnInsert: { key: 'app', inviteUrl: '' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return settings;
}

/** Update the app settings. */
export async function updateAppSettings(updates) {
  const settings = await Settings.findOneAndUpdate(
    { key: 'app' },
    { $set: { ...updates, updatedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return settings;
}
