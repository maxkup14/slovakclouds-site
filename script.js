const R2_BASE = "https://pub-52013089c4a549af9854c13adef2a7b2.r2.dev"; // <-- replace with your actual R2 public URL

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
        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.translate(canvas.width/2 + offsetX, canvas.height/2 + offsetY);
        ctx.scale(scale, scale);
        ctx.drawImage(img, -img.width/2, -img.height/2);
        currentImageName.textContent = filename;
    };
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
/* ===== DATE/TIME SELECTOR MODULE ===== */
(function() {
    const dateInput = document.getElementById("selectDate");
    const timeInput = document.getElementById("selectTime");
    const goBtn = document.getElementById("goToTimeBtn");

    // Utility: Convert filename like 'YYYYMMDDTHHMM.png' › Date object
    function filenameToDate(filename) {
        const base = filename.replace(".png","");
        const y = parseInt(base.substring(0,4));
        const m = parseInt(base.substring(4,6)) - 1; // JS months 0-11
        const d = parseInt(base.substring(6,8));
        const h = parseInt(base.substring(9,11));
        const min = parseInt(base.substring(11,13));
        return new Date(Date.UTC(y,m,d,h,min));
    }

    // Find closest image <= target date
    function findClosestImage(targetDate) {
        let closestIndex = -1;
        for (let i = 0; i < imageFiles.length; i++) {
            const fileDate = filenameToDate(imageFiles[i]);
            if (fileDate <= targetDate) closestIndex = i;
            else break;
        }
        return closestIndex;
    }

    goBtn.addEventListener("click", () => {
        if (imageFiles.length === 0) return;

        const dateVal = dateInput.value; // YYYY-MM-DD
        const timeVal = timeInput.value; // HH:MM

        if (!dateVal || !timeVal) return;

        const [y,m,d] = dateVal.split("-").map(Number);
        const [h,min] = timeVal.split(":").map(Number);
        const targetDate = new Date(Date.UTC(y,m-1,d,h,min));

        const closest = findClosestImage(targetDate);

        if (closest >= 0) {
            index = closest;
            draw();
        } else {
            alert("No image available for the selected date/time.");
        }
    });

    // Optional: Auto-fill inputs with newest image by default
    function setDefaultInputs() {
        if (imageFiles.length === 0) return;
        const newest = filenameToDate(imageFiles[imageFiles.length-1]);
        dateInput.value = newest.toISOString().slice(0,10);
        timeInput.value = newest.toISOString().slice(11,16);
    }

    // Update default inputs whenever new images are loaded
    window.addEventListener("imagesLoaded", setDefaultInputs);
})();

/* ===== AUTO-REFRESH TOGGLE ===== */
let autoRefreshEnabled = true;
const autoRefreshCheckbox = document.getElementById("autoRefreshCheckbox");

autoRefreshCheckbox.addEventListener("change", () => {
    autoRefreshEnabled = autoRefreshCheckbox.checked;
});

/* ===== AUTO-REFRESH INTERVAL ===== */
setInterval(() => {
    if (autoRefreshEnabled) {
        loadImages(currentProduct);
    }
}, 30*1000); // 30 seconds interval

resizeCanvas();
loadImages(currentProduct); // updated 21:47 CET, 1.1.2026
