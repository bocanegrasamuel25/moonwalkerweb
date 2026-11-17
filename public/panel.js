// Panel de Moon Walker: muestra los datos del caminador (los lee el servidor de ThingsBoard).
// El fisioterapeuta ve el dashboard completo; el paciente y su familia, una versión sencilla.
// Si hay una alerta activa, se muestra un aviso arriba y, si se activó el sonido, suena (actuador virtual).

const CADA_FISIO_MS = 5000;       // valores actuales y alertas
const CADA_PACIENTE_MS = 10000;
const CADA_HISTORIAL_MS = 15000;  // gráficas

const $ = (id) => document.getElementById(id);
let usuario = null;
try { usuario = JSON.parse(sessionStorage.getItem("usuario")); } catch (e) { }
let esFisio = false;
let umbrales = {};
let minutos = 30;
let formEditado = false;

// ---------- Utilidades ----------
const num = (v, dec = 1) => (v === null || v === undefined || Number.isNaN(v))
    ? "—" : v.toLocaleString("es-CO", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const hora = (ts, seg = true) => new Date(ts).toLocaleTimeString("es-CO",
    { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(seg ? { second: "2-digit" } : {}) });
const fechaHora = (ts) => new Date(ts).toLocaleString("es-CO",
    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function hace(ts) {
    if (!ts) return "sin datos";
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `hace ${Math.max(s, 0)} s`;
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return `el ${fechaHora(ts)}`;
}

async function pedir(url, opciones) {
    const r = await fetch(url, opciones);
    if (r.status === 401) {
        sessionStorage.removeItem("usuario");
        location.href = "login.html";
        throw new Error("sin sesión");
    }
    const datos = await r.json();
    if (!r.ok) throw new Error(datos.mensaje || `Error ${r.status}`);
    return datos;
}

function mostrarError(e) {
    if (e && e.message === "sin sesión") return;
    $("Error").textContent = e ? e.message : "";
    $("Error").hidden = !e;
}

function clase(el, base, extra) { el.className = base + (extra ? " " + extra : ""); }

function marca(texto, tipo) {
    const s = document.createElement("span");
    s.className = "marca-estado " + tipo;
    s.textContent = texto;
    return s;
}

// ---------- Alertas: aviso en pantalla y sonido (actuador virtual) ----------
const GRAVEDAD = { CRITICAL: "Crítica", MAJOR: "Alta", MINOR: "Media", WARNING: "Aviso", INDETERMINATE: "Indeterminada" };
const ORDEN = { CRITICAL: 4, MAJOR: 3, MINOR: 2, WARNING: 1, INDETERMINATE: 0 };
const CONSEJO = {
    "Posible caída": "Revisa de inmediato que la persona esté bien.",
    "Caminador inclinado": "Ayuda a enderezar el caminador y revisa que el camino esté despejado.",
    "Apoyo excesivo": "La persona está cargando mucho peso sobre el caminador.",
    "Sin conexión en evaluación": "El caminador dejó de enviar datos durante una evaluación.",
    "Falla de sensores": "Algún sensor del caminador está fallando. Revisa las conexiones.",
    "Apoyo asimétrico": "El paciente está cargando mucho más un lado del caminador que el otro."
};

let audio = null;
let sonidoActivo = false;
const alarmasVistas = new Set();
let ultimoPitidoCritico = 0;

function pitar(veces, frecuencia) {
    if (!sonidoActivo || !audio) return;
    for (let i = 0; i < veces; i++) {
        const t = audio.currentTime + i * 0.35;
        const osc = audio.createOscillator();
        const vol = audio.createGain();
        osc.frequency.value = frecuencia;
        vol.gain.setValueAtTime(0.0001, t);
        vol.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        osc.connect(vol).connect(audio.destination);
        osc.start(t);
        osc.stop(t + 0.27);
    }
}

$("Sonido").addEventListener("click", () => {
    sonidoActivo = !sonidoActivo;
    if (sonidoActivo && !audio) {
        const Contexto = window.AudioContext || window.webkitAudioContext;
        if (Contexto) audio = new Contexto();
    }
    if (audio && audio.state === "suspended") audio.resume();
    $("Sonido").setAttribute("aria-pressed", String(sonidoActivo));
    $("Sonido").textContent = sonidoActivo ? "Sonido activado" : "Activar sonido";
    if (sonidoActivo) pitar(1, 660);   // pitido corto para confirmar
});

function avisarAlertas(lista) {
    const activas = lista.filter((a) => a.activa).sort((a, b) => ORDEN[b.gravedad] - ORDEN[a.gravedad]);
    const peor = activas[0];
    const aviso = $("Alerta");
    document.title = (peor ? "(!) " : "") + "Panel - Moon Walker";

    if (!peor) {
        aviso.hidden = true;
        return activas;
    }
    aviso.hidden = !esFisio;   // el paciente ya ve la alerta en el recuadro grande de estado
    clase(aviso, "alerta", peor.gravedad);
    $("AlertaTitulo").textContent = activas.length > 1 ? `${peor.tipo} (+${activas.length - 1} más)` : peor.tipo;
    $("AlertaDetalle").textContent = `${CONSEJO[peor.tipo] || ""} Activa desde las ${hora(peor.inicio, false)}.`;

    // Suena cuando aparece una alerta nueva; la crítica repite cada 10 s mientras nadie la marque como vista
    const nuevas = activas.filter((a) => !alarmasVistas.has(a.id));
    nuevas.forEach((a) => alarmasVistas.add(a.id));
    const critica = activas.find((a) => a.gravedad === "CRITICAL" && !a.reconocida);
    if (critica && Date.now() - ultimoPitidoCritico > 10000) {
        pitar(4, 880);
        ultimoPitidoCritico = Date.now();
    } else if (nuevas.length) {
        pitar(peor.gravedad === "MAJOR" ? 2 : 1, 660);
    }
    return activas;
}

// ---------- Apoyo izquierdo y derecho ----------
// asimetria = 100*(der - izq)/(der + izq): 0 = parejo, positiva = más carga a la derecha.
// De ahí sale el reparto: derecha = 50 + a/2 %, izquierda = 50 - a/2 %.
const PAREJO_PCT = 10;   // por debajo de esta diferencia se considera un apoyo parejo

function pintarBarra(el, a, etiquetas, texto, tipoTexto) {
    const der = a === null ? 0 : Math.min(100, Math.max(0, 50 + a / 2));
    const izq = a === null ? 0 : 100 - der;
    el.querySelector(".reparto-barra .izq").style.width = izq + "%";
    el.querySelector(".reparto-barra .der").style.width = der + "%";
    el.querySelector(".e-izq").textContent = `${etiquetas[0]} ${a === null ? "—" : num(izq, 0) + " %"}`;
    el.querySelector(".e-der").textContent = `${etiquetas[1]} ${a === null ? "—" : num(der, 0) + " %"}`;
    const p = el.querySelector(".reparto-texto");
    p.textContent = texto;
    p.className = "reparto-texto" + (tipoTexto ? " " + tipoTexto : "");
}

function textoFisio(a, sinDatos) {
    if (a === null) return [sinDatos, ""];
    const diferencia = Math.abs(a);
    if (diferencia < PAREJO_PCT) return [`Apoyo parejo (diferencia de ${num(diferencia, 0)} %).`, ""];
    const lado = a > 0 ? "derecho" : "izquierdo";
    const supera = umbrales.umbral_asimetria_pct !== null && diferencia > umbrales.umbral_asimetria_pct;
    return [`Carga más el lado ${lado}: diferencia de ${num(diferencia, 0)} %${supera ? ", por encima del umbral" : ""}.`,
        supera ? "aviso" : ""];
}

// ---------- Vista del fisioterapeuta ----------
function pastilla(id, tipo, texto) {
    const el = $(id);
    clase(el, "pastilla", tipo);
    el.querySelector(".detalle").textContent = texto;
}

function tarjeta(id, tipo, valor, nota) {
    const el = $(id);
    clase(el, "tarjeta", tipo);
    el.querySelector(".valor span").textContent = valor;
    if (nota !== undefined) el.querySelector(".nota").textContent = nota;
}

function pintarResumenFisio(r) {
    const v = r.valores;
    const reciente = (k) => v[k] && Date.now() - v[k].ts < 60000;
    const ultimaLectura = Math.max(0, ...Object.values(v).map((x) => x.ts));
    const conectado = r.conectado || (ultimaLectura && Date.now() - ultimaLectura < 60000);

    pastilla("EstadoEquipo", conectado ? "bien" : "", conectado ? "Conectado" : `Sin conexión · ${hace(r.ultima_actividad || ultimaLectura)}`);
    const evaluacion = v.evaluacion_id?.valor;
    pastilla("EstadoEvaluacion", evaluacion > 0 ? "info" : "", evaluacion > 0 ? `En curso · #${evaluacion}` : "Ninguna en curso");

    if (v.fuerza) {
        const f = v.fuerza.valor;
        let tipo = "", nota = "Sin apoyo";
        if (!reciente("fuerza")) nota = `Último dato ${hace(v.fuerza.ts)}`;
        else if (umbrales.umbral_apoyo_alto_kg !== null && f > umbrales.umbral_apoyo_alto_kg) { tipo = "alto"; nota = "Apoyo excesivo"; }
        else if (umbrales.umbral_apoyo_kg !== null && f > umbrales.umbral_apoyo_kg) { tipo = "bien"; nota = "Apoyándose en el caminador"; }
        tarjeta("KpiCarga", tipo, num(f), nota);
    } else {
        tarjeta("KpiCarga", "", "—", "Sin datos de la celda de carga");
    }

    if (v.inclinacion) {
        const i = v.inclinacion.valor;
        let tipo = "bien", nota = "Caminador derecho";
        if (!reciente("inclinacion")) { tipo = ""; nota = `Último dato ${hace(v.inclinacion.ts)}`; }
        else if (umbrales.umbral_caida_deg !== null && i > umbrales.umbral_caida_deg) { tipo = "critico"; nota = "Posible caída"; }
        else if (umbrales.umbral_inclinacion_deg !== null && i > umbrales.umbral_inclinacion_deg) { tipo = "aviso"; nota = "Caminador inclinado"; }
        tarjeta("KpiInclinacion", tipo, num(i), nota);
    }
    if (v.giro) tarjeta("KpiGiro", "", num(v.giro.valor));
    tarjeta("KpiApoyo", "", r.apoyo_hoy_pct === null ? "—" : num(r.apoyo_hoy_pct, 0));
    tarjeta("KpiUso", "", num(r.uso_hoy_s / 60, 0));

    // Umbrales: no se sobrescriben mientras el fisioterapeuta los está editando
    if (!formEditado) {
        for (const [k, valor] of Object.entries(umbrales)) {
            const campo = $("FormUmbrales").elements[k];
            if (campo && valor !== null) campo.value = valor;
        }
    }

    // Reparto entre lados: ahora (solo si el caminador está en uso) y promedio de hoy
    const enUsoAhora = reciente("fuerza") && v.asimetria && v.asimetria.ts >= v.fuerza.ts &&
        (umbrales.umbral_apoyo_kg === null || v.fuerza.valor > umbrales.umbral_apoyo_kg);
    const aAhora = enUsoAhora ? v.asimetria.valor : null;
    pintarBarra($("RepartoAhora"), aAhora, ["Izquierda", "Derecha"], ...textoFisio(aAhora, "Sin apoyo en este momento."));
    pintarBarra($("RepartoHoy"), r.asimetria_hoy, ["Izquierda", "Derecha"], ...textoFisio(r.asimetria_hoy, "Todavía no hay datos de hoy."));
    $("LadosUmbral").textContent = umbrales.umbral_asimetria_pct !== null
        ? `Alerta si la diferencia supera ${num(umbrales.umbral_asimetria_pct, 0)} %` : "";

    $("EqLectura").textContent = ultimaLectura ? hace(ultimaLectura) : "—";
    $("EqVoltajeIzq").textContent = v.voltaje_izq ? `${num(v.voltaje_izq.valor * 1000, 3)} mV` : "—";
    $("EqVoltajeDer").textContent = v.voltaje_der ? `${num(v.voltaje_der.valor * 1000, 3)} mV` : "—";
    $("EqErrores").textContent = v.errores_sensor ? num(v.errores_sensor.valor, 0) : "—";
    $("EqAcel").textContent = v.aceleracion_total ? `${num(v.aceleracion_total.valor, 2)} g` : "—";
}

function pintarAlarmasFisio(lista, activas) {
    const peorActiva = activas.some((a) => a.gravedad === "CRITICAL" || a.gravedad === "MAJOR");
    pastilla("EstadoAlertas", activas.length ? (peorActiva ? "critico" : "aviso") : "bien",
        activas.length ? `${activas.length} ${activas.length === 1 ? "alerta" : "alertas"}` : "Ninguna");

    const cuerpo = $("TablaAlarmas");
    cuerpo.replaceChildren();
    if (!lista.length) {
        cuerpo.innerHTML = '<tr><td colspan="5" class="vacio">No hay alertas registradas.</td></tr>';
        return;
    }
    for (const a of lista) {
        const fila = document.createElement("tr");
        const estado = a.activa ? (a.reconocida ? marca("Activa · vista", "vista") : marca("Activa", "activa")) : marca("Resuelta", "resuelta");
        const celdas = [document.createTextNode(a.tipo), marca(GRAVEDAD[a.gravedad] || a.gravedad, a.gravedad),
            estado, document.createTextNode(fechaHora(a.inicio))];
        if (a.activa && !a.reconocida && a.id) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "boton-mini";
            b.textContent = "Marcar vista";
            b.addEventListener("click", async () => {
                b.disabled = true;
                try {
                    await pedir(`/api/tablero/alarmas/${a.id}/reconocer`, { method: "POST" });
                    await refrescar();
                } catch (e) { mostrarError(e); b.disabled = false; }
            });
            celdas.push(b);
        } else {
            celdas.push(document.createTextNode(""));
        }
        for (const c of celdas) { const td = document.createElement("td"); td.append(c); fila.append(td); }
        cuerpo.append(fila);
    }
}

$("FormUmbrales").addEventListener("input", () => { formEditado = true; });
$("FormUmbrales").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const boton = ev.target.querySelector("button");
    boton.disabled = true;
    const datos = Object.fromEntries(new FormData(ev.target));
    try {
        const r = await pedir("/api/tablero/umbrales", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(datos)
        });
        formEditado = false;
        alert(r.mensaje);
        await refrescar();
        await refrescarHistorial();
    } catch (e) {
        if (e.message !== "sin sesión") alert(e.message);
    }
    boton.disabled = false;
});

// Gráficas
const COLORES = { carga: "#1d2545", izq: "#3a56c4", der: "#0f766e", inclinacion: "#0f766e", giro: "#7c3aed", aviso: "#a15c00", critico: "#b3261e" };
const graficas = {};

function crearGrafica(id, color) {
    return new Chart($(id), {
        type: "line",
        data: { labels: [], datasets: [{ label: "Valor", data: [], borderColor: color, backgroundColor: color + "22", fill: true, borderWidth: 2, pointRadius: 0, tension: 0.25 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${num(c.parsed.y)}` } } },
            scales: {
                x: { ticks: { maxTicksLimit: 7, maxRotation: 0, color: "#566080" }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: "#566080" }, grid: { color: "#e6e9f3" } }
            }
        }
    });
}

function actualizarGrafica(g, serie, lineas = []) {
    g.data.labels = serie.map((p) => hora(p.ts, minutos <= 5));
    g.data.datasets[0].data = serie.map((p) => p.valor);
    g.data.datasets.length = 1;
    for (const [texto, valor, color] of lineas) {
        if (valor === null || valor === undefined) continue;
        g.data.datasets.push({ label: texto, data: Array(serie.length).fill(valor), borderColor: color, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false });
    }
    g.update();
}

async function refrescarHistorial() {
    if (!esFisio) return;
    try {
        const h = await pedir(`/api/tablero/historial?min=${minutos}`);
        actualizarGrafica(graficas.carga, h.fuerza, [
            ["Umbral de apoyo", umbrales.umbral_apoyo_kg, COLORES.aviso],
            ["Apoyo excesivo", umbrales.umbral_apoyo_alto_kg, COLORES.critico]]);
        actualizarGrafica(graficas.inclinacion, h.inclinacion, [
            ["Inclinado", umbrales.umbral_inclinacion_deg, COLORES.aviso],
            ["Posible caída", umbrales.umbral_caida_deg, COLORES.critico]]);
        actualizarGrafica(graficas.giro, h.giro);
        // Izquierda y derecha en la misma gráfica
        const g = graficas.lados;
        g.data.labels = h.fuerza_izq.map((p) => hora(p.ts, minutos <= 5));
        g.data.datasets[0].data = h.fuerza_izq.map((p) => p.valor);
        g.data.datasets[1].data = h.fuerza_der.map((p) => p.valor);
        g.update();
    } catch (e) { mostrarError(e); }
}

document.querySelectorAll(".rango button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".rango button").forEach((x) => x.classList.toggle("activo", x === b));
    minutos = Number(b.dataset.min);
    refrescarHistorial();
}));

// ---------- Vista del paciente y la familia ----------
function pintarPaciente(r, lista, activas) {
    const v = r.valores;
    const ultimaLectura = Math.max(0, ...Object.values(v).map((x) => x.ts));
    const conectado = r.conectado || (ultimaLectura && Date.now() - ultimaLectura < 60000);
    const caida = activas.find((a) => a.tipo === "Posible caída");
    const inclinado = activas.find((a) => a.tipo === "Caminador inclinado");

    let tipo, titulo, texto;
    if (caida) { tipo = "critico"; titulo = "Posible caída"; texto = "El caminador está muy inclinado o en el piso. Revisa que la persona esté bien."; }
    else if (inclinado) { tipo = "aviso"; titulo = "El caminador está inclinado"; texto = "Ayuda a enderezarlo y revisa que el camino esté despejado."; }
    else if (!conectado) { tipo = ""; titulo = "El caminador está apagado o sin conexión"; texto = `Última señal ${hace(r.ultima_actividad || ultimaLectura)}.`; }
    else { tipo = "bien"; titulo = "Todo en orden"; texto = "El caminador está funcionando con normalidad."; }
    clase($("EstadoSimple"), "estado-grande", tipo);
    $("EstadoSimpleTitulo").textContent = titulo;
    $("EstadoSimpleTexto").textContent = texto;

    tarjeta("PacUso", "", num(r.uso_hoy_s / 60, 0));

    const a = r.asimetria_hoy;
    let textoLados = "Todavía no hay datos de hoy.", tipoLados = "";
    if (a !== null && Math.abs(a) < PAREJO_PCT) textoLados = "Hoy te estás apoyando parejo en las dos manos. ¡Muy bien!";
    else if (a !== null) {
        textoLados = `Hoy te apoyas más en la mano ${a > 0 ? "derecha" : "izquierda"}. Intenta repartir el peso entre las dos.`;
        if (umbrales.umbral_asimetria_pct !== null && Math.abs(a) > umbrales.umbral_asimetria_pct) tipoLados = "aviso";
    }
    pintarBarra($("RepartoPaciente"), a, ["Mano izquierda", "Mano derecha"], textoLados, tipoLados);
    tarjeta("PacConexion", conectado ? "bien" : "", conectado ? "Encendido" : "Sin conexión",
        ultimaLectura ? `Última señal ${hace(ultimaLectura)}` : "Todavía no ha enviado datos");

    const ul = $("ListaAvisos");
    ul.replaceChildren();
    if (!lista.length) {
        ul.innerHTML = '<li class="vacio">No hay avisos recientes.</li>';
        return;
    }
    for (const a of lista.slice(0, 8)) {
        const li = document.createElement("li");
        const izq = document.createElement("div");
        const nombre = document.createElement("strong");
        nombre.textContent = a.tipo;
        const cuando = document.createElement("small");
        cuando.textContent = " · " + fechaHora(a.inicio);
        izq.append(nombre, cuando);
        li.append(izq, a.activa ? marca("Activo", "activa") : marca("Resuelto", "resuelta"));
        ul.append(li);
    }
}

// ---------- Ciclo de actualización ----------
async function refrescar() {
    try {
        const [r, lista] = await Promise.all([pedir("/api/tablero/resumen"), pedir("/api/tablero/alarmas")]);
        umbrales = r.umbrales;
        const activas = avisarAlertas(lista);
        if (esFisio) {
            pintarResumenFisio(r);
            pintarAlarmasFisio(lista, activas);
        } else {
            pintarPaciente(r, lista, activas);
        }
        $("Actualizado").textContent = `Datos del caminador · actualizado a las ${hora(Date.now())}`;
        mostrarError(null);
    } catch (e) {
        mostrarError(e);
    }
}

async function iniciar() {
    let yo;
    try { yo = await pedir("/api/yo"); } catch (e) { return; }
    esFisio = yo.rol === "fisioterapeuta";
    $("Saludo").textContent = "Hola, " + yo.nombre;
    $("Rol").textContent = esFisio ? "Fisioterapeuta" : "Paciente";
    $("Titulo").textContent = esFisio ? "Seguimiento del caminador" : "Tu caminador";
    $(esFisio ? "VistaFisio" : "VistaPaciente").hidden = false;

    if (esFisio) {
        graficas.carga = crearGrafica("GraficaCarga", COLORES.carga);
        graficas.inclinacion = crearGrafica("GraficaInclinacion", COLORES.inclinacion);
        graficas.giro = crearGrafica("GraficaGiro", COLORES.giro);
        graficas.lados = crearGrafica("GraficaLados", COLORES.izq);
        graficas.lados.data.datasets[0].label = "Izquierda";
        graficas.lados.data.datasets[0].fill = false;
        graficas.lados.data.datasets.push({ label: "Derecha", data: [], borderColor: COLORES.der, borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false });
    }
    await refrescar();            // primero el resumen, para tener los umbrales en las gráficas
    await refrescarHistorial();
    setInterval(refrescar, esFisio ? CADA_FISIO_MS : CADA_PACIENTE_MS);
    if (esFisio) setInterval(refrescarHistorial, CADA_HISTORIAL_MS);
}

// ---------- Botones de la barra ----------
$("Salir").addEventListener("click", async () => {
    sessionStorage.removeItem("usuario");
    await fetch("/logout", { method: "POST" }).catch(() => {});
    location.href = "login.html";
});

// Cambiar contraseña: manda el enlace al correo de la cuenta que inició sesión
$("Cambiar").addEventListener("click", async function () {
    if (!usuario || !usuario.correo) {
        location.href = "olvide.html";
        return;
    }
    const boton = this;
    boton.disabled = true;
    try {
        const respuesta = await fetch("/olvide", {
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

iniciar();
