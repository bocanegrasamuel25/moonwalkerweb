// Recuperar contraseña: pide al servidor que mande el enlace al correo

// Si la página no se abrió desde localhost:3000, las peticiones van allí (como en login.js)
const SERVIDOR = (location.protocol === "file:" ||
    (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== "3000"))
    ? "http://localhost:3000" : "";

const formulario = document.getElementById("Crear_sesion");
const correo = document.getElementById("Correo");
const boton = document.getElementById("Enviar");
const mensaje = document.getElementById("Mensaje");

correo.addEventListener("invalid", function () {
    if (correo.validity.valueMissing) correo.setCustomValidity("Por favor, introduce tu correo electrónico.");
});
correo.addEventListener("input", function () {
    correo.setCustomValidity("");
});

function mostrar(texto, tipo) {
    mensaje.textContent = texto;
    mensaje.className = "aviso " + tipo;
    mensaje.hidden = false;
}

formulario.addEventListener("submit", async function (event) {
    event.preventDefault();
    boton.disabled = true;
    boton.textContent = "Enviando…";

    try {
        const respuesta = await fetch(SERVIDOR + "/olvide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo: correo.value.trim() })
        });
        const resultado = await respuesta.json();
        mostrar(resultado.mensaje, respuesta.ok ? "ok" : "error");
    } catch (error) {
        console.error("Error de conexión:", error);
        mostrar("No se pudo conectar con el servidor. Intenta de nuevo en un momento.", "error");
    }

    boton.disabled = false;
    boton.textContent = "Enviar enlace";
});
