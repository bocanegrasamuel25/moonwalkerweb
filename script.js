// Registro de usuario: valida el formulario y lo envía al servidor

// Si la página se abrió desde el propio servidor (localhost:3000) se usa la misma dirección.
// Si se abrió con Live Server o con doble clic, se envía a http://localhost:3000.
const SERVIDOR = (location.protocol === "file:" ||
    (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== "3000"))
    ? "http://localhost:3000" : "";

const formulario = document.getElementById("Crear_sesion");

const usuario = document.getElementById("Usuario");
const contraseña = document.getElementById("Contraseña");
const correo = document.getElementById("Correo");
const nacimiento = document.getElementById("Nacimiento");
const opcionesRol = document.querySelectorAll('input[name="rol"]');
const campoCodigo = document.getElementById("CampoCodigo");
const codigo = document.getElementById("Codigo");

// Mensajes personalizados para los campos obligatorios
const campos = [
    { elemento: usuario, mensaje: "Por favor, introduce tu nombre completo." },
    { elemento: contraseña, mensaje: "Por favor, introduce una contraseña." },
    { elemento: correo, mensaje: "Por favor, introduce tu correo electrónico." },
    { elemento: nacimiento, mensaje: "Por favor, introduce tu fecha de nacimiento." },
    { elemento: codigo, mensaje: "Escribe el código de fisioterapeuta." }
];

campos.forEach(function (campo) {
    campo.elemento.addEventListener("invalid", function () {
        if (campo.elemento.validity.valueMissing) {
            campo.elemento.setCustomValidity(campo.mensaje);
        }
    });
    // Limpiar el mensaje cuando el usuario modifica el campo
    campo.elemento.addEventListener("input", function () {
        campo.elemento.setCustomValidity("");
    });
});

// Mensaje para el rol (paciente o fisioterapeuta)
opcionesRol.forEach(function (opcion) {
    opcion.addEventListener("invalid", function () {
        opcion.setCustomValidity("Elige si eres paciente o fisioterapeuta.");
    });
    opcion.addEventListener("change", function () {
        opcionesRol.forEach((o) => o.setCustomValidity(""));
        // El código solo se pide a los fisioterapeutas
        const esFisio = opcion.value === "fisioterapeuta";
        campoCodigo.hidden = !esFisio;
        codigo.required = esFisio;
        if (!esFisio) codigo.value = "";
    });
});

// Enviar los datos cuando se envía el formulario
formulario.addEventListener("submit", async function (event) {
    event.preventDefault();

    const rolElegido = document.querySelector('input[name="rol"]:checked');

    const usuario_envio = {
        nombre: usuario.value.trim(),
        contrasena: contraseña.value,
        correo: correo.value.trim(),
        fecha_nacimiento: nacimiento.value,
        rol: rolElegido ? rolElegido.value : "paciente",   // "paciente" o "fisioterapeuta"
        codigo: codigo.value.trim()                         // solo se usa si el rol es fisioterapeuta
    };

    let respuesta;
    try {
        respuesta = await fetch(SERVIDOR + "/registrar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(usuario_envio)
        });
    } catch (error) {
        console.error("Error de conexión:", error);
        alert("No se pudo conectar con el servidor. Comprueba que esté encendido (node server.js) " +
              "y abre la página en http://localhost:3000");
        return;
    }

    try {
        const resultado = await respuesta.json();
        alert(resultado.mensaje);

        // Si todo salió bien, llevar al usuario a iniciar sesión
        if (respuesta.ok) {
            window.location.href = "login.html";
        }
    } catch (error) {
        // La respuesta no fue JSON: la petición no llegó a server.js
        console.error("Respuesta inesperada:", respuesta.status, error);
        alert(`El servidor respondió con un error (${respuesta.status}). ` +
              "Abre la página en http://localhost:3000, no con Live Server ni con doble clic.");
    }
});
