const User = require('../models/User');
const ChatSession = require('../models/ChatSession');
const Message = require('../models/Message');
const Call = require('../models/Call');
const { assignAgent, reassignAgent } = require('../services/agentAssignment');
const { deductToken, checkTokenBalance } = require('../services/tokenService');
const { sendInitialAIGreeting, respondToCustomerMessage } = require('../services/aiMessages');

const socketHandler = (io) => {
  // Store online users
  const onlineUsers = new Map();
  
  // Store active calls for per-minute tracking
  // Structure: { chatSessionId: { customerId, agentId, startTime, connectedTime, intervalId } }
  const activeCalls = new Map();

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User joins (authentication)
    socket.on('join', async (data) => {
      try {
        const { userId, token } = data;
        
        // In production, verify JWT token here
        // For now, we'll trust the userId from the client
        
        socket.userId = userId;
        socket.join(`user_${userId}`);
        
        // Update user online status
        const user = await User.findById(userId);
        if (user) {
            user.isOnline = true;
            await user.save();
          
          // Notify that user is online
          if (user.role === 'agent') {
            // Emit to all clients that this agent is online
            io.emit('agentOnline', { agentId: userId });
            // Also emit to specific chat sessions where this agent is active
            const agentChats = await ChatSession.find({ agent: userId });
            agentChats.forEach(chat => {
              io.to(`chat_${chat._id}`).emit('userOnline', { 
                userId: userId,
                role: 'agent',
                isOnline: true 
              });
            });
          } else if (user.role === 'customer') {
            // Emit to chat sessions where this customer is active
            const customerChats = await ChatSession.find({ customer: userId });
            customerChats.forEach(chat => {
              io.to(`chat_${chat._id}`).emit('userOnline', { 
                userId: userId,
                role: 'customer',
                isOnline: true 
              });
            });
          }
        }
        
        onlineUsers.set(userId, socket.id);
        console.log(`User ${userId} joined (${user?.role || 'unknown'})`);
      } catch (error) {
        console.error('Join error:', error);
      }
    });

    // Join chat room
    socket.on('joinChat', async (chatSessionId) => {
      try {
        if (!socket.userId) return;
        
        socket.join(`chat_${chatSessionId}`);
        
        // Get user and chat session info
        const user = await User.findById(socket.userId);
        const chatSession = await ChatSession.findById(chatSessionId)
          .populate('customer', 'name email isOnline')
          .populate('agent', 'name email isOnline')
          .populate('service', 'name');

        if (!user || !chatSession) return;

        // Trigger SamAI greeting (safe to call multiple times - guarded internally)
        if (user.role === 'customer') {
          sendInitialAIGreeting(chatSessionId, io).catch(err => {
            console.error('Error triggering SamAI greeting from joinChat:', err);
          });
        }
        
        // Emit user online status to this chat (to other users in the chat)
        socket.to(`chat_${chatSessionId}`).emit('userOnline', {
          userId: socket.userId,
          role: user.role,
          isOnline: true
        });
        
        // Also emit the other user's current online status to the joining user
        if (user.role === 'customer' && chatSession.agent) {
          // Customer joined, send agent's status
          socket.emit('userOnline', {
            userId: chatSession.agent._id,
            role: 'agent',
            isOnline: chatSession.agent.isOnline || false
          });
        } else if (user.role === 'agent' && chatSession.customer) {
          // Agent joined, send customer's status to agent
          socket.emit('userOnline', {
            userId: chatSession.customer._id,
            role: 'customer',
            isOnline: chatSession.customer.isOnline || false
          });
          
          // IMPORTANT: Send agent's online status to customer in the chat room
          io.to(`chat_${chatSessionId}`).emit('userOnline', {
            userId: user._id.toString(),
            role: 'agent',
            isOnline: user.isOnline || true // Agent is online if they're joining
          });

          // Only create system message if agent is assigned to this chat and chat is active
          // This prevents system messages when agents view pending chats they haven't accepted
          if (chatSession.agent && 
              chatSession.agent._id.toString() === user._id.toString() && 
              chatSession.status === 'active') {
            // Check if system message already exists to avoid duplicates
            const existingSystemMessage = await Message.findOne({
              chatSession: chatSessionId,
              senderRole: 'system',
              content: { $regex: new RegExp(`Agent ${user.name} has joined`, 'i') }
            });

            if (!existingSystemMessage) {
              // Create system message when assigned agent joins active chat
              const agentJoinMessage = await Message.create({
                chatSession: chatSessionId,
                sender: user._id,
                senderRole: 'system',
                senderType: 'system',
                content: `Agent ${user.name} has joined the chat`,
                messageType: 'system'
              });

              // Emit system message to chat room
              const systemMessageData = {
                _id: agentJoinMessage._id,
                chatSession: chatSessionId,
                sender: {
                  _id: 'SYSTEM',
                  name: 'System',
                  role: 'system'
                },
                senderRole: 'system',
                senderType: 'system',
                content: `Agent ${user.name} has joined the chat`,
                messageType: 'system',
                createdAt: agentJoinMessage.createdAt
              };

              io.to(`chat_${chatSessionId}`).emit('newMessage', systemMessageData);
            }
          }
        }

        // Notify others in the chat
        socket.to(`chat_${chatSessionId}`).emit('userJoined', {
          userId: socket.userId,
          chatSessionId
        });
      } catch (error) {
        console.error('Join chat error:', error);
      }
    });

    // Leave chat room
    socket.on('leaveChat', async (chatSessionId) => {
      try {
      socket.leave(`chat_${chatSessionId}`);
        
        // Emit user offline status to this chat
        if (socket.userId) {
          const user = await User.findById(socket.userId);
          if (user) {
            socket.to(`chat_${chatSessionId}`).emit('userOffline', {
              userId: socket.userId,
              role: user.role,
              isOnline: false
            });
          }
        }
      } catch (error) {
        console.error('Leave chat error:', error);
      }
    });

    // Send message
    socket.on('sendMessage', async (data) => {
      try {
        const { chatSessionId, content, messageType, fileUrl, fileName, replyTo } = data;
        const senderId = socket.userId;

        if (!senderId) {
          console.error('sendMessage: No userId on socket');
          return socket.emit('error', { message: 'User not authenticated. Please reconnect.' });
        }

        const sender = await User.findById(senderId);
        if (!sender) {
          console.error('sendMessage: User not found:', senderId);
          return socket.emit('error', { message: 'User not found' });
        }

        // Verify chat session
        const chatSession = await ChatSession.findById(chatSessionId);
        if (!chatSession) {
          return socket.emit('error', { message: 'Chat session not found' });
        }

        // Check authorization
        if (sender.role === 'customer' && chatSession.customer.toString() !== senderId) {
          return socket.emit('error', { message: 'Unauthorized' });
        }
        if (sender.role === 'agent' && chatSession.agent && chatSession.agent.toString() !== senderId) {
          return socket.emit('error', { message: 'Unauthorized' });
        }

        // For customers, check token balance
        if (sender.role === 'customer') {
          const balance = await checkTokenBalance(senderId);
          if (balance <= 0) {
            return socket.emit('error', { 
              message: 'Insufficient balance. Please recharge your plan.' 
            });
          }
        }

        // Verify replyTo message if provided
        if (replyTo) {
          const replyToMessage = await Message.findById(replyTo);
          if (!replyToMessage || replyToMessage.chatSession.toString() !== chatSessionId) {
            return socket.emit('error', { message: 'Invalid reply message' });
          }
        }

        // Create message
        const message = await Message.create({
          chatSession: chatSessionId,
          sender: senderId,
          senderRole: sender.role,
          content: content || '',
          messageType: messageType || 'text',
          fileUrl: fileUrl || '',
          fileName: fileName || '',
          replyTo: replyTo || null
        });

        // Deduct token for customer messages
        if (sender.role === 'customer') {
          const tokenResult = await deductToken(senderId, message._id);
          if (!tokenResult.success) {
            return socket.emit('error', { message: tokenResult.message });
          }
        }

        // Increment agent minutes for agent messages
        if (sender.role === 'agent') {
          const { incrementAgentMinutesForMessage } = require('../services/agentMinutesService');
          await incrementAgentMinutesForMessage(senderId);
        }

        // Don't auto-change status from pending to active
        // Status should only change when agent accepts the request via accept-request endpoint
        // This ensures chats stay in 'pending' until an agent explicitly accepts them

        // Populate message
        const populatedMessage = await Message.findById(message._id)
          .populate('sender', 'name email avatar role')
          .populate('replyTo', 'content messageType attachments fileUrl fileName sender')
          .populate('replyTo.sender', 'name avatar');

        // Convert to plain object for socket emission
        const messageData = {
          _id: populatedMessage._id,
          chatSession: populatedMessage.chatSession,
          sender: populatedMessage.sender,
          senderRole: populatedMessage.senderRole,
          content: populatedMessage.content,
          messageType: populatedMessage.messageType,
          fileUrl: populatedMessage.fileUrl,
          fileName: populatedMessage.fileName,
          replyTo: populatedMessage.replyTo,
          attachments: populatedMessage.attachments,
          isRead: populatedMessage.isRead,
          readAt: populatedMessage.readAt,
          createdAt: populatedMessage.createdAt,
          updatedAt: populatedMessage.updatedAt
        };

        // Emit to all in chat room
        io.to(`chat_${chatSessionId}`).emit('newMessage', messageData);

        // If customer sent a message and no agent has joined/online, generate AI response
        if (sender.role === 'customer') {
          // Update token balance for customer
          const updatedUser = await User.findById(senderId);
          socket.emit('tokenBalanceUpdate', { balance: updatedUser.tokenBalance });

          respondToCustomerMessage(chatSessionId, messageData, io).catch(err => {
            console.error('Error triggering SamAI response:', err);
          });
        }
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Error sending message' });
      }
    });

    // Typing indicator
    socket.on('typing', (data) => {
      const { chatSessionId, isTyping, userId, userName } = data;
      if (chatSessionId && socket.userId) {
        socket.to(`chat_${chatSessionId}`).emit('typing', {
          chatSessionId,
          userId: userId || socket.userId,
          userName: userName || 'User',
          isTyping: isTyping !== undefined ? isTyping : true
        });
      }
    });

    // Mark message as read
    socket.on('markRead', async (data) => {
      try {
        const { messageId } = data;
        
        const message = await Message.findById(messageId);
        if (!message) {
          return;
        }

        const chatSession = await ChatSession.findById(message.chatSession);
        
        // Only mark as read if user is the recipient
        if (chatSession.customer.toString() === socket.userId && 
            message.senderRole === 'agent') {
          message.isRead = true;
          message.readAt = new Date();
          await message.save();
          
          io.to(`chat_${message.chatSession}`).emit('messageRead', {
            messageId: message._id
          });
        } else if (chatSession.agent && 
                   chatSession.agent.toString() === socket.userId && 
                   message.senderRole === 'customer') {
          message.isRead = true;
          message.readAt = new Date();
          await message.save();
          
          io.to(`chat_${message.chatSession}`).emit('messageRead', {
            messageId: message._id
          });
        }
      } catch (error) {
        console.error('Mark read error:', error);
      }
    });

    // WebRTC signaling
    socket.on('offer', (data) => {
      if (!socket.userId) return;
      socket.to(`chat_${data.chatSessionId}`).emit('offer', {
        offer: data.offer,
        from: socket.userId,
        chatSessionId: data.chatSessionId
      });
    });

    socket.on('answer', (data) => {
      if (!socket.userId) return;
      socket.to(`chat_${data.chatSessionId}`).emit('answer', {
        answer: data.answer,
        from: socket.userId,
        chatSessionId: data.chatSessionId
      });
    });

    socket.on('ice-candidate', (data) => {
      if (!socket.userId) return;
      socket.to(`chat_${data.chatSessionId}`).emit('ice-candidate', {
        candidate: data.candidate,
        from: socket.userId,
        chatSessionId: data.chatSessionId
      });
    });

    // Handle call started (when call is initiated)
    socket.on('callStarted', async (data) => {
      if (!socket.userId) return;
      try {
        const { chatSessionId } = data;
        
        const chatSession = await ChatSession.findById(chatSessionId).populate('customer agent');
        if (!chatSession || !chatSession.customer || !chatSession.agent) return;
        
        // Check if both parties are online
        const customer = await User.findById(chatSession.customer._id);
        const agent = await User.findById(chatSession.agent._id);
        
        if (!customer.isOnline || !agent.isOnline) {
          console.log('Call cannot start: one or both parties are offline');
          return;
        }
        
        // Initialize call tracking
        activeCalls.set(chatSessionId, {
          customerId: chatSession.customer._id.toString(),
          agentId: chatSession.agent._id.toString(),
          startTime: new Date(),
          connectedTime: null,
          intervalId: null
        });
        
        console.log(`Call started for chat ${chatSessionId}`);
      } catch (error) {
        console.error('Error handling callStarted:', error);
      }
    });

    // Handle call connected (when call is answered/connected)
    socket.on('callConnected', async (data) => {
      if (!socket.userId) return;
      try {
        const { chatSessionId } = data;
        
        const callData = activeCalls.get(chatSessionId);
        if (!callData) {
          console.log(`No active call found for chat ${chatSessionId}`);
          return;
        }
        
        // Mark as connected
        callData.connectedTime = new Date();
        activeCalls.set(chatSessionId, callData);
        
        // Start per-minute tracking
        const intervalId = setInterval(async () => {
          try {
            const currentCallData = activeCalls.get(chatSessionId);
            if (!currentCallData) {
              clearInterval(intervalId);
              return;
            }
            
            // Verify both users are still online
            const customer = await User.findById(currentCallData.customerId);
            const agent = await User.findById(currentCallData.agentId);
            
            if (!customer || !agent || !customer.isOnline || !agent.isOnline) {
              console.log(`Call tracking stopped: one or both parties went offline for chat ${chatSessionId}`);
              clearInterval(intervalId);
              activeCalls.delete(chatSessionId);
              return;
            }
            
            // Deduct 1 minute from customer balance
            if (customer.tokenBalance > 0) {
              customer.tokenBalance -= 1;
              await customer.save();
              
              // Emit balance update to customer
              io.to(`user_${customer._id}`).emit('tokenBalanceUpdate', { 
                balance: customer.tokenBalance 
              });
            }
            
            // Track 1 minute for agent
            agent.totalMinutesEarned = (agent.totalMinutesEarned || 0) + 1;
            await agent.save();
            
            // Emit minute updates to both parties
            io.to(`chat_${chatSessionId}`).emit('minuteTracked', {
              customerBalance: customer.tokenBalance,
              agentMinutesEarned: agent.totalMinutesEarned
            });
            
            console.log(`Minute tracked for chat ${chatSessionId}: Customer balance=${customer.tokenBalance}, Agent earned=${agent.totalMinutesEarned}`);
          } catch (error) {
            console.error('Error in per-minute tracking:', error);
            clearInterval(intervalId);
            activeCalls.delete(chatSessionId);
          }
        }, 60000); // Every 60 seconds (1 minute)
        
        // Store interval ID for cleanup
        callData.intervalId = intervalId;
        activeCalls.set(chatSessionId, callData);
        
        console.log(`Call connected and per-minute tracking started for chat ${chatSessionId}`);
      } catch (error) {
        console.error('Error handling callConnected:', error);
      }
    });

    socket.on('callEnded', async (data) => {
      if (!socket.userId) return;
      try {
        const { chatSessionId, duration, initiator, currentUser } = data;
        
        // Stop per-minute tracking immediately
        const callData = activeCalls.get(chatSessionId);
        if (callData && callData.intervalId) {
          clearInterval(callData.intervalId);
          activeCalls.delete(chatSessionId);
          console.log(`Per-minute tracking stopped for chat ${chatSessionId}`);
        }
        
        // Emit to other party
        socket.to(`chat_${chatSessionId}`).emit('callEnded', {
          from: socket.userId,
          duration: duration || 0
        });

        // Save call record and message if call was connected (duration >= 0 and initiator exists)
        // Allow duration 0 for missed/rejected calls, but still save history
        if (initiator && chatSessionId) {
          try {
            const chatSession = await ChatSession.findById(chatSessionId);
            if (chatSession) {
              const callerId = initiator.toString();
              
              // Determine caller and receiver
              const caller = callerId === chatSession.customer.toString() 
                ? await User.findById(chatSession.customer)
                : await User.findById(chatSession.agent);
              const receiver = callerId === chatSession.customer.toString()
                ? await User.findById(chatSession.agent)
                : await User.findById(chatSession.customer);

              if (caller && receiver) {
                // Determine call status based on duration
                const callStatus = duration > 0 ? 'ended' : 'missed';
                
                // Save call history - always save if initiator exists
                const callRecord = await Call.create({
                  chatSession: chatSessionId,
                  caller: caller._id,
                  receiver: receiver._id,
                  callerRole: caller.role,
                  receiverRole: receiver.role,
                  duration: duration || 0,
                  status: callStatus,
                  endedAt: new Date()
                });

                console.log('Call history saved:', callRecord._id);

                // Create call message in chat only if call was connected (duration > 0)
                if (duration > 0) {
                  const callMessage = await Message.create({
                    chatSession: chatSessionId,
                    sender: caller._id,
                    senderRole: caller.role,
                    messageType: 'call',
                    callDuration: duration,
                    callDirection: 'outgoing',
                    content: `${caller.name} called ${receiver.name}`,
                    createdAt: new Date()
                  });

                  // Populate and emit to chat
                  await callMessage.populate('sender', 'name email avatar role');
                  io.to(`chat_${chatSessionId}`).emit('newMessage', callMessage);
                  console.log('Call message created and emitted:', callMessage._id);
                }
              } else {
                console.warn('Caller or receiver not found for call history');
              }
            } else {
              console.warn('Chat session not found for call history:', chatSessionId);
            }
          } catch (error) {
            console.error('Error saving call history:', error);
          }
        } else {
          console.warn('Missing initiator or chatSessionId for call history:', { initiator, chatSessionId, duration });
        }
      } catch (error) {
        console.error('Error handling callEnded:', error);
        // Still emit callEnded even if saving fails
        socket.to(`chat_${data.chatSessionId}`).emit('callEnded', {
          from: socket.userId
        });
      }
    });

    // Message edit/delete events are handled via HTTP API and emitted there
    // Socket events 'messageEdited' and 'messageDeleted' are emitted from routes

    // Agent goes offline - reassign chats
    socket.on('agentOffline', async () => {
      try {
        const agent = await User.findById(socket.userId);
        if (agent && agent.role === 'agent') {
          agent.isOnline = false;
          await agent.save();

          // Reassign active chats
          const activeChats = await ChatSession.find({
            agent: agent._id,
            status: 'active'
          });

          for (const chat of activeChats) {
            const newAgent = await reassignAgent(chat._id, agent._id);
            if (newAgent) {
              io.to(`chat_${chat._id}`).emit('agentReassigned', {
                newAgent: {
                  _id: newAgent._id,
                  name: newAgent.name
                }
              });
            }
          }

          // Clear active chats
          agent.activeChats = [];
          await agent.save();

          io.emit('agentOffline', { agentId: agent._id });
        }
      } catch (error) {
        console.error('Agent offline error:', error);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      try {
        if (socket.userId) {
          const user = await User.findById(socket.userId);
          if (user) {
              user.isOnline = false;
              await user.save();
            
            // Stop all active calls for this user immediately
            for (const [chatSessionId, callData] of activeCalls.entries()) {
              if (callData.customerId === socket.userId.toString() || callData.agentId === socket.userId.toString()) {
                if (callData.intervalId) {
                  clearInterval(callData.intervalId);
                }
                activeCalls.delete(chatSessionId);
                console.log(`Stopped call tracking for chat ${chatSessionId} due to user disconnect`);
                
                // Notify other party
                io.to(`chat_${chatSessionId}`).emit('callEnded', {
                  from: socket.userId,
                  reason: 'disconnected'
                });
              }
            }
            
            // Notify that user is offline
            if (user.role === 'agent') {
              io.emit('agentOffline', { agentId: user._id });
              // Emit to specific chat sessions
              const agentChats = await ChatSession.find({ agent: user._id });
              agentChats.forEach(chat => {
                io.to(`chat_${chat._id}`).emit('userOffline', { 
                  userId: user._id,
                  role: 'agent',
                  isOnline: false 
                });
              });
            } else if (user.role === 'customer') {
              // Emit to chat sessions where this customer is active
              const customerChats = await ChatSession.find({ customer: user._id });
              customerChats.forEach(chat => {
                io.to(`chat_${chat._id}`).emit('userOffline', { 
                  userId: user._id,
                  role: 'customer',
                  isOnline: false 
                });
              });
            }
          }
          
          onlineUsers.delete(socket.userId);
          console.log(`User ${socket.userId} disconnected`);
        }
      } catch (error) {
        console.error('Disconnect error:', error);
      }
    });
  });
};

module.exports = socketHandler;

