const { createHash, randomBytes, scrypt: scryptCallback, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const http = require('node:http');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(scryptCallback);
const HOST = process.env.FIU_HOST || '127.0.0.1';
const PORT = Number(process.env.FIU_PORT || 3000);
const DATABASE_PATH = process.env.FIU_DB_PATH || path.join(__dirname, 'fiu.sqlite');
const configuredOrigins = process.env.FIU_ALLOWED_ORIGINS;
const allowedOrigins = configuredOrigins
    ? new Set(configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean))
    : null;
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_LIFETIME_MS = 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;
const ALLOWED_HEADERS = 'Content-Type, Authorization';
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        father_name TEXT NOT NULL,
        roll_number TEXT NOT NULL,
        contact TEXT NOT NULL,
        gmail TEXT NOT NULL,
        address TEXT NOT NULL,
        department TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, roll_number)
    );
    CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS password_resets_expiration_idx ON password_resets(expires_at);
`);

class ApiError extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function jsonResponse(response, status, data) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(data));
}

function emptyResponse(response, status = 204) {
    response.writeHead(status, { 'Cache-Control': 'no-store' });
    response.end();
}

function setCorsHeaders(request, response) {
    const origin = request.headers.origin;
    const isAllowedOrigin = allowedOrigins
        ? allowedOrigins.has(origin)
        : origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
    if (origin && isAllowedOrigin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
}

async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) {
            throw new ApiError(413, 'Request body is too large.');
        }
        chunks.push(chunk);
    }
    if (size === 0) return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new ApiError(400, 'Request body must be valid JSON.');
    }
}

function requireString(body, key, label = key) {
    if (typeof body[key] !== 'string' || !body[key].trim()) {
        throw new ApiError(400, `${label} is required.`);
    }
    return body[key].trim();
}

function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email };
}

async function createSession(userId) {
    const token = randomBytes(32).toString('base64url');
    database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
        hashToken(token),
        userId,
        Date.now() + SESSION_LIFETIME_MS
    );
    return token;
}

async function requireUser(request) {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '');
    if (!match) throw new ApiError(401, 'Please sign in to continue.');
    const session = database.prepare(`
        SELECT users.id, users.name, users.email, sessions.token_hash
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(match[1]), Date.now());
    if (!session) throw new ApiError(401, 'Your session has expired. Please sign in again.');
    return session;
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const derivedKey = await scrypt(password, salt, 64);
    return { salt, hash: derivedKey.toString('hex') };
}

function safeCompareHash(passwordHash, candidateHash) {
    const expected = Buffer.from(passwordHash, 'hex');
    const candidate = Buffer.from(candidateHash, 'hex');
    return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function studentFields(body) {
    const fields = {
        first_name: requireString(body, 'firstName', 'First name'),
        last_name: requireString(body, 'lastName', 'Last name'),
        father_name: requireString(body, 'fatherName', "Father's name"),
        roll_number: requireString(body, 'rollNumber', 'Roll number'),
        contact: requireString(body, 'contact', 'Contact'),
        gmail: requireString(body, 'gmail', 'Gmail address'),
        address: requireString(body, 'address', 'Address'),
        department: requireString(body, 'department', 'Department')
    };
    if (fields.gmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.gmail)) {
        throw new ApiError(400, 'Enter a valid student email address.');
    }
    return fields;
}

function publicStudent(student, viewerUserId) {
    return {
        id: student.id,
        firstName: student.first_name,
        lastName: student.last_name,
        fatherName: student.father_name,
        rollNumber: student.roll_number,
        contact: student.contact,
        gmail: student.gmail,
        address: student.address,
        department: student.department,
        canEdit: student.user_id === viewerUserId
    };
}

function studentById(id, userId) {
    return database.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(id, userId);
}

function sharedStudentById(id) {
    return database.prepare('SELECT * FROM students WHERE id = ?').get(id);
}

async function routeRequest(request, response) {
    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    const method = request.method;
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJsonBody(request) : {};

    if (method === 'GET' && url.pathname === '/health') {
        jsonResponse(response, 200, { status: 'ok', storage: 'sqlite' });
        return;
    }

    if (method === 'POST' && url.pathname === '/auth/signup') {
        const email = requireString(body, 'email', 'Email').toLowerCase();
        const password = requireString(body, 'password', 'Password');
        if (password.length < PASSWORD_MIN_LENGTH) {
            throw new ApiError(400, `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`);
        }
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new ApiError(400, 'Enter a valid email address.');
        }
        const credentials = await hashPassword(password);
        let result;
        try {
            result = database.prepare(`
                INSERT INTO users (name, email, password_hash, password_salt)
                VALUES (?, ?, ?, ?)
            `).run(typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '', email, credentials.hash, credentials.salt);
        } catch (error) {
            if (String(error.message).includes('UNIQUE')) throw new ApiError(409, 'An account with that email already exists.');
            throw error;
        }
        const user = database.prepare('SELECT id, name, email FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
        const accessToken = await createSession(user.id);
        jsonResponse(response, 201, { accessToken, user: publicUser(user) });
        return;
    }

    if (method === 'POST' && url.pathname === '/auth/signin') {
        const email = requireString(body, 'email', 'Email').toLowerCase();
        const password = requireString(body, 'password', 'Password');
        const user = database.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) throw new ApiError(404, 'No account was found for that email.', 'ACCOUNT_NOT_FOUND');
        const candidate = await hashPassword(password, user.password_salt);
        if (!safeCompareHash(user.password_hash, candidate.hash)) {
            throw new ApiError(401, 'Email or password is incorrect.');
        }
        const accessToken = await createSession(user.id);
        jsonResponse(response, 200, { accessToken, user: publicUser(user) });
        return;
    }

    if (method === 'POST' && url.pathname === '/auth/forgot-password') {
        const email = requireString(body, 'email', 'Email').toLowerCase();
        const user = database.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (user) {
            const token = randomBytes(32).toString('base64url');
            database.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
            database.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
                hashToken(token),
                user.id,
                Date.now() + RESET_LIFETIME_MS
            );
            let resetUrl;
            try {
                resetUrl = new URL(requireString(body, 'redirectUrl', 'Reset redirect URL'));
                resetUrl.searchParams.set('token', token);
            } catch (error) {
                if (error instanceof ApiError) throw error;
                throw new ApiError(400, 'Reset redirect URL is invalid.');
            }
            console.info(`Development password reset link for ${email}: ${resetUrl.href}`);
        }
        jsonResponse(response, 200, { message: 'If an account exists for that email, a reset link has been created.' });
        return;
    }

    if (method === 'POST' && url.pathname === '/auth/reset-password') {
        const token = requireString(body, 'token', 'Reset token');
        const password = requireString(body, 'password', 'Password');
        if (password.length < PASSWORD_MIN_LENGTH) {
            throw new ApiError(400, `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`);
        }
        const reset = database.prepare('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?')
            .get(hashToken(token), Date.now());
        if (!reset) throw new ApiError(400, 'This reset link is invalid or has expired.');
        const credentials = await hashPassword(password);
        database.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
            .run(credentials.hash, credentials.salt, reset.user_id);
        database.prepare('DELETE FROM password_resets WHERE user_id = ?').run(reset.user_id);
        database.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
        emptyResponse(response);
        return;
    }

    if (url.pathname.startsWith('/auth/')) {
        const user = await requireUser(request);
        if (method === 'POST' && url.pathname === '/auth/signout') {
            database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(user.token_hash);
            emptyResponse(response);
            return;
        }
    }

    const user = await requireUser(request);
    const studentIdMatch = /^\/students\/(\d+)$/.exec(url.pathname);

    if (method === 'GET' && url.pathname === '/students') {
        const rows = database.prepare('SELECT * FROM students ORDER BY id').all();
        jsonResponse(response, 200, rows.map((student) => publicStudent(student, user.id)));
        return;
    }

    if (method === 'GET' && studentIdMatch) {
        const student = sharedStudentById(Number(studentIdMatch[1]));
        if (!student) throw new ApiError(404, 'Student record not found.');
        jsonResponse(response, 200, publicStudent(student, user.id));
        return;
    }

    if (method === 'POST' && url.pathname === '/students') {
        const fields = studentFields(body);
        try {
            const result = database.prepare(`
                INSERT INTO students (
                    user_id, first_name, last_name, father_name, roll_number,
                    contact, gmail, address, department
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                user.id,
                fields.first_name,
                fields.last_name,
                fields.father_name,
                fields.roll_number,
                fields.contact,
                fields.gmail,
                fields.address,
                fields.department
            );
            jsonResponse(response, 201, publicStudent(studentById(Number(result.lastInsertRowid), user.id), user.id));
        } catch (error) {
            if (String(error.message).includes('UNIQUE')) {
                throw new ApiError(409, 'A student with that roll number already exists in your account.');
            }
            throw error;
        }
        return;
    }

    if (method === 'PUT' && studentIdMatch) {
        const fields = studentFields(body);
        const studentId = Number(studentIdMatch[1]);
        const existing = studentById(studentId, user.id);
        if (!existing) throw new ApiError(404, 'Student record not found.');
        try {
            database.prepare(`
                UPDATE students SET
                    first_name = ?, last_name = ?, father_name = ?, roll_number = ?,
                    contact = ?, gmail = ?, address = ?, department = ?
                WHERE id = ? AND user_id = ?
            `).run(
                fields.first_name,
                fields.last_name,
                fields.father_name,
                fields.roll_number,
                fields.contact,
                fields.gmail,
                fields.address,
                fields.department,
                studentId,
                user.id
            );
        } catch (error) {
            if (String(error.message).includes('UNIQUE')) {
                throw new ApiError(409, 'A student with that roll number already exists in your account.');
            }
            throw error;
        }
        jsonResponse(response, 200, publicStudent(studentById(studentId, user.id), user.id));
        return;
    }

    if (method === 'DELETE' && studentIdMatch) {
        const result = database.prepare('DELETE FROM students WHERE id = ? AND user_id = ?')
            .run(Number(studentIdMatch[1]), user.id);
        if (Number(result.changes) === 0) throw new ApiError(404, 'Student record not found.');
        emptyResponse(response);
        return;
    }

    throw new ApiError(404, 'API route not found.');
}

const server = http.createServer(async (request, response) => {
    setCorsHeaders(request, response);
    if (request.method === 'OPTIONS') {
        emptyResponse(response);
        return;
    }

    try {
        await routeRequest(request, response);
    } catch (error) {
        if (error instanceof ApiError) {
            jsonResponse(response, error.status, { error: error.message, code: error.code });
            return;
        }
        console.error('API request failed:', error);
        jsonResponse(response, 500, { error: 'Internal server error.' });
    }
});

server.on('error', (error) => {
    console.error(`Could not start API server on ${HOST}:${PORT}: ${error.message}`);
    database.close();
    process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
    console.log(`FIU API listening at http://${HOST}:${PORT}`);
    console.log(`SQLite database: ${DATABASE_PATH}`);
    console.log('Development note: password reset links are printed here; configure an email provider before production use.');
});

function closeServer() {
    server.close(() => {
        database.close();
        process.exit(0);
    });
}

process.on('SIGINT', closeServer);
process.on('SIGTERM', closeServer);
