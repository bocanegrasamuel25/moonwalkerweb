// Servidor de Moon Walker: registra usuarios en MySQL, les inicia sesión, les deja
// cambiar la contraseña con un enlace que llega al correo y muestra el dashboard
// con los datos del caminador que lee de ThingsBoard.
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
app.set("trust proxy", 1);   // Render atiende por HTTPS delante del servidor: así se sabe que la conexión es segura
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

// ---- Sesión ----
// Al iniciar sesión el servidor entrega una cookie firmada con SESSION_SECRET: el navegador no la puede
// leer ni modificar, y sin ella no se pueden pedir los datos del caminador. Como va firmada (no guardada en
// memoria), la sesión sigue valiendo aunque Render apague y vuelva a encender el servidor.
const SECRETO = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const HORAS_SESION = 8;

function firma(texto) {
    return crypto.createHmac("sha256", SECRETO).update(texto).digest("base64url");
}

function ponerSesion(req, res, usuario) {
    const cuerpo = Buffer.from(JSON.stringify({ ...usuario, exp: Date.now() + HORAS_SESION * 3600e3 })).toString("base64url");
    res.setHeader("Set-Cookie", `mw_sesion=${cuerpo}.${firma(cuerpo)}; Path=/; HttpOnly; SameSite=Lax; ` +
        `Max-Age=${HORAS_SESION * 3600}${req.secure ? "; Secure" : ""}`);
}

function leerSesion(req) {
    const galleta = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith("mw_sesion="));
    if (!galleta) return null;
    const [cuerpo, firmaRecibida = ""] = galleta.slice("mw_sesion=".length).split(".");
    const esperada = firma(cuerpo);
    if (firmaRecibida.length !== esperada.length ||
        !crypto.timingSafeEqual(Buffer.from(firmaRecibida), Buffer.from(esperada))) return null;
    try {
        const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
        return datos.exp > Date.now() ? datos : null;
    } catch {
        return null;
    }
}

function requiereSesion(req, res, next) {
    req.usuario = leerSesion(req);
    if (!req.usuario) return res.status(401).json({ mensaje: "Tu sesión terminó. Vuelve a iniciar sesión." });
    next();
}

function soloFisio(req, res, next) {
    if (req.usuario.rol !== "fisioterapeuta") {
        return res.status(403).json({ mensaje: "Esta opción es solo para fisioterapeutas." });
    }
    next();
}

app.get("/api/yo", requiereSesion, (req, res) => {
    res.json({ id: req.usuario.id, nombre: req.usuario.nombre, rol: req.usuario.rol });
});

app.post("/logout", (req, res) => {
    res.setHeader("Set-Cookie", "mw_sesion=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    res.json({ mensaje: "Sesión cerrada." });
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
        ponerSesion(req, res, { id: u.id, nombre: u.nombre, rol: u.rol });   // cookie para pedir los datos del panel
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

// ---- Dashboard: datos del caminador desde ThingsBoard ----
// El servidor le pide los datos a ThingsBoard con TB_API_KEY (variable de entorno) y los pasa al panel.
// La clave nunca llega al navegador, y el dashboard de ThingsBoard ya no tiene que ser público.
const TB_URL = (process.env.TB_URL || "https://thingsboard.cloud").replace(/\/$/, "");
const TB_DEVICE = process.env.TB_DEVICE_ID;
let tbToken = null;

async function tbEncabezados(renovar) {
    if (process.env.TB_API_KEY) return { "X-Authorization": `ApiKey ${process.env.TB_API_KEY}` };
    if (process.env.TB_USUARIO && process.env.TB_CONTRASENA) {   // alternativa: usuario y contraseña de ThingsBoard
        if (!tbToken || renovar) {
            const r = await fetch(`${TB_URL}/api/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: process.env.TB_USUARIO, password: process.env.TB_CONTRASENA })
            });
            if (!r.ok) throw new Error(`ThingsBoard rechazó el usuario o la contraseña (${r.status})`);
            tbToken = (await r.json()).token;
        }
        return { "X-Authorization": `Bearer ${tbToken}` };
    }
    throw new Error("Falta TB_API_KEY en las variables de entorno");
}

async function tb(ruta, opciones = {}) {
    if (!TB_DEVICE) throw new Error("Falta TB_DEVICE_ID en las variables de entorno");
    for (const renovar of [false, true]) {
        const r = await fetch(TB_URL + ruta, {
            ...opciones,
            headers: { ...(await tbEncabezados(renovar)), "Content-Type": "application/json" }
        });
        if (r.ok) {
            const texto = await r.text();
            return texto ? JSON.parse(texto) : null;
        }
        if (r.status !== 401 || process.env.TB_API_KEY) {
            throw new Error(`ThingsBoard respondió ${r.status} en ${ruta.split("?")[0]}`);
        }
    }
    throw new Error("ThingsBoard rechazó las credenciales");
}

const telemetria = (parametros) =>
    tb(`/api/plugins/telemetry/DEVICE/${TB_DEVICE}/values/timeseries?${parametros}&useStrictDataTypes=true`);

// Varias personas con el panel abierto comparten la misma respuesta durante unos segundos,
// para no pasar el límite de peticiones de ThingsBoard
const memoria = new Map();
function recordar(clave, segundos, calcular) {
    const guardado = memoria.get(clave);
    if (guardado && Date.now() - guardado.t < segundos * 1000) return guardado.promesa;
    const promesa = calcular();
    memoria.set(clave, { t: Date.now(), promesa });
    promesa.catch(() => memoria.delete(clave));
    return promesa;
}

// Mismos nombres que en el perfil "MOON Walker" de ThingsBoard
// fuerza_izq / fuerza_der: celda de cada empuñadura; asimetria: 100*(der-izq)/(der+izq), positiva = más a la derecha
const CLAVES_ACTUALES = ["fuerza", "fuerza_izq", "fuerza_der", "asimetria", "voltaje_izq", "voltaje_der",
    "inclinacion", "giro", "en_uso", "aceleracion_total", "errores_sensor", "evaluacion_id"];
const UMBRALES = ["umbral_apoyo_kg", "umbral_apoyo_alto_kg", "umbral_inclinacion_deg", "umbral_caida_deg",
    "umbral_asimetria_pct"];

// Medianoche en Bogotá (UTC-5, sin horario de verano), aunque el servidor de Render esté en UTC
function medianocheBogota(ahora) {
    const CINCO_HORAS = 5 * 3600e3, DIA = 24 * 3600e3;
    return Math.floor((ahora - CINCO_HORAS) / DIA) * DIA + CINCO_HORAS;
}

function errorTB(res, error, mensaje) {
    console.error(mensaje + ":", error.message);
    res.status(502).json({ mensaje: `${mensaje}. ${error.message}.` });
}

// Valores actuales, umbrales, estado del equipo y uso de hoy
app.get("/api/tablero/resumen", requiereSesion, async (req, res) => {
    try {
        const datos = await recordar("resumen", 3, async () => {
            const ahora = Date.now();
            const desde = medianocheBogota(ahora);
            const hoy = `startTs=${desde}&endTs=${ahora}&interval=${Math.max(ahora - desde, 1000)}`;
            const [ultimo, atributos, sumaHoy, promedioHoy] = await Promise.all([
                telemetria(`keys=${CLAVES_ACTUALES.join(",")}`),
                tb(`/api/plugins/telemetry/DEVICE/${TB_DEVICE}/values/attributes/SERVER_SCOPE?keys=` +
                   [...UMBRALES, "active", "lastActivityTime"].join(",")),
                telemetria(`keys=en_uso&${hoy}&agg=SUM`),
                telemetria(`keys=en_uso,asimetria&${hoy}&agg=AVG`)   // la asimetría solo existe con el caminador en uso
            ]);
            const attr = Object.fromEntries((atributos || []).map((a) => [a.key, a.value]));
            const valores = {};
            for (const [clave, lista] of Object.entries(ultimo || {})) {
                if (lista[0]) valores[clave] = { ts: lista[0].ts, valor: Number(lista[0].value) };
            }
            return {
                ahora,
                valores,
                umbrales: Object.fromEntries(UMBRALES.map((u) => [u, attr[u] !== undefined ? Number(attr[u]) : null])),
                conectado: attr.active === true || attr.active === "true",
                ultima_actividad: attr.lastActivityTime ? Number(attr.lastActivityTime) : null,
                uso_hoy_s: sumaHoy?.en_uso?.[0] ? Number(sumaHoy.en_uso[0].value) : 0,
                apoyo_hoy_pct: promedioHoy?.en_uso?.[0] ? Math.round(100 * Number(promedioHoy.en_uso[0].value)) : null,
                asimetria_hoy: promedioHoy?.asimetria?.[0] ? Number(promedioHoy.asimetria[0].value) : null
            };
        });
        res.json(datos);
    } catch (error) {
        errorTB(res, error, "No se pudieron leer los datos del caminador");
    }
});

// Historial para las gráficas: promedios para que salgan unos 300 puntos
app.get("/api/tablero/historial", requiereSesion, soloFisio, async (req, res) => {
    try {
        const minutos = Math.min(Math.max(Number(req.query.min) || 30, 1), 24 * 60);
        const datos = await recordar(`historial-${minutos}`, 10, async () => {
            const fin = Date.now();
            const inicio = fin - minutos * 60e3;
            const intervalo = Math.max(1000, Math.round((fin - inicio) / 300));
            const t = await telemetria(`keys=fuerza,fuerza_izq,fuerza_der,inclinacion,giro&startTs=${inicio}&endTs=${fin}` +
                `&interval=${intervalo}&agg=AVG&limit=1000&orderBy=ASC`);
            const serie = (k) => (t?.[k] || []).map((p) => ({ ts: p.ts, valor: Number(p.value) }));
            return { inicio, fin, fuerza: serie("fuerza"), fuerza_izq: serie("fuerza_izq"), fuerza_der: serie("fuerza_der"),
                     inclinacion: serie("inclinacion"), giro: serie("giro") };
        });
        res.json(datos);
    } catch (error) {
        errorTB(res, error, "No se pudo leer el historial");
    }
});

// Alarmas recientes. El paciente solo ve las que le llegan también por correo (caída e inclinación)
const ALARMAS_PACIENTE = ["Posible caída", "Caminador inclinado"];

app.get("/api/tablero/alarmas", requiereSesion, async (req, res) => {
    try {
        const lista = await recordar("alarmas", 3, async () => {
            const r = await tb(`/api/alarm/DEVICE/${TB_DEVICE}?pageSize=20&page=0&sortProperty=createdTime&sortOrder=DESC`);
            return (r?.data || []).map((a) => ({
                id: a.id?.id,
                tipo: a.type,
                gravedad: a.severity,
                activa: a.cleared !== undefined ? !a.cleared : !String(a.status).startsWith("CLEARED"),
                reconocida: a.acknowledged !== undefined ? a.acknowledged : String(a.status).endsWith("_ACK"),
                inicio: a.startTs || a.createdTime,
                fin: a.clearTs || null
            }));
        });
        res.json(req.usuario.rol === "fisioterapeuta" ? lista : lista.filter((a) => ALARMAS_PACIENTE.includes(a.tipo)));
    } catch (error) {
        errorTB(res, error, "No se pudieron leer las alertas");
    }
});

// El fisioterapeuta marca una alarma como vista (igual que "Acknowledge" en ThingsBoard)
app.post("/api/tablero/alarmas/:id/reconocer", requiereSesion, soloFisio, async (req, res) => {
    try {
        if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ mensaje: "Alarma no válida." });
        await tb(`/api/alarm/${req.params.id}/ack`, { method: "POST" });
        memoria.delete("alarmas");
        res.json({ mensaje: "Alerta marcada como vista." });
    } catch (error) {
        errorTB(res, error, "No se pudo marcar la alerta");
    }
});

// El fisioterapeuta cambia los umbrales (atributos de servidor del caminador; las alarmas los usan)
app.post("/api/tablero/umbrales", requiereSesion, soloFisio, async (req, res) => {
    const u = Object.fromEntries(UMBRALES.map((k) => [k, Number(req.body[k])]));
    if (UMBRALES.some((k) => !Number.isFinite(u[k]) || u[k] <= 0)) {
        return res.status(400).json({ mensaje: "Todos los umbrales deben ser números mayores que cero." });
    }
    if (u.umbral_apoyo_alto_kg <= u.umbral_apoyo_kg || u.umbral_apoyo_alto_kg > 100) {
        return res.status(400).json({ mensaje: "El apoyo excesivo debe ser mayor que el apoyo y máximo 100 kg." });
    }
    if (u.umbral_caida_deg <= u.umbral_inclinacion_deg || u.umbral_caida_deg > 90) {
        return res.status(400).json({ mensaje: "El ángulo de caída debe ser mayor que el de inclinación y máximo 90°." });
    }
    if (u.umbral_asimetria_pct < 5 || u.umbral_asimetria_pct > 100) {
        return res.status(400).json({ mensaje: "La asimetría debe estar entre 5 % y 100 %." });
    }
    try {
        await tb(`/api/plugins/telemetry/DEVICE/${TB_DEVICE}/attributes/SERVER_SCOPE`, {
            method: "POST",
            body: JSON.stringify(u)
        });
        memoria.delete("resumen");
        console.log(`Umbrales cambiados por ${req.usuario.nombre} (id ${req.usuario.id}):`, u);
        res.json({ mensaje: "Umbrales guardados." });
    } catch (error) {
        errorTB(res, error, "No se pudieron guardar los umbrales");
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
        if (!process.env.SESSION_SECRET) console.log("Sin SESSION_SECRET: las sesiones se cierran cada vez que el servidor se reinicia");
        if (!TB_DEVICE || !(process.env.TB_API_KEY || process.env.TB_USUARIO)) {
            console.log("Falta TB_DEVICE_ID o TB_API_KEY: el panel no podrá mostrar los datos del caminador");
        }
    })
    .catch((error) => {
        // Algunos errores de conexión llegan sin mensaje; el código (ETIMEDOUT, ER_ACCESS_DENIED_ERROR...) dice la causa
        console.error("No se pudo conectar con MySQL:", error.code || "", error.message || error);
        console.error("Intentando con host", process.env.DB_HOST, "puerto", Number(process.env.DB_PORT) || 3306,
                      "base", process.env.DB_NAME, "SSL", ssl ? "sí" : "no");
        console.error("Revisa que MySQL esté encendido, que la base DB_NAME exista y los datos del .env");
    });
