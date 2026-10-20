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
