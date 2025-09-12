
# PGPencrypt.chat

PGPencrypt.chat is an OpenPGP.js implementation in chat room setting. It allows multiple people to connect, chat, draw on a whiteboard, and transfer files all through PGP encryption.

Try it live: https://pgp.sebastiancodes.online


## Features


## Recommendations

To use PGPencrypt chat securely, please run through TOR browser and use only on a 100% uncompromised clean install of a Linux based operating system, like Tails.

## Deployment

If  you plan on hosting your own server, run the server in node.js after installing dependancies. You will need to create a private key and public certificate for SSL. 

Otherwise just host the client through any web server. 

## Screenshot

![image](https://sebastiancodes.online/github/pgp.png)

## Secure WebSocket PGP Chat (Revised)

### Stack
Backend: Node.js + Express + Socket.io + MongoDB (Mongoose)  
Frontend: React (Vite) with OpenPGP.js (client‑side key generation & message crypto)  
Transport: WebSockets (end‑to‑end encryption at message layer)  

### Core Flow
1. User generates RSA 3072 key pair in browser (private key never leaves client).  
2. Private key is wrapped locally with AES‑GCM using PBKDF2 derived key from password (downloadable file).  
3. Registration sends only (username, publicKey). Server issues challenge.  
4. Client signs challenge with private key; server verifies and marks session as authenticated.  
5. Messages are OpenPGP encrypted (random symmetric key + recipient public key) wholly on client; server only stores armored blob.  
6. On reconnect, any queued encrypted messages are delivered (still encrypted end‑to‑end).  

### Repository Layout (added)
server/  -> Express + Socket.io + Mongo + Mongoose models
client-react/ -> Minimal React UI + crypto helpers

Legacy static client kept under `client/` (not used by new flow).

### Prerequisites
Node.js >= 18  
MongoDB running locally or Atlas URI  

### Setup
Copy environment file:
```
cp .env.example .env
```
Edit `.env` if using Atlas.

Install server deps:
```
cd server
npm install
```
Run server (dev with nodemon):
```
npm run dev
```
Server starts on PORT from env (default 42069).

Install frontend deps:
```
cd ../client-react
npm install
```
Run frontend:
```
npm run dev
```
Open the shown Vite URL (default http://localhost:5173).

### Using The App
1. Enter username + password, click Generate Keys.  
2. Download the encrypted key file (optional but recommended).  
3. Click Register to complete challenge signature.  
4. Select another online user and start chatting (messages appear after mutual registration).  
5. To reuse keys: choose password first, Load Key File, then Register.

### Security Notes
Private key never sent to server.  
Server stores only public keys + encrypted message blobs.  
Challenge prevents impersonation with mismatched keys.  
Password quality directly affects private key protection—use a strong passphrase.  

### Future Enhancements
* Add forward secrecy (X25519 ephemeral + double-ratchet) – outside current scope.  
* Add message signature verification per message (currently relies on transport identity).  
* Add file transfer via chunked encrypted blobs.  
* Add rate limiting and audit logging.  

### Legacy
The original `server/server.js` WebSocket & static client replaced by modular Express/Socket.io implementation.  

### License
MIT (add if desired).
[GPLv3](https://choosealicense.com/licenses/gpl-3.0/)

