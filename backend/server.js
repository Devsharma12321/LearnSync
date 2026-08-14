require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('./models/User');
const Room = require('./models/Room');

const app = express();
const server = http.createServer(app);

// ============================================================
// CORS — allow Netlify frontend + local dev with credentials
// ============================================================
const ALLOWED_ORIGINS = [
  'https://learnsync-9nyy.onrender.com',   // Render (self)
  'http://localhost:3000',                  // local dev
  'http://127.0.0.1:3000',
  // TODO: Replace with your actual Netlify URL after deploy
  // e.g. 'https://learnsync.netlify.app'
];
// Accept any *.netlify.app subdomain automatically
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes(origin) || /\.netlify\.app$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const io = new Server(server, {
    cors: {
        origin: (origin, cb) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin) || /\.netlify\.app$/.test(origin)) {
                cb(null, true);
            } else {
                cb(new Error('Not allowed by CORS'));
            }
        },
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB successfully');
    // Run the orphaned-room sweep immediately after DB is ready,
    // then again every 5 minutes. Doing it here (not inside server.listen)
    // guarantees Mongoose is fully connected before the first query fires.
    await sweepOrphanedRooms();
    setInterval(sweepOrphanedRooms, 5 * 60 * 1000);
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Global Middlewares
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate Limiter for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
const requireAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.redirect('/login.html');
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/login.html');
    }
};

const requireAuthAPI = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.status(401).json({ error: 'Session expired.' });
    }
};

const redirectIfAuth = (req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            return res.redirect('/dashboard.html');
        } catch (err) {
            res.clearCookie('token');
        }
    }
    next();
};

// ============================================================
// STATIC FILE ROUTES
// ============================================================
app.get('/login.html', redirectIfAuth, (req, res) => res.sendFile(path.join(__dirname, '../login.html')));
app.get('/register.html', redirectIfAuth, (req, res) => res.sendFile(path.join(__dirname, '../register.html')));
app.get('/dashboard.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, '../dashboard.html')));
app.get('/editor.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, '../editor.html')));
app.get('/editor', requireAuth, (req, res) => res.sendFile(path.join(__dirname, '../editor.html')));
app.get('/quiz.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, '../quiz.html')));
app.get('/whiteboard.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, '../whiteboard.html')));
app.use(express.static(path.join(__dirname, '../')));

// ============================================================
// AUTH API
// ============================================================
app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;
        if (!firstName || !email || !password)
            return res.status(400).json({ error: 'First name, email, and password are required.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ error: 'Please enter a valid email address.' });
        if (password.length < 8)
            return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        if (!(/[A-Z]/.test(password)) || !(/[0-9]/.test(password)) || !(/[^A-Za-z0-9]/.test(password)))
            return res.status(400).json({ error: 'Password must contain uppercase letters, numbers, and special characters.' });
        if (await User.findOne({ email }))
            return res.status(400).json({ error: 'An account with this email address already exists.' });
        const user = new User({ firstName, lastName: lastName || '', email, password });
        await user.save();
        const token = jwt.sign(
            { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName },
            process.env.JWT_SECRET, { expiresIn: '1d' }
        );
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 86400000 });
        res.status(201).json({ success: true, user: { firstName: user.firstName, lastName: user.lastName, email: user.email } });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Server error during registration. Please try again.' });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password are required.' });
        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password)))
            return res.status(400).json({ error: 'Invalid email or password.' });
        const token = jwt.sign(
            { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName },
            process.env.JWT_SECRET, { expiresIn: '1d' }
        );
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 86400000 });
        res.status(200).json({ success: true, user: { firstName: user.firstName, lastName: user.lastName, email: user.email } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login. Please try again.' });
    }
});

app.post('/api/auth/demo', async (req, res) => {
    try {
        let user = await User.findOne({ email: 'demo@syncspace.app' });
        if (!user) {
            user = new User({ firstName: 'Demo', lastName: 'User', email: 'demo@syncspace.app', password: 'DemoPassword123!' });
            await user.save();
        }
        const token = jwt.sign(
            { id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName },
            process.env.JWT_SECRET, { expiresIn: '1d' }
        );
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 86400000 });
        res.status(200).json({ success: true, user: { firstName: user.firstName, lastName: user.lastName, email: user.email } });
    } catch (err) {
        console.error('Demo login error:', err);
        res.status(500).json({ error: 'Server error during demo login.' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token');
    res.status(200).json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/auth/me', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.status(200).json({ success: true, user: { firstName: decoded.firstName, lastName: decoded.lastName, email: decoded.email } });
    } catch (err) {
        res.clearCookie('token');
        res.status(401).json({ error: 'Session expired.' });
    }
});

// ============================================================
// ROOM API
// ============================================================

// Generate a unique room code
function generateCode() {
    return Math.random().toString(36).slice(2, 6).toUpperCase() +
           Math.random().toString(36).slice(2, 6).toUpperCase();
}

// POST /api/rooms/create â€” create a new room, save to DB
app.post('/api/rooms/create', requireAuthAPI, async (req, res) => {
    try {
        const { name, language } = req.body;
        let code;
        let attempts = 0;
        // Generate a unique code
        do {
            code = generateCode();
            attempts++;
        } while ((await Room.findOne({ code })) && attempts < 10);

        const room = new Room({
            code,
            name: name || 'My Room',
            creatorId: req.user.id,
            memberIds: [req.user.id],
            language: language || 'python',
            activeMembers: 0,
        });
        await room.save();
        res.status(201).json({ success: true, room: { code: room.code, name: room.name, language: room.language } });
    } catch (err) {
        console.error('Room create error:', err);
        res.status(500).json({ error: 'Failed to create room.' });
    }
});

// GET /api/rooms/mine â€” rooms the authenticated user created or joined
app.get('/api/rooms/mine', requireAuthAPI, async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);
        const rooms = await Room.find({
            $or: [{ creatorId: userId }, { memberIds: userId }],
            expiresAt: null // only show rooms that haven't been set to expire (i.e. currently alive or with active members)
        })
        .sort({ lastActiveAt: -1 })
        .limit(20)
        .select('code name language activeMembers createdAt lastActiveAt creatorId');

        res.status(200).json({ success: true, rooms });
    } catch (err) {
        console.error('Rooms fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch rooms.' });
    }
});

// GET /api/rooms/:code â€” get room info by code
app.get('/api/rooms/:code', requireAuthAPI, async (req, res) => {
    try {
        const room = await Room.findOne({ code: req.params.code.toUpperCase() });
        if (!room) return res.status(404).json({ error: 'Room not found or has expired.' });
        res.status(200).json({ success: true, room: { code: room.code, name: room.name, language: room.language, activeMembers: room.activeMembers } });
    } catch (err) {
        console.error('Room lookup error:', err);
        res.status(500).json({ error: 'Failed to look up room.' });
    }
});

// ============================================================
// TURN CREDENTIALS API (Metered — Dynamic Short-Lived Tokens)
// ============================================================
// WHY THIS EXISTS:
//   Metered's REST API lets us generate TURN credentials on demand.
//   Those credentials expire after a short window (default ~1 day, but
//   we never send our *master* API key to the browser — only the
//   temporary username/credential pair that Metered issues.
//
// HOW IT WORKS:
//   1. Browser (authenticated user) calls GET /api/rtc-credentials.
//   2. This route calls Metered's API server-to-server using METERED_API_KEY
//      from .env — the key is NEVER sent to the client.
//   3. Metered responds with a list of iceServers including short-lived
//      TURN credentials (username = timestamp:randomId, credential = HMAC).
//   4. We forward just that iceServers array to the browser.
//   5. Browser builds its RTCPeerConnection with those temp credentials.
//
// SECURITY PROPERTIES:
//   - The master API key stays on the server (in process.env).
//   - Only authenticated users (valid JWT cookie) can call this route.
//   - Even if someone intercepts the response, they get credentials that
//     expire and cannot be used to access the Metered dashboard or billing.

app.get('/api/rtc-credentials', requireAuthAPI, async (req, res) => {
    const apiKey = process.env.METERED_API_KEY;
    if (!apiKey || apiKey === 'YOUR_METERED_API_KEY_HERE') {
        // Graceful degradation: if key is not set, return Google STUN only.
        // WebRTC will still work on most networks without TURN.
        console.warn('[TURN] METERED_API_KEY is not set — returning STUN-only config.');
        return res.status(200).json({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
    }

    try {
        // Call Metered's REST API server-to-server.
        // The API key travels only over this private server→Metered TLS connection.
        const meteredRes = await new Promise((resolve, reject) => {
            const https = require('https');
            const options = {
                hostname: 'devsharmalearnsync.metered.live',
                path: `/api/v1/turn/credentials?apiKey=${apiKey}`,
                method: 'GET',
            };
            const reqH = https.request(options, (resp) => {
                let body = '';
                resp.on('data', chunk => body += chunk);
                resp.on('end', () => {
                    try { resolve(JSON.parse(body)); }
                    catch (e) { reject(new Error('Invalid Metered response')); }
                });
            });
            reqH.on('error', reject);
            reqH.setTimeout(5000, () => { reqH.destroy(); reject(new Error('Metered timeout')); });
            reqH.end();
        });

        // Metered returns an array of ICE server objects directly.
        // We prepend Google STUN so direct P2P is always attempted first.
        const iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            ...meteredRes
        ];

        // Cache headers: allow browser to reuse for 60s, but revalidate often.
        // Metered credentials are valid for much longer, but we keep TTL short
        // to rotate credentials if the user keeps a tab open for days.
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.status(200).json({ iceServers });

    } catch (err) {
        console.error('[TURN] Failed to fetch Metered credentials:', err.message);
        // Fallback: STUN-only — better than crashing the entire WebRTC setup.
        res.status(200).json({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
    }
});

// ============================================================
// CODE EXECUTION API (Piston)
// ============================================================
const PISTON_LANG_MAP = {
    python:     { language: 'python',     version: '3.10.0' },
    cpp:        { language: 'c++',        version: '10.2.0' },
    java:       { language: 'java',       version: '15.0.2' },
    javascript: { language: 'javascript', version: '18.15.0' },
    c:          { language: 'c',          version: '10.2.0' },
};

app.post('/api/execute', requireAuthAPI, async (req, res) => {
    const { code, language, stdin } = req.body;
    if (!code || !language) return res.status(400).json({ error: 'Code and language are required.' });

    const pistonLang = PISTON_LANG_MAP[language];
    if (!pistonLang) return res.status(400).json({ error: `Unsupported language: ${language}` });

    const payload = JSON.stringify({
        language: pistonLang.language,
        version: pistonLang.version,
        files: [{ name: 'main', content: code }],
        stdin: stdin || '',
        compile_timeout: 10000,
        run_timeout: 5000,
    });

    try {
        const data = await new Promise((resolve, reject) => {
            const https = require('https');
            const options = {
                hostname: 'emkc.org',
                path: '/api/v2/piston/execute',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
            };
            const reqHttp = https.request(options, (resp) => {
                let body = '';
                resp.on('data', chunk => body += chunk);
                resp.on('end', () => {
                    try { resolve(JSON.parse(body)); }
                    catch (e) { reject(new Error('Invalid Piston response')); }
                });
            });
            reqHttp.on('error', reject);
            reqHttp.setTimeout(15000, () => { reqHttp.destroy(); reject(new Error('Piston timeout')); });
            reqHttp.write(payload);
            reqHttp.end();
        });

        res.status(200).json({
            success: true,
            run: {
                stdout: data.run?.stdout || '',
                stderr: data.run?.stderr || '',
                code: data.run?.code,
                signal: data.run?.signal,
            },
            compile: data.compile ? {
                stdout: data.compile.stdout || '',
                stderr: data.compile.stderr || '',
                code: data.compile.code,
            } : null,
        });
    } catch (err) {
        console.error('Execute error:', err);
        res.status(500).json({ error: 'Failed to execute code: ' + err.message });
    }
});

// ============================================================
// SOCKET.IO HELPERS
// ============================================================
function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        if (!value) return;
        list[name] = decodeURIComponent(value);
    });
    return list;
}

// Socket auth middleware
io.use((socket, next) => {
    try {
        const cookieHeader = socket.handshake.headers.cookie;
        const cookies = parseCookies(cookieHeader);
        const token = cookies.token;
        if (!token) return next(new Error('Authentication error: No token provided'));
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.user = decoded;
        next();
    } catch (err) {
        next(new Error('Authentication error: Invalid token'));
    }
});

// â”€â”€ Room session timers (roomCode -> setTimeout handle) â”€â”€
// When the last person leaves a room, we start a 5-min timer.
// If someone rejoins, we cancel the timer.
const roomExpiryTimers = {};
const ROOM_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

// Track which room each socket is in (socketId -> roomCode)
const socketRoomMap = {};

async function onMemberJoin(roomCode, userId) {
    // Cancel any pending expiry timer for this room
    if (roomExpiryTimers[roomCode]) {
        clearTimeout(roomExpiryTimers[roomCode]);
        delete roomExpiryTimers[roomCode];
    }
    // Increment activeMembers, clear expiresAt, update lastActiveAt, add member
    await Room.findOneAndUpdate(
        { code: roomCode },
        {
            $inc: { activeMembers: 1 },
            $set: { expiresAt: null, lastActiveAt: new Date() },
            $addToSet: { memberIds: userId }
        }
    );
}

async function onMemberLeave(roomCode) {
    const room = await Room.findOneAndUpdate(
        { code: roomCode, activeMembers: { $gt: 0 } },
        { $inc: { activeMembers: -1 }, $set: { lastActiveAt: new Date() } },
        { returnDocument: 'after' }
    );
    if (!room) return;

    if (room.activeMembers <= 0) {
        // Last person left â€” start the 5-min expiry countdown
        const timer = setTimeout(async () => {
            try {
                await Room.findOneAndUpdate(
                    { code: roomCode },
                    { $set: { expiresAt: new Date() } }
                );
                console.log(`Room ${roomCode} marked as expired (15-min timeout).`);
            } catch (e) {
                console.error('Room expiry error:', e);
            }
            delete roomExpiryTimers[roomCode];
        }, ROOM_EXPIRY_MS);
        roomExpiryTimers[roomCode] = timer;
        console.log(`Room ${roomCode} empty — will expire in 15 minutes if nobody rejoins.`);
    }
}

// ============================================================
// SOCKET.IO EVENTS
// ============================================================
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id} (${socket.user?.email || 'Unknown'})`);

    // Join a room
    socket.on('join-room', async (roomCode) => {
        const code = String(roomCode).toUpperCase();

        // â”€â”€ Capacity check â”€â”€
        const MAX_ROOM_USERS = 4;
        const existingClients = io.sockets.adapter.rooms.get(code);
        if (existingClients && existingClients.size >= MAX_ROOM_USERS) {
            socket.emit('room-full', { code, max: MAX_ROOM_USERS });
            console.log(`Room ${code} is full (${existingClients.size}/${MAX_ROOM_USERS}) â€” rejected ${socket.id}`);
            return;
        }

        socket.join(code);
        socketRoomMap[socket.id] = code;
        console.log(`User ${socket.id} joined room ${code}`);

        // DB: increment members, cancel expiry
        try {
            await onMemberJoin(code, socket.user?.id);
        } catch (e) {
            console.error('DB join error:', e);
        }

        // Send current room user list to the joining user
        const clients = io.sockets.adapter.rooms.get(code);
        const clientList = clients ? Array.from(clients).map(id => {
            const sock = io.sockets.sockets.get(id);
            const name = sock?.user ? `${sock.user.firstName} ${sock.user.lastName || ''}`.trim() : 'Guest';
            return { id, name };
        }) : [];
        socket.emit('room-users', clientList);

        // Notify others
        const userName = socket.user ? `${socket.user.firstName} ${socket.user.lastName || ''}`.trim() : 'Guest';
        socket.to(code).emit('user-joined', { id: socket.id, name: userName });
    });

    // WebRTC Signaling
    socket.on('offer', (payload) => {
        io.to(payload.target).emit('offer', { caller: socket.id, sdp: payload.sdp });
    });
    socket.on('answer', (payload) => {
        io.to(payload.target).emit('answer', { caller: socket.id, sdp: payload.sdp });
    });
    socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', { caller: socket.id, candidate: payload.candidate });
    });
    socket.on('screen-share-status', (payload) => {
        socket.to(payload.roomId).emit('screen-share-status', { caller: socket.id, isSharing: payload.isSharing });
    });

    // Mic
    socket.on('mic-status', (payload) => {
        socket.to(payload.roomId).emit('mic-status', { caller: socket.id, active: payload.active });
    });
    socket.on('mic-block', (payload) => {
        io.to(payload.targetId).emit('mic-blocked', { by: socket.id });
        io.to(payload.roomId).emit('mic-block-announce', { targetId: payload.targetId, by: socket.id });
    });
    socket.on('mic-unblock', (payload) => {
        io.to(payload.targetId).emit('mic-unblocked', { by: socket.id });
        io.to(payload.roomId).emit('mic-unblock-announce', { targetId: payload.targetId, by: socket.id });
    });

    // Editor Sync
    socket.on('share-mode-change', (payload) => {
        socket.to(payload.roomId).emit('share-mode-change', { caller: socket.id, mode: payload.mode });
    });
    socket.on('code-update', async (payload) => {
        // Build the outbound relay packet:
        // - Always forward caller + lang so the receiver can update language state.
        // - Forward either `changes` (delta path) or `code` (full-doc path), never both.
        const relay = { caller: socket.id, lang: payload.lang };

        if (payload.changes) {
            // Delta path — tiny binary-style payload, just relay it.
            relay.changes = payload.changes;
            socket.to(payload.roomId).emit('code-update', relay);
            // No DB write: the server doesn't reconstruct the full doc from deltas.
            // A full snapshot arrives on the next language-change / join / clear event.
        } else if (payload.code !== undefined) {
            // Full-document path — relay and persist to DB as a snapshot.
            relay.code = payload.code;
            socket.to(payload.roomId).emit('code-update', relay);
            try {
                await Room.findOneAndUpdate(
                    { code: payload.roomId },
                    { $set: { lastCode: payload.code, language: payload.lang, lastActiveAt: new Date() } }
                );
            } catch (e) { /* non-critical */ }
        }
    });
    socket.on('peer-code-edit', (payload) => {
        // Forward either delta changes or full-doc code (legacy fallback).
        const relay = { caller: socket.id };
        if (payload.changes)          relay.changes = payload.changes;
        else if (payload.code !== undefined) relay.code = payload.code;
        io.to(payload.target).emit('peer-code-edit', relay);
    });

    // Whiteboard Sync
    socket.on('wb-mode-change', (payload) => {
        socket.to(payload.roomId).emit('wb-mode-change', { caller: socket.id, mode: payload.mode });
    });
    socket.on('wb-draw', (payload) => {
        socket.to(payload.roomId).emit('wb-draw', { caller: socket.id, ...payload });
    });
    socket.on('wb-clear', (payload) => {
        socket.to(payload.roomId).emit('wb-clear', { caller: socket.id });
    });
    socket.on('wb-undo', (payload) => {
        socket.to(payload.roomId).emit('wb-undo', { caller: socket.id });
    });
    socket.on('request-wb-state', (payload) => {
        socket.to(payload.roomId).emit('request-wb-state', { requester: socket.id });
    });
    socket.on('wb-state', (payload) => {
        io.to(payload.requester).emit('wb-state', payload);
    });

    // â”€â”€ In-room text chat â”€â”€
    socket.on('chat-message', (payload) => {
        const roomCode = payload.roomId;
        if (!roomCode) return;
        const senderName = socket.user
            ? `${socket.user.firstName} ${socket.user.lastName || ''}`.trim()
            : 'Guest';
        io.to(roomCode).emit('chat-message', {
            senderId: socket.id,
            senderName,
            text: String(payload.text || '').slice(0, 500), // cap at 500 chars
            timestamp: Date.now(),
        });
    });

    // Disconnect
    socket.on('disconnect', async () => {
        console.log(`User disconnected: ${socket.id}`);
        socket.broadcast.emit('user-left', socket.id);

        // DB: decrement members, start expiry timer if empty
        const roomCode = socketRoomMap[socket.id];
        if (roomCode) {
            delete socketRoomMap[socket.id];
            try {
                await onMemberLeave(roomCode);
            } catch (e) {
                console.error('DB leave error:', e);
            }
        }
    });
});

// ============================================================
// ORPHANED ROOM CLEANUP
// ============================================================
// WHY THIS IS NEEDED:
//   The in-memory roomExpiryTimers{} object is wiped every time the server
//   restarts. Any room that was empty when the server went down never had its
//   expiresAt field set, so MongoDB's TTL index never deleted it — those rooms
//   stay in the DB (and on the dashboard) forever.
//
// HOW IT WORKS:
//   We query for rooms where:
//     • activeMembers === 0   (nobody is in the room)
//     • expiresAt === null    (not yet scheduled for deletion)
//     • lastActiveAt < (now - 15 min)  (inactive long enough to be expired)
//   We set expiresAt = now on all matching rooms. MongoDB's TTL index then
//   deletes them automatically (usually within 60 seconds).
//
// WHEN IT RUNS:
//   1. Once at startup — cleans up rooms orphaned by the previous server run.
//   2. Every 5 minutes — catches any rooms that slip through (edge cases).

async function sweepOrphanedRooms() {
    try {
        const cutoff = new Date(Date.now() - ROOM_EXPIRY_MS);
        // WHY no activeMembers filter:
        //   When a server is killed (Ctrl+C, crash, restart), socket disconnect
        //   handlers never fire, so activeMembers stays at whatever count it was.
        //   Those rooms are stuck with activeMembers > 0 forever even though
        //   nobody is actually in them. We trust lastActiveAt alone — if the room
        //   hasn't had any activity in 15+ minutes, it is dead regardless of count.
        const result = await Room.updateMany(
            {
                expiresAt: null,
                lastActiveAt: { $lt: cutoff }
            },
            {
                $set: {
                    expiresAt: new Date(),
                    activeMembers: 0   // reset stuck counts left by server crashes
                }
            }
        );
        if (result.modifiedCount > 0) {
            console.log(`[Cleanup] Marked ${result.modifiedCount} orphaned room(s) as expired.`);
        } else {
            console.log('[Cleanup] No orphaned rooms found.');
        }
    } catch (err) {
        console.error('[Cleanup] Orphaned room sweep failed:', err.message);
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`SyncSpace server listening on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to get started.`);
});

