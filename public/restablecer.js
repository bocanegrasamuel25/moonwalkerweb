// Nueva contraseña: toma el código del enlace del correo y lo envía con la contraseña nueva

// Si la página no se abrió desde localhost:3000, las peticiones van allí (como en login.js)
const SERVIDOR = (location.protocol === "file:" ||
    (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== "3000"))
    ? "http://localhost:3000" : "";

// El enlace del correo trae ?codigo=...
const codigo = new URLSearchParams(location.search).get("codigo");

const formulario = document.getElementById("Crear_sesion");
const contraseña = document.getElementById("Contraseña");
const confirmar = document.getElementById("Confirmar");
const boton = document.getElementById("Guardar");
const mensaje = document.getElementById("Mensaje");

function mostrar(html, tipo) {
    mensaje.innerHTML = html;
    mensaje.className = "aviso " + tipo;
    mensaje.hidden = false;
}

// Sin código no hay nada que hacer: se ofrece pedir un enlace
if (!codigo) {
    formulario.querySelectorAll("input, button").forEach((e) => e.disabled = true);
    mostrar('Este enlace está incompleto. <a href="olvide.html">Pide uno nuevo</a>.', "error");
}

// Mensajes en español en vez de los del navegador
contraseña.addEventListener("invalid", function () {
    if (contraseña.validity.valueMissing) contraseña.setCustomValidity("Por favor, escribe la contraseña nueva.");
    else if (contraseña.validity.patternMismatch || contraseña.validity.tooShort)
        contraseña.setCustomValidity("Mínimo 8 caracteres, con letras y números.");
});
confirmar.addEventListener("invalid", function () {
    if (confirmar.validity.valueMissing) confirmar.setCustomValidity("Por favor, repite la contraseña.");
});
[contraseña, confirmar].forEach(function (campo) {
    campo.addEventListener("input", function () {
        campo.setCustomValidity("");
        confirmar.setCustomValidity("");
    });
});

formulario.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (contraseña.value !== confirmar.value) {
        confirmar.setCustomValidity("Las contraseñas no coinciden.");
        confirmar.reportValidity();
        return;
    }

    boton.disabled = true;
    boton.textContent = "Guardando…";

    try {
        const respuesta = await fetch(SERVIDOR + "/restablecer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ codigo: codigo, contrasena: contraseña.value })
        });
        const resultado = await respuesta.json();

        if (respuesta.ok) {
            formulario.querySelectorAll("input").forEach((e) => e.disabled = true);
            boton.hidden = true;
            mostrar(resultado.mensaje + ' <a href="login.html">Iniciar sesión</a>', "ok");
            return;
        }
        // Enlace vencido o ya usado: se ofrece pedir otro
        const extra = respuesta.status === 400 && resultado.mensaje.includes("enlace")
            ? ' <a href="olvide.html">Pedir otro enlace</a>' : "";
        mostrar(resultado.mensaje + extra, "error");
    } catch (error) {
        console.error("Error de conexión:", error);
        mostrar("No se pudo conectar con el servidor. Intenta de nuevo en un momento.", "error");
    }

    boton.disabled = false;
    boton.textContent = "Guardar contraseña";
});
