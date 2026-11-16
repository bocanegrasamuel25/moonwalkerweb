// Servidor de Moon Walker: registra usuarios en MySQL, les inicia sesión y les deja
// cambiar la contraseña con un enlace que llega al correo.
// Se enciende con node server.js y se abre en http://localhost:3000

require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const PUERTO = process.env.PORT || 3000;   // el hosting asigna el puerto en PORT; en tu computador es el 3000
// Dirección de la página para armar el enlace del correo. Render pone RENDER_EXTERNAL_URL solo;
// URL_PUBLICA sirve si algún día la página tiene otro dominio.
const URL_PAGINA = (process.env.URL_PUBLICA || process.env.RENDER_EXTERNAL_URL ||
                    "http://localhost:" + PUERTO).replace(/\/$/, "");
const MINUTOS_ENLACE = 30;   // tiempo que sirve el enlace del correo

const app = express();
app.use(express.json());
app.use(express.static("public"));   // html, css, js e imágenes de la página

// Para que la página también funcione si se abre con Live Server
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

// Conexión a MySQL (datos en el archivo .env)
// En tu computador basta con host, usuario, contraseña y base.
// En la nube (Aiven) también hay que poner DB_PORT y DB_SSL=true; con DB_CA además se verifica el certificado.
let ssl;
if (process.env.DB_CA) ssl = { ca: process.env.DB_CA.replace(/\\n/g, "\n") };
else if (process.env.DB_SSL === "true") ssl = { rejectUnauthorized: false };

const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl
});

// Registro
app.post("/registrar", async (req, res) => {
    const { nombre, correo, contrasena, fecha_nacimiento, rol, codigo } = req.body;

    if (!nombre || !correo || !contrasena || !fecha_nacimiento) {
        return res.status(400).json({ mensaje: "Todos los campos son obligatorios." });
    }
    if (contrasena.length < 8) {
        return res.status(400).json({ mensaje: "La contraseña debe tener al menos 8 caracteres." });
    }

    // Para ser fisioterapeuta hay que escribir el código del .env
    let rolFinal = "paciente";
    if (rol === "fisioterapeuta") {
        if (codigo !== process.env.CODIGO_FISIO) {
            return res.status(403).json({ mensaje: "El código de fisioterapeuta no es correcto." });
        }
        rolFinal = "fisioterapeuta";
    }

    try {
        const hash = await bcrypt.hash(contrasena, 12);   // en la base solo queda el hash
        await db.execute(
            "INSERT INTO usuarios (nombre, correo, contrasena_hash, fecha_nacimiento, rol) VALUES (?, ?, ?, ?, ?)",
            [nombre.trim(), correo.trim().toLowerCase(), hash, fecha_nacimiento, rolFinal]
        );
        res.status(201).json({ mensaje: "Usuario registrado correctamente." });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ mensaje: "Este correo ya está registrado." });
        }
        console.error("Error en MySQL:", error.message);
        res.status(500).json({ mensaje: "Error en la base de datos. Mira la terminal del servidor." });
    }
});

// Inicio de sesión
app.post("/login", async (req, res) => {
    const { correo, contrasena } = req.body;
    try {
        const [filas] = await db.execute(
            "SELECT id, nombre, rol, contrasena_hash FROM usuarios WHERE correo = ?",
            [String(correo).trim().toLowerCase()]
        );
        const u = filas[0];
        if (!u || !(await bcrypt.compare(String(contrasena), u.contrasena_hash))) {
            return res.status(401).json({ mensaje: "Correo o contraseña incorrectos." });
        }
        res.json({
            mensaje: "Sesión iniciada.",
            usuario: { id: u.id, nombre: u.nombre, rol: u.rol, correo: String(correo).trim().toLowerCase() }
        });
    } catch (error) {
        console.error("Error en MySQL:", error.message);
        res.status(500).json({ mensaje: "Error en la base de datos. Mira la terminal del servidor." });
    }
});

// ---- Cambiar la contraseña con un enlace por correo ----
// 1. /olvide crea un código aleatorio, guarda su hash en la tabla recuperaciones y manda el enlace.
// 2. /restablecer recibe el código del enlace y la contraseña nueva, y cambia el hash en usuarios.
// En la base solo queda el hash del código: quien lea la tabla no puede armar un enlace válido.

function hashDelCodigo(codigo) {
    return crypto.createHash("sha256").update(codigo).digest("hex");
}

// Evita que un nombre con < o > se interprete como HTML dentro del correo
function textoSeguro(texto) {
    return String(texto).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Envía el correo con la API de Brevo (por HTTPS: Render gratis bloquea los puertos de correo SMTP).
// Sin BREVO_API_KEY, por ejemplo en tu computador, el enlace solo se escribe en la terminal.
async function enviarCorreo(para, nombre, enlace) {
    const asunto = "Cambia tu contraseña de Moon Walker";
    const texto = `Hola ${nombre}:\n\nPediste cambiar tu contraseña de Moon Walker. Abre este enlace ` +
        `(sirve una sola vez durante ${MINUTOS_ENLACE} minutos):\n\n${enlace}\n\n` +
        "Si no lo pediste, ignora este correo y tu contraseña seguirá igual.";

    if (!process.env.BREVO_API_KEY) {
        console.log(`[correo sin enviar, falta BREVO_API_KEY] Para ${para}: ${enlace}`);
        return;
    }

    const html = `
        <div style="font-family:Arial,sans-serif;font-size:16px;color:#1d2545;max-width:520px">
            <h2 style="margin:0 0 12px">Moon Walker</h2>
            <p>Hola ${textoSeguro(nombre)}:</p>
            <p>Pediste cambiar tu contraseña. Haz clic en el botón para escoger una nueva.</p>
            <p style="margin:24px 0">
                <a href="${enlace}" style="background:#3a56c4;color:#fff;padding:12px 20px;border-radius:10px;
                   text-decoration:none;font-weight:bold">Cambiar contraseña</a>
            </p>
            <p style="color:#566080;font-size:14px">El enlace sirve una sola vez durante ${MINUTOS_ENLACE} minutos.
               Si no lo pediste, ignora este correo y tu contraseña seguirá igual.</p>
        </div>`;

    const respuesta = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
            "api-key": process.env.BREVO_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify({
            sender: { name: "Moon Walker", email: process.env.CORREO_REMITENTE },
            to: [{ email: para, name: nombre }],
            subject: asunto,
            htmlContent: html,
            textContent: texto
        })
    });
    if (!respuesta.ok) {
        throw new Error("Brevo respondió " + respuesta.status + ": " + (await respuesta.text()));
    }
}

app.post("/olvide", async (req, res) => {
    const correo = String(req.body.correo || "").trim().toLowerCase();
    if (!correo) return res.status(400).json({ mensaje: "Escribe tu correo electrónico." });

    // Siempre se responde lo mismo, exista o no la cuenta, para no revelar qué correos están registrados
    const respuestaFija = {
        mensaje: "Si ese correo tiene una cuenta, te enviamos un enlace para cambiar la contraseña. " +
                 "Revisa también la carpeta de spam."
    };

    try {
        const [filas] = await db.execute("SELECT id, nombre FROM usuarios WHERE correo = ?", [correo]);
        const u = filas[0];
        if (!u) return res.json(respuestaFija);

        // Máximo un correo por minuto para la misma cuenta
        const [recientes] = await db.execute(
            "SELECT id FROM recuperaciones WHERE usuario_id = ? AND creado_en > NOW() - INTERVAL 1 MINUTE",
            [u.id]
        );
        if (recientes.length > 0) return res.json(respuestaFija);

        // Un enlace nuevo reemplaza a los anteriores
        const codigo = crypto.randomBytes(32).toString("hex");
        await db.execute("DELETE FROM recuperaciones WHERE usuario_id = ?", [u.id]);
        await db.execute(
            `INSERT INTO recuperaciones (usuario_id, codigo_hash, expira)
             VALUES (?, ?, NOW() + INTERVAL ${MINUTOS_ENLACE} MINUTE)`,
            [u.id, hashDelCodigo(codigo)]
        );

        try {
            await enviarCorreo(correo, u.nombre, `${URL_PAGINA}/restablecer.html?codigo=${codigo}`);
        } catch (error) {
            // Si el correo no salió, se borra el código para que la persona pueda volver a intentar ya
            await db.execute("DELETE FROM recuperaciones WHERE usuario_id = ?", [u.id]);
            throw error;
        }
        res.json(respuestaFija);
    } catch (error) {
        console.error("Error al enviar el enlace:", error.message);
        res.status(500).json({ mensaje: "No se pudo enviar el correo. Intenta de nuevo en unos minutos." });
    }
});

app.post("/restablecer", async (req, res) => {
    const codigo = String(req.body.codigo || "");
    const contrasena = String(req.body.contrasena || "");

    if (contrasena.length < 8) {
        return res.status(400).json({ mensaje: "La contraseña debe tener al menos 8 caracteres." });
    }

    try {
        const [filas] = await db.execute(
            "SELECT usuario_id FROM recuperaciones WHERE codigo_hash = ? AND expira > NOW()",
            [hashDelCodigo(codigo)]
        );
        if (!filas[0]) {
            return res.status(400).json({ mensaje: "El enlace no es válido o ya venció. Pide uno nuevo." });
        }
        const usuarioId = filas[0].usuario_id;

        const hash = await bcrypt.hash(contrasena, 12);
        await db.execute("UPDATE usuarios SET contrasena_hash = ? WHERE id = ?", [hash, usuarioId]);
        await db.execute("DELETE FROM recuperaciones WHERE usuario_id = ?", [usuarioId]);   // el enlace sirve una vez
        res.json({ mensaje: "Contraseña actualizada. Ya puedes iniciar sesión con la nueva." });
    } catch (error) {
        console.error("Error al cambiar la contraseña:", error.message);
        res.status(500).json({ mensaje: "Error en la base de datos. Mira la terminal del servidor." });
    }
});

// Arranque: se conecta a MySQL y crea las tablas si todavía no existen (igual que moonwalker.sql)
db.query(`CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    correo VARCHAR(150) NOT NULL UNIQUE,
    contrasena_hash VARCHAR(255) NOT NULL,
    fecha_nacimiento DATE NOT NULL,
    rol ENUM('paciente','fisioterapeuta') NOT NULL DEFAULT 'paciente',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`)
    .then(() => db.query(`CREATE TABLE IF NOT EXISTS recuperaciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    codigo_hash CHAR(64) NOT NULL UNIQUE,
    expira DATETIME NOT NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
)`))
    .then(() => {
        app.listen(PUERTO, () => console.log("Servidor activo en el puerto " + PUERTO));
        if (!process.env.BREVO_API_KEY) console.log("Sin BREVO_API_KEY: los enlaces para cambiar contraseña salen aquí en la terminal");
    })
    .catch((error) => {
        // Algunos errores de conexión llegan sin mensaje; el código (ETIMEDOUT, ER_ACCESS_DENIED_ERROR...) dice la causa
        console.error("No se pudo conectar con MySQL:", error.code || "", error.message || error);
        console.error("Intentando con host", process.env.DB_HOST, "puerto", Number(process.env.DB_PORT) || 3306,
                      "base", process.env.DB_NAME, "SSL", ssl ? "sí" : "no");
        console.error("Revisa que MySQL esté encendido, que la base DB_NAME exista y los datos del .env");
    });
