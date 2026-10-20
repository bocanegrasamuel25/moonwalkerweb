// Inicio de sesión: envía correo y contraseña al servidor

// Página a la que se va después de iniciar sesión
const DESPUES_DE_LOGIN = "panel.html";

// Si la página no se abrió desde localhost:3000, las peticiones van allí (como en script.js)
const SERVIDOR = (location.protocol === "file:" ||
    (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== "3000"))
    ? "http://localhost:3000" : "";

const formulario = document.getElementById("Crear_sesion");
const correo = document.getElementById("Correo");
const contraseña = document.getElementById("Contraseña");

[
    { elemento: correo, mensaje: "Por favor, introduce tu correo electrónico." },
    { elemento: contraseña, mensaje: "Por favor, introduce tu contraseña." }
].forEach(function (campo) {
    campo.elemento.addEventListener("invalid", function () {
        if (campo.elemento.validity.valueMissing) campo.elemento.setCustomValidity(campo.mensaje);
    });
    campo.elemento.addEventListener("input", function () {
        campo.elemento.setCustomValidity("");
    });
});

formulario.addEventListener("submit", async function (event) {
    event.preventDefault();

    let respuesta;
    try {
        respuesta = await fetch(SERVIDOR + "/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo: correo.value.trim(), contrasena: contraseña.value })
        });
    } catch (error) {
        console.error("Error de conexión:", error);
        alert("No se pudo conectar con el servidor. Comprueba que esté encendido (node server.js) " +
              "y abre la página en http://localhost:3000");
        return;
    }

    try {
        const resultado = await respuesta.json();
        if (respuesta.ok) {
            // El panel lee de aquí quién entró. El servidor solo devuelve id, nombre y rol
            sessionStorage.setItem("usuario", JSON.stringify(resultado.usuario));
            window.location.href = DESPUES_DE_LOGIN;
        } else {
            alert(resultado.mensaje);
        }
    } catch (error) {
        console.error("Respuesta inesperada:", respuesta.status, error);
        alert(`El servidor respondió con un error (${respuesta.status}). ` +
              "Abre la página en http://localhost:3000, no con Live Server ni con doble clic.");
    }
});
