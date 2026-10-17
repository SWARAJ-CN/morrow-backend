import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { Story } from '../models/Story.js';

export const storyRouter = Router();
storyRouter.use(requireAuth);

const createSchema = z.object({
  mediaUrl: z.string().url(),
  mediaType: z.enum(['image', 'video']),
  caption: z.string().trim().max(180).default(''),
});

storyRouter.get('/', async (request, response, next) => {
  try {
    const stories = await Story.find({ expiresAt: { $gt: new Date() } })
      .populate('owner', 'displayName phone profilePhoto')
      .sort({ createdAt: 1 });
    const byOwner = new Map();
    for (const story of stories) {
      const ownerId = story.owner.id;
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, { owner: story.owner, stories: [] });
      byOwner.get(ownerId).stories.push(story);
    }
    return response.json({ stories: [...byOwner.values()] });
  } catch (error) {
    return next(error);
  }
});

storyRouter.post('/', async (request, response, next) => {
  try {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Choose an image or video and try again.' });
    const story = await Story.create({ ...parsed.data, owner: request.userId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    await story.populate('owner', 'displayName phone profilePhoto');
    return response.status(201).json({ story });
  } catch (error) {
    return next(error);
  }
});

storyRouter.delete('/:storyId', async (request, response, next) => {
  try {
    if (!mongoose.isValidObjectId(request.params.storyId)) return response.status(400).json({ error: 'Invalid story.' });
    const story = await Story.findOneAndDelete({ _id: request.params.storyId, owner: request.userId });
    if (!story) return response.status(404).json({ error: 'Story not found.' });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});
