// Clean Express + Socket.io server (legacy WebSocket code removed)
require('colors');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const openpgp = require('openpgp');
const User = require('./models/User');
const Message = require('./models/Message');

dotenv.config();

const PORT = process.env.PORT || 42069;
const MONGODB_URI = "mongodb+srv://iit2023098:iit2023098@cluster0.zszzgj2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
//process.env.MONGODB_URI || 'mongodb://localhost:27017/pgpencrypt';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const onlineUsers = new Map();
const pending = new Map();

async function broadcastUsers(io){
  const users = await User.find({}, { _id:0, username:1, publicKey:1 }).lean();
  const online = Array.from(onlineUsers.keys());
  io.emit('users', { users, online });
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
  console.log(`Socket connected ${socket.id}`.brightBlue);

  socket.on('register', async ({ username, publicKey }) => {
    try {
      if(!/^[A-Za-z0-9]{1,15}$/.test(username||'')) {
        socket.emit('error_msg', { message: 'Invalid username' });
        return;
      }
      const existing = await User.findOne({ username });
      if(existing && existing.publicKey !== publicKey){
        socket.emit('error_msg', { message: 'Username already exists with different key' });
        return;
      }
      if(!existing){ await User.create({ username, publicKey }); }
      else { existing.lastSeen = new Date(); await existing.save(); }
      const challenge = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pending.set(socket.id, { username, publicKey, challenge });
      socket.emit('verify', { challenge });
    } catch(e){ console.error(e); socket.emit('error_msg', { message: 'Registration error' }); }
  });

  socket.on('verify_signature', async ({ signed }) => {
    const data = pending.get(socket.id);
    if(!data){ socket.emit('error_msg', { message: 'No challenge' }); return; }
    try {
      const publicKey = await openpgp.readKey({ armoredKey: data.publicKey });
      const cleartext = await openpgp.readCleartextMessage({ cleartextMessage: signed });
      const verificationResult = await openpgp.verify({ message: cleartext, verificationKeys: publicKey });
      const validity = await verificationResult.signatures[0].verified.catch(()=>false);
      if(!validity || cleartext.getText() !== data.challenge){ socket.emit('error_msg', { message: 'Signature verification failed' }); return; }
      onlineUsers.set(data.username, socket.id);
      socket.data.username = data.username;
      pending.delete(socket.id);
      socket.emit('registered', { username: data.username });
      broadcastUsers(io);
      const queue = await Message.find({ to: data.username, delivered: false }).sort({ createdAt:1 });
      for(const m of queue){
        socket.emit('message', { from: m.from, payload: JSON.parse(m.armored), createdAt: m.createdAt });
        m.delivered = true; await m.save();
      }
    } catch(e){ console.error(e); socket.emit('error_msg', { message: 'Verification error' }); }
  });

  socket.on('send_message', async ({ to, payload }) => {
    const from = socket.data.username;
    if(!from){ socket.emit('error_msg', { message: 'Not verified' }); return; }
    if(!to || !payload) return;
    try {
      await Message.create({ from, to, armored: JSON.stringify(payload), type: payload.type || 'chat' });
      const targetSocketId = onlineUsers.get(to);
      if(targetSocketId){ io.to(targetSocketId).emit('message', { from, payload }); }
    } catch(e){ console.error(e); socket.emit('error_msg', { message: 'Message store failed' }); }
  });

  socket.on('history', async ({ withUser, limit = 50 }) => {
    const me = socket.data.username; if(!me) return;
    const msgs = await Message.find({ $or:[{ from: me, to: withUser }, { from: withUser, to: me }]})
      .sort({ createdAt: -1 }).limit(limit).lean();
    socket.emit('history', { withUser, messages: msgs.reverse().map(m => ({ from: m.from, to: m.to, payload: JSON.parse(m.armored), createdAt: m.createdAt })) });
  });

  socket.on('disconnect', () => {
    const username = socket.data.username;
    if(username){ onlineUsers.delete(username); broadcastUsers(io); }
    pending.delete(socket.id);
    console.log(`Socket disconnected ${socket.id}`.red);
  });
});

mongoose.connect(MONGODB_URI).then(() => {
  console.log('Mongo connected'.green);
  server.listen(PORT, () => console.log(`Server listening on ${PORT}`.brightGreen));
}).catch(err => { console.error('Mongo connection error', err); process.exit(1); });

process.on('unhandledRejection', err => { console.error('UnhandledRejection', err); });
process.on('uncaughtException', err => { console.error('UncaughtException', err); });

