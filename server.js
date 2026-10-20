// Servidor de Moon Walker: registra usuarios en MySQL y les inicia sesión.
// Se enciende con node server.js y se abre en http://localhost:3000

require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

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
        res.json({ mensaje: "Sesión iniciada.", usuario: { id: u.id, nombre: u.nombre, rol: u.rol } });
    } catch (error) {
        console.error("Error en MySQL:", error.message);
        res.status(500).json({ mensaje: "Error en la base de datos. Mira la terminal del servidor." });
    }
});

// Arranque: primero prueba la conexión con MySQL
db.query("SELECT 1 FROM usuarios LIMIT 1")
    .then(() => {
        // El hosting asigna el puerto en PORT; en tu computador se usa el 3000
        const puerto = process.env.PORT || 3000;
        app.listen(puerto, () => console.log("Servidor activo en el puerto " + puerto));
    })
    .catch((error) => {
        console.error("No se pudo conectar con MySQL:", error.message);
        console.error("Revisa que MySQL esté encendido, que ejecutaste moonwalker.sql y los datos del .env");
    });
