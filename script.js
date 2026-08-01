const R2_BASE = "https://images.slovakclouds.live";

/* ===== GRID PROJECTION (from slovakia_stereo.yaml) ===== */
// Lambert Conformal Conic, tangent case (lat_1 == lat_0), centered on the grid
const GRID_PROJ4 = "+proj=lcc +lat_1=48.6667 +lat_0=48.6667 +lon_0=19 +datum=WGS84 +units=m +no_defs";
const GRID_WIDTH_PX = 2304;
const GRID_HEIGHT_PX = 1728;
const GRID_RES_M = 500.0;
const GRID_HALF_W_M = (GRID_WIDTH_PX * GRID_RES_M) / 2;   // 576000
const GRID_HALF_H_M = (GRID_HEIGHT_PX * GRID_RES_M) / 2;  // 432000

// Convert lat/lon (degrees) to a pixel position in the *original* image's
// own pixel space (0..GRID_WIDTH_PX, 0..GRID_HEIGHT_PX). Since the grid's
// center coincides exactly with the projection origin, this is a simple
// linear mapping once we have projected meters.
function latLonToPixel(lat, lon) {
    const [x, y] = proj4("EPSG:4326", GRID_PROJ4, [lon, lat]);
    const px = (x + GRID_HALF_W_M) / GRID_RES_M;
    const py = (GRID_HALF_H_M - y) / GRID_RES_M; // y flips: row 0 is the top
    return { px, py };
}

// User-placed markers: [{ lat, lon, label }]
let markers = [];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const productSelect = document.getElementById("productSelect");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const currentImageName = document.getElementById("currentImageName");

let imageFiles = [];      // list of filenames from JSON
let index = 0;
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;
let currentProduct = productSelect.value;

// For pinch-to-zoom
let pinchStartDist = 0;
let pinchStartScale = 1;

/* ===== RESIZE CANVAS ===== */
function resizeCanvas() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    draw();
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

/* ===== LOAD IMAGE LIST FOR PRODUCT ===== */
async function loadImages(product) {
    currentProduct = product;
    imageFiles = [];
    index = 0;
    currentImageName.textContent = "Loading...";

    try {
        const resp = await fetch(`${R2_BASE}/products/${product}/index.json?ts=${Date.now()}`);
        let files = await resp.json();

        // Filter images from last 2 days
        const now = new Date();
        files = files.filter(f => {
            const dt = new Date(
                f.substring(0,8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") +
                "T" + f.substring(9,11) + ":" + f.substring(11,13)
            );
            return (now - dt) < 2*24*60*60*1000;
        });

        imageFiles = files;

        if (imageFiles.length > 0) {
            index = imageFiles.length - 1; // newest image first
            draw();
            // Notify selector module to update default inputs
            window.dispatchEvent(new Event("imagesLoaded"));
        } else {
            currentImageName.textContent = "No images";
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    } catch (e) {
        console.error(e);
        currentImageName.textContent = "Error loading images";
    }
}

/* ===== DRAW IMAGE DYNAMICALLY ===== */
function draw() {
    if (!imageFiles[index]) return;
    const filename = imageFiles[index];
    const img = new Image();
    img.src = `${R2_BASE}/products/${currentProduct}/${filename}`;
    img.onload = () => {
        if (img.width !== GRID_WIDTH_PX || img.height !== GRID_HEIGHT_PX) {
            console.warn(
                `Image size (${img.width}x${img.height}) doesn't match the ` +
                `configured grid size (${GRID_WIDTH_PX}x${GRID_HEIGHT_PX}) ` +
                `-- markers may be misaligned.`
            );
        }
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.translate(canvas.width/2 + offsetX, canvas.height/2 + offsetY);
        ctx.scale(scale, scale);
        ctx.drawImage(img, -img.width/2, -img.height/2);
        drawMarkers(img);
        currentImageName.textContent = filename;
    };
}

/* ===== DRAW MARKERS ON TOP OF THE IMAGE ===== */
function drawMarkers(img) {
    const radius = 6 / scale;      // constant on-screen size regardless of zoom
    const lineWidth = 2 / scale;
    markers.forEach(m => {
        const { px, py } = latLonToPixel(m.lat, m.lon);
        const x = px - img.width / 2;
        const y = py - img.height / 2;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = "#ff0000";
        ctx.fill();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        if (m.label) {
            ctx.font = `${12 / scale}px system-ui, sans-serif`;
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "bottom";
            ctx.fillText(m.label, x + radius + 4 / scale, y - radius);
        }
    });
}

/* ===== SHOW FRAME WITHOUT LOOPING ===== */
function showFrame(i) {
    if (i < 0) index = 0;
    else if (i >= imageFiles.length) index = imageFiles.length - 1;
    else index = i;
    draw();
}

/* ===== BUTTONS ===== */
prevBtn.onclick = () => showFrame(index - 1);
nextBtn.onclick = () => showFrame(index + 1);

/* ===== PRODUCT CHANGE ===== */
productSelect.onchange = () => loadImages(productSelect.value);

/* ===== MOUSE + TOUCH PAN & PINCH ZOOM ===== */
function startDrag(x, y) { dragging = true; lastX = x; lastY = y; }
function dragMove(x, y) { 
    if (!dragging) return;
    offsetX += x - lastX;
    offsetY += y - lastY;
    lastX = x;
    lastY = y;
    draw();
}
function endDrag() { dragging = false; }

// Mouse
canvas.addEventListener("mousedown", e => startDrag(e.clientX, e.clientY));
canvas.addEventListener("mousemove", e => dragMove(e.clientX, e.clientY));
canvas.addEventListener("mouseup", endDrag);
canvas.addEventListener("mouseleave", endDrag);

// Mouse wheel zoom
canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const zoom = e.deltaY < 0 ? 1.1 : 0.9;
    scale *= zoom;
    scale = Math.min(Math.max(scale, 0.5), 10);
    draw();
});

// Touch
canvas.addEventListener("touchstart", e => {
    e.preventDefault();
    if (e.touches.length === 1) startDrag(e.touches[0].clientX, e.touches[0].clientY);
    else if (e.touches.length === 2) {
        pinchStartDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        pinchStartScale = scale;
    }
});
canvas.addEventListener("touchmove", e => {
    e.preventDefault();
    if (e.touches.length === 1) dragMove(e.touches[0].clientX, e.touches[0].clientY);
    else if (e.touches.length === 2) {
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        scale = pinchStartScale * (dist / pinchStartDist);
        scale = Math.min(Math.max(scale, 0.5), 10);
        draw();
    }
});
canvas.addEventListener("touchend", e => endDrag());
canvas.addEventListener("touchcancel", e => endDrag());

/* ===== KEYBOARD SHORTCUTS ===== */
window.addEventListener("keydown", e => {
    if (e.code === "ArrowRight") showFrame(index + 1);
    if (e.code === "ArrowLeft") showFrame(index - 1);
});


/* ===== INIT ===== */
/* ===== DATETIME SPINNER MODULE (EUMETView-style) ===== */
(function() {
    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const els = {
        year:   document.getElementById("dt-year"),
        month:  document.getElementById("dt-month"),
        day:    document.getElementById("dt-day"),
        hour:   document.getElementById("dt-hour"),
        minute: document.getElementById("dt-minute"),
    };

    // The currently-selected UTC datetime shown by the spinners.
    let cursorDate = new Date();

    // Utility: Convert filename like 'YYYYMMDDTHHMM.png' -> Date object
    function filenameToDate(filename) {
        const base = filename.replace(".png","");
        const y = parseInt(base.substring(0,4));
        const m = parseInt(base.substring(4,6)) - 1; // JS months 0-11
        const d = parseInt(base.substring(6,8));
        const h = parseInt(base.substring(9,11));
        const min = parseInt(base.substring(11,13));
        return new Date(Date.UTC(y,m,d,h,min));
    }

    // Find closest available image <= target date
    function findClosestImage(targetDate) {
        let closestIndex = -1;
        for (let i = 0; i < imageFiles.length; i++) {
            const fileDate = filenameToDate(imageFiles[i]);
            if (fileDate <= targetDate) closestIndex = i;
            else break;
        }
        return closestIndex;
    }

    function pad(n) { return String(n).padStart(2, "0"); }

    function renderCursor() {
        els.year.textContent   = cursorDate.getUTCFullYear();
        els.month.textContent  = MONTH_NAMES[cursorDate.getUTCMonth()];
        els.day.textContent    = pad(cursorDate.getUTCDate());
        els.hour.textContent   = pad(cursorDate.getUTCHours());
        els.minute.textContent = pad(cursorDate.getUTCMinutes());
    }

    function jumpToCursor() {
        if (imageFiles.length === 0) return;
        const closest = findClosestImage(cursorDate);
        if (closest >= 0) {
            index = closest;
            draw();
        }
        // If nothing available yet for that moment, just leave the
        // current frame showing rather than interrupting with an alert.
    }

    function adjustField(field, dir) {
        switch (field) {
            case "year":   cursorDate.setUTCFullYear(cursorDate.getUTCFullYear() + dir); break;
            case "month":  cursorDate.setUTCMonth(cursorDate.getUTCMonth() + dir); break;
            case "day":    cursorDate.setUTCDate(cursorDate.getUTCDate() + dir); break;
            case "hour":   cursorDate.setUTCHours(cursorDate.getUTCHours() + dir); break;
            case "minute": cursorDate.setUTCMinutes(cursorDate.getUTCMinutes() + dir * 10); break;
        }
        renderCursor();
        jumpToCursor();
    }

    document.querySelectorAll(".dt-arrow").forEach(btn => {
        btn.addEventListener("click", () => {
            const field = btn.dataset.field;
            const dir = parseInt(btn.dataset.dir, 10);
            adjustField(field, dir);
        });
    });

    // Sync spinners to the newest image whenever a fresh list loads
    function setDefaultCursor() {
        if (imageFiles.length === 0) return;
        cursorDate = filenameToDate(imageFiles[imageFiles.length - 1]);
        renderCursor();
    }
    window.addEventListener("imagesLoaded", setDefaultCursor);
})();

/* ===== MARKER PANEL ===== */
(function() {
    const panel = document.getElementById("markerPanel");
    const toggleBtn = document.getElementById("markerToggleBtn");
    const latInput = document.getElementById("markerLat");
    const lonInput = document.getElementById("markerLon");
    const addBtn = document.getElementById("markerAddBtn");
    const listEl = document.getElementById("markerList");

    toggleBtn.addEventListener("click", () => {
        panel.classList.toggle("hidden");
    });

    function renderList() {
        listEl.innerHTML = "";
        markers.forEach((m, i) => {
            const row = document.createElement("div");
            row.className = "marker-item";
            row.innerHTML = `
                <span>${m.lat.toFixed(3)}, ${m.lon.toFixed(3)}</span>
                <button aria-label="Remove marker" title="Remove marker">&times;</button>
            `;
            row.querySelector("button").addEventListener("click", () => {
                markers.splice(i, 1);
                renderList();
                draw();
            });
            listEl.appendChild(row);
        });
    }

    addBtn.addEventListener("click", () => {
        const lat = parseFloat(latInput.value);
        const lon = parseFloat(lonInput.value);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

        markers.push({ lat, lon, label: "" });
        latInput.value = "";
        lonInput.value = "";
        renderList();
        draw();
    });
})();

/* ===== MANUAL REFRESH BUTTON ===== */
const refreshBtn = document.getElementById("refreshBtn");
refreshBtn.addEventListener("click", () => {
    refreshBtn.classList.add("spinning");
    loadImages(currentProduct);
    setTimeout(() => refreshBtn.classList.remove("spinning"), 600);
});

/* ===== AUTO-REFRESH TOGGLE ===== */
let autoRefreshEnabled = true;
const autoRefreshBtn = document.getElementById("autoRefreshBtn");

autoRefreshBtn.addEventListener("click", () => {
    autoRefreshEnabled = !autoRefreshEnabled;
    autoRefreshBtn.classList.toggle("active", autoRefreshEnabled);
    autoRefreshBtn.setAttribute("aria-pressed", String(autoRefreshEnabled));
    autoRefreshBtn.title = autoRefreshEnabled ? "Auto-refresh: on" : "Auto-refresh: off";
});

/* ===== AUTO-REFRESH INTERVAL ===== */
setInterval(() => {
    if (autoRefreshEnabled) {
        loadImages(currentProduct);
    }
}, 30*1000); // 30 seconds interval

resizeCanvas();
loadImages(currentProduct);
