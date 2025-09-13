const mongoose = require('mongoose');

const strokeSchema = new mongoose.Schema({
  points: [{
    x: Number,
    y: Number
  }],
  color: { type: String, default: '#000000' },
  size: { type: Number, default: 2 },
  tool: { type: String, enum: ['pen', 'eraser'], default: 'pen' },
  timestamp: { type: Date, default: Date.now }
});

const whiteboardSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true }, // combination of user1-user2
  participants: [{ type: String, required: true }], // usernames
  strokes: [strokeSchema],
  lastModified: { type: Date, default: Date.now }
});

// Update lastModified when strokes are modified
whiteboardSchema.pre('save', function(next) {
  this.lastModified = new Date();
  next();
});

// Create compound index for efficient queries
whiteboardSchema.index({ sessionId: 1, lastModified: -1 });

module.exports = mongoose.model('Whiteboard', whiteboardSchema);
