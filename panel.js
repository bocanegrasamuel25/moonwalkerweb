// Panel: muestra el dashboard de ThingsBoard según el rol del usuario

// Links de los dashboards de ThingsBoard. Para sacarlos, abre el dashboard,
// hazlo público (Make public) y copia el link que te da.
const LINK_FISIOTERAPEUTA = "https://thingsboard.cloud/home";
const LINK_PACIENTE = "https://thingsboard.cloud/home";

// Usuario guardado por login.js al iniciar sesión
let usuario = null;
try { usuario = JSON.parse(sessionStorage.getItem("usuario")); } catch (e) { }

// Sin sesión iniciada, lo manda al login
if (!usuario) {
    window.location.href = "login.html";
} else {
    const esFisio = usuario.rol === "fisioterapeuta";
    document.getElementById("Saludo").textContent = "Hola, " + usuario.nombre;
    document.getElementById("Rol").textContent = esFisio ? "Fisioterapeuta" : "Paciente";

    const link = esFisio ? LINK_FISIOTERAPEUTA : LINK_PACIENTE;
    const tablero = document.getElementById("Tablero");
    const abrir = document.getElementById("AbrirTB");

    if (link) {
        tablero.src = link;
        tablero.hidden = false;
        abrir.href = link;
    } else {
        document.getElementById("SinLink").hidden = false;
        abrir.hidden = true;
    }
}

document.getElementById("Salir").addEventListener("click", function () {
    sessionStorage.removeItem("usuario");
    window.location.href = "login.html";
});

// Cambiar contraseña: manda el enlace al correo de la cuenta que inició sesión
const SERVIDOR = (location.protocol === "file:" ||
    (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== "3000"))
    ? "http://localhost:3000" : "";

document.getElementById("Cambiar").addEventListener("click", async function () {
    // Sesiones iniciadas antes de este cambio no guardaron el correo: se pide en la otra página
    if (!usuario || !usuario.correo) {
        window.location.href = "olvide.html";
        return;
    }
    const boton = this;
    boton.disabled = true;
    try {
        const respuesta = await fetch(SERVIDOR + "/olvide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ correo: usuario.correo })
        });
        const resultado = await respuesta.json();
        alert(respuesta.ok
            ? "Te enviamos un enlace a " + usuario.correo + " para cambiar la contraseña. Revisa también la carpeta de spam."
            : resultado.mensaje);
    } catch (error) {
        console.error("Error de conexión:", error);
        alert("No se pudo conectar con el servidor. Intenta de nuevo en un momento.");
    }
    boton.disabled = false;
});
