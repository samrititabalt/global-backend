const SAM_AI_SENDER = {
  _id: 'SAM_AI',
  name: 'SamAI',
  role: 'ai'
};

const formatMessageForSamAI = (messageDoc) => {
  if (!messageDoc) return messageDoc;

  const message = messageDoc.toObject ? messageDoc.toObject() : { ...messageDoc };

  if (message.senderRole === 'ai') {
    message.sender = { ...SAM_AI_SENDER };
  }

  if (message.replyTo && message.replyTo.senderRole === 'ai') {
    message.replyTo = message.replyTo.toObject ? message.replyTo.toObject() : { ...message.replyTo };
    message.replyTo.sender = { ...SAM_AI_SENDER };
  }

  return message;
};

const mapMessagesForSamAI = (messages = []) => messages.map(formatMessageForSamAI);

module.exports = {
  SAM_AI_SENDER,
  formatMessageForSamAI,
  mapMessagesForSamAI
};

