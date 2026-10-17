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
