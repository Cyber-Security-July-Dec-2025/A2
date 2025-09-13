
# SecureChat - End-to-End Encrypted Chat with Whiteboard

A modern, secure chat application with real-time whiteboard collaboration, featuring end-to-end encryption using OpenPGP.js and a beautiful, minimalistic UI.

## 🌟 Features

### 🔐 Security
- **End-to-End Encryption**: All messages encrypted with OpenPGP.js (RSA-3072)
- **Client-Side Key Generation**: Private keys never leave your device
- **Challenge-Response Authentication**: Digital signature verification
- **Secure Key Storage**: AES-GCM wrapped private keys with PBKDF2

### 💬 Chat
- **Real-time messaging** with WebSocket communication
- **Message persistence** with MongoDB backend
- **Optimistic UI updates** for smooth user experience
- **Message history** loading and local storage caching
- **Online status indicators** for all users

### 🎨 Collaborative Whiteboard
- **Real-time drawing synchronization** between users
- **Multiple drawing tools**: Pen, eraser with adjustable brush sizes
- **Color palette** with 14 predefined colors
- **Canvas persistence** - drawings saved and restored
- **Touch and mouse support** for all devices
- **Clear canvas** functionality

### 🎯 Modern UI/UX
- **Glassmorphism design** with gradient backgrounds
- **Responsive layout** that works on all screen sizes
- **Smooth animations** and hover effects
- **Clean, minimalistic interface** 
- **Contextual controls** that appear when needed

## 🏗️ Architecture

### Tech Stack
- **Backend**: Node.js + Express + Socket.io + MongoDB (Mongoose)
- **Frontend**: React 18 + Vite + OpenPGP.js
- **Database**: MongoDB with Mongoose ODM
- **Real-time**: Socket.io WebSockets
- **Crypto**: OpenPGP.js for client-side encryption

### Security Model
```
1. User generates RSA-3072 key pair in browser
2. Private key encrypted with AES-GCM using password-derived key
3. Only public key sent to server during registration
4. Server issues cryptographic challenge
5. Client signs challenge with private key
6. Server verifies signature and authenticates user
7. All messages encrypted client-side before transmission
8. Server stores only encrypted message blobs
```

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18
- MongoDB (local or Atlas)
- Modern web browser

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd pgpencrypt-chat-main
```

2. **Setup Backend**
```bash
cd server
npm install
```

3. **Configure Environment**
```bash
# Update MongoDB URI in server.js if needed
# Default: MongoDB Atlas connection included
```

4. **Start Backend Server**
```bash
npm run dev
# Server runs on http://localhost:42069
```

5. **Setup Frontend**
```bash
cd ../client-react
npm install
```

6. **Start Frontend**
```bash
npm run dev
# Frontend runs on http://localhost:5173
```

## 📱 Usage Guide

### First Time Setup
1. **Create Account**: Choose "New User" and enter username + strong password
2. **Generate Keys**: Click "Generate Keys" to create your encryption keys
3. **Backup Keys**: Download your encrypted private key file (recommended)
4. **Register**: Complete the registration process

### Returning User
1. **Login**: Choose "Existing User" and enter your password
2. **Load Keys**: Upload your previously downloaded key file
3. **Register**: Sign in with your existing identity

### Chatting
1. **Select User**: Click on any online user in the sidebar
2. **Send Messages**: Type and send end-to-end encrypted messages
3. **View History**: Previous conversations are automatically loaded

### Whiteboard Collaboration
1. **Open Whiteboard**: Click the "🎨 Whiteboard" button in chat header
2. **Draw Together**: Use pen/eraser tools with adjustable sizes and colors
3. **Real-time Sync**: See drawings appear instantly for both users
4. **Persist Drawings**: All drawings are saved and restored on revisit
5. **Clear Canvas**: Use "🗑️ Clear Canvas" to start fresh

## 🔧 Configuration

### Environment Variables
The server uses these configuration options:
- `PORT`: Server port (default: 42069)
- `MONGODB_URI`: MongoDB connection string

### Database Models
- **User**: Stores usernames and public keys
- **Message**: Stores encrypted messages with metadata
- **Whiteboard**: Stores drawing strokes and session data

## 🛡️ Security Considerations

### For Maximum Security
- Use on a clean, uncompromised system
- Use Tor Browser for anonymous access
- Use strong, unique passwords
- Keep private key files secure
- Clear browser data after use on shared devices

### Current Security Level
- ✅ End-to-end message encryption
- ✅ Client-side key generation
- ✅ Challenge-response authentication
- ✅ Encrypted key storage
- ⚠️ Local message history stored decrypted
- ⚠️ No forward secrecy (planned enhancement)

## 🗂️ Project Structure

```
├── server/                 # Backend application
│   ├── models/            # Mongoose database models
│   │   ├── User.js       # User model (username, publicKey)
│   │   ├── Message.js    # Message model (encrypted content)
│   │   └── Whiteboard.js # Whiteboard model (drawing data)
│   ├── package.json      # Backend dependencies
│   └── server.js         # Main server file
├── client-react/          # Frontend application
│   ├── src/
│   │   ├── ui/
│   │   │   ├── App.jsx   # Main React component
│   │   │   └── Whiteboard.jsx # Whiteboard component
│   │   ├── crypto.js     # OpenPGP.js crypto utilities
│   │   └── main.jsx      # React entry point
│   ├── package.json      # Frontend dependencies
│   └── vite.config.js    # Vite configuration
├── client/               # Legacy static client (unused)
└── README.md            # This file
```

## 🔮 Future Enhancements

- [ ] **Forward Secrecy**: Implement X25519 ephemeral keys with double-ratchet
- [ ] **File Transfer**: Encrypted file sharing capabilities  
- [ ] **Group Chat**: Multi-user encrypted conversations
- [ ] **Voice/Video**: WebRTC integration with encryption
- [ ] **Mobile App**: React Native implementation
- [ ] **Rate Limiting**: Server-side abuse prevention
- [ ] **Audit Logging**: Security event monitoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the GPLv3 License - see the [LICENSE](https://choosealicense.com/licenses/gpl-3.0/) for details.

## 🔗 Links

- **Live Demo**: [Coming Soon]
- **Documentation**: This README
- **Issues**: [GitHub Issues]
- **Security**: Report vulnerabilities responsibly

## ⚠️ Disclaimer

This software is provided for educational and research purposes. While it implements strong cryptographic practices, it has not undergone formal security auditing. Use at your own risk in production environments.

---

**Built with ❤️ for privacy and security**

