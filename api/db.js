const fs = require('fs/promises');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');
const TMP_DB_PATH = path.join('/tmp', 'coa-ultra-db.json');

function defaultDb() {
    return {
        users: [{ username: 'kellie', password: 'kellie2004', role: 'admin', unit: 'System HQ' }],
        reports: [],
        inbox: [],
        audit: [],
        session: null
    };
}

async function readDb() {
    try {
        const tmpRaw = await fs.readFile(TMP_DB_PATH, 'utf8');
        return JSON.parse(tmpRaw);
    } catch (_err) {
        // No tmp snapshot yet; continue with repository file.
    }

    try {
        const raw = await fs.readFile(DB_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return defaultDb();
        return {
            users: Array.isArray(parsed.users) ? parsed.users : defaultDb().users,
            reports: Array.isArray(parsed.reports) ? parsed.reports : [],
            inbox: Array.isArray(parsed.inbox) ? parsed.inbox : [],
            audit: Array.isArray(parsed.audit) ? parsed.audit : [],
            session: parsed.session && typeof parsed.session === 'object' ? parsed.session : null
        };
    } catch (err) {
        if (err.code === 'ENOENT') {
            const seed = defaultDb();
            await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
            await fs.writeFile(DB_PATH, JSON.stringify(seed, null, 2));
            return seed;
        }
        throw err;
    }
}

async function writeDb(payload) {
    const next = {
        users: Array.isArray(payload?.users) ? payload.users : defaultDb().users,
        reports: Array.isArray(payload?.reports) ? payload.reports : [],
        inbox: Array.isArray(payload?.inbox) ? payload.inbox : [],
        audit: Array.isArray(payload?.audit) ? payload.audit : [],
        session: payload?.session && typeof payload.session === 'object' ? payload.session : null
    };
    try {
        await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
        await fs.writeFile(DB_PATH, JSON.stringify(next, null, 2));
    } catch (err) {
        if (err.code !== 'EROFS') throw err;
        // Vercel functions are read-only; fallback to /tmp for best-effort runtime persistence.
        await fs.writeFile(TMP_DB_PATH, JSON.stringify(next, null, 2));
    }
    return next;
}

module.exports = async (req, res) => {
    try {
        if (req.method === 'GET') {
            const data = await readDb();
            return res.status(200).json(data);
        }

        if (req.method === 'POST') {
            const saved = await writeDb(req.body || {});
            return res.status(200).json({ ok: true, data: saved });
        }

        res.setHeader('Allow', 'GET,POST');
        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: 'JSON database error', detail: String(err.message || err) });
    }
};
