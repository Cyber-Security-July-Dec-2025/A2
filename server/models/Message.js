const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
	from: { type: String, required: true, index: true },
	to: { type: String, required: true, index: true },
	// Entire encrypted blob (OpenPGP armored message containing encrypted AES key + ciphertext)
	armored: { type: String, required: true },
	// Optional type metadata (e.g., chat, file) kept plaintext for filtering if needed
	type: { type: String, default: 'chat' },
	delivered: { type: Boolean, default: false },
	read: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Message', MessageSchema);
