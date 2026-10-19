import { User } from './models/User.js';
import { isOnline } from './presence.js';

export async function sendPushNotification(tokens, title, body, data = {}) {
  const messages = [...new Set(tokens)].filter((token) => /^ExponentPushToken\[.+\]$/.test(token)).map((to) => ({
    to,
    title,
    body,
    data,
    sound: 'default',
    priority: 'high',
    channelId: 'messages',
  }));

  if (messages.length === 0) return;

  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!response.ok) throw new Error(`Expo Push returned ${response.status}.`);
}

// Notify every member of a conversation except the sender. People who are
// currently online get the socket event instead, so we skip their devices.
export async function notifyConversation(conversation, senderId, senderName, body) {
  try {
    const recipients = await User.find({
      _id: { $in: conversation.members.filter((member) => String(member) !== String(senderId)) },
    }).select('pushTokens');
    const tokens = recipients.filter((recipient) => !isOnline(recipient.id)).flatMap((recipient) => recipient.pushTokens);
    await sendPushNotification(tokens, senderName || 'New message', body, { conversationId: conversation.id });
  } catch (error) {
    console.warn('Push delivery failed:', error.message);
  }
}
