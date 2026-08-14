const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
    },
    name: {
        type: String,
        default: 'My Room',
        trim: true,
        maxlength: 60,
    },
    creatorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    memberIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    }],
    language: {
        type: String,
        default: 'python',
        enum: ['python', 'cpp', 'java', 'javascript', 'c'],
    },
    lastCode: {
        type: String,
        default: '',
        maxlength: 100000,
    },
    activeMembers: {
        type: Number,
        default: 0,
        min: 0,
    },
    expiresAt: {
        type: Date,
        default: null,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    lastActiveAt: {
        type: Date,
        default: Date.now,
    },
});

roomSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
roomSchema.index({ code: 1 });
roomSchema.index({ creatorId: 1 });
roomSchema.index({ memberIds: 1 });

module.exports = mongoose.model('Room', roomSchema);
