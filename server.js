const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DATA_FILE = path.join(__dirname, 'registro_estudiantes.json');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'cambia-esto';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]\n', 'utf8');
  }
}

function readRegistros() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function writeRegistros(registros) {
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(registros, null, 2)}\n`, 'utf8');
}

function unauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'application/json; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="Registro privado"'
  });
  res.end(JSON.stringify({ error: 'No autorizado' }));
}

function isAuthorized(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  const encoded = authHeader.slice(6);
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) return false;

  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);
  return user === ADMIN_USER && pass === ADMIN_PASS;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Body demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStaticFile(reqPath, res) {
  const filePath = path.join(__dirname, reqPath === '/' ? 'index.html' : reqPath);
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acceso denegado');
    return;
  }

  fs.readFile(normalizedPath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Archivo no encontrado');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Error del servidor');
      }
      return;
    }

    const ext = path.extname(normalizedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && parsedUrl.pathname === '/api/registros') {
    try {
      const rawBody = await readBody(req);
      const payload = JSON.parse(rawBody || '{}');
      const codigo = String(payload.codigo || '').trim();
      const nombre = String(payload.nombre || '').trim();

      if (!/^\d{4,}$/.test(codigo) || nombre.length < 3) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Datos inválidos' }));
        return;
      }

      const registro = {
        codigo,
        nombre,
        fechaISO: payload.fechaISO || new Date().toISOString(),
        fechaLocal: payload.fechaLocal || new Date().toLocaleString('es-CO')
      };

      const registros = readRegistros();
      registros.push(registro);
      writeRegistros(registros);

      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'No se pudo procesar el registro' }));
    }
    return;
  }

  if (req.method === 'GET' && (parsedUrl.pathname === '/api/registros' || parsedUrl.pathname === '/api/registros/descargar')) {
    if (!isAuthorized(req)) {
      unauthorized(res);
      return;
    }

    try {
      const registros = readRegistros();
      const payload = `${JSON.stringify(registros, null, 2)}\n`;

      const headers = {
        'Content-Type': 'application/json; charset=utf-8'
      };

      if (parsedUrl.pathname === '/api/registros/descargar') {
        headers['Content-Disposition'] = 'attachment; filename="registro_estudiantes.json"';
      }

      res.writeHead(200, headers);
      res.end(payload);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'No se pudo leer el registro' }));
    }
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/admin') {
    serveStaticFile('/admin.html', res);
    return;
  }

  if (req.method === 'GET') {
    serveStaticFile(parsedUrl.pathname, res);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Método no permitido' }));
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor disponible en http://${HOST}:${PORT}`);
  console.log('Configura ADMIN_USER y ADMIN_PASS para proteger la descarga de registros.');
});
