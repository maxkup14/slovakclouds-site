# slovakclouds.live

Automated near-real-time satellite imagery for Slovakia, generated from EUMETSAT
Meteosat Third Generation (MTG) FCI data, processed with Geo2Grid, and served as
a static web viewer.

**Live site:** https://slovakclouds.live

---

## What this does

Every 10 minutes, an automated pipeline:

1. **Downloads** the latest MTG FCI (Flexible Combined Imager) data for two
   collections — `FDHSI` (Full Disk High Spectral Imagery) and `HRFI` (High
   Resolution Fast Imagery) — from EUMETSAT's Data Store, via `eumdac`.
2. **Processes** the raw data into six geophysical composite products, cropped
   and reprojected to a custom Slovakia-focused stereographic grid, using
   [Geo2Grid](https://www.ssec.wisc.edu/software/geo2grid/) (built on SatPy).
3. **Overlays** coastlines and political borders onto each output image.
4. **Publishes** the resulting PNGs, along with a machine-readable index of
   available images, to Cloudflare R2 object storage.
5. **Serves** a lightweight static frontend (hosted on GitHub Pages) that reads
   directly from R2 and lets visitors browse, zoom, and step through the most
   recent imagery for each product.

The entire pipeline runs unattended, on a schedule, inside a Docker container —
no manual intervention required once set up.

---

## Products generated

| Composite | Description |
|---|---|
| `natural_color` | True-color-like daytime imagery |
| `airmass` | Airmass RGB — jet stream, tropopause folds, air mass boundaries |
| `cimss_cloud_type` | CIMSS cloud-type classification |
| `hrv_clouds` | High-resolution visible cloud imagery |
| `fire_temperature` | Fire/hotspot detection composite |
| `night_microphysics` | Nighttime cloud microphysics (fog, low cloud, ice/water phase) |

---

## Architecture

```
┌──────────────────┐
│   EUMETSAT       │
│   Data Store     │
└────────┬─────────┘
         │ eumdac download (FDHSI + HRFI, every 10 min)
         ▼
┌──────────────────────────────────────────────────┐
│  Docker container (Rocky Linux 9)                │
│  ─────────────────────────────────────────       │
│  • Geo2Grid v1.3 (bundled Python/SatPy runtime)  │
│  • Custom composites/enhancements (FCI)          │
│  • Custom grid definition (Slovakia stereo)      │
│  • eumdac (data download)                        │
│  • rclone (R2 upload)                            │
│  • run_pipeline.sh (orchestration)               │
└────────┬─────────────────────────────────────────┘
         │ geo2grid.sh → GeoTIFFs → add_coastlines.sh → PNGs
         │ index.json generated per product
         ▼
┌────────────────────┐
│  Cloudflare R2     │  (public bucket, 2-day object lifecycle)
│  geo2grid-products │
└────────┬───────────┘
         │ fetch (CORS-enabled, public dev URL)
         ▼
┌────────────────────┐
│  GitHub Pages      │  (static frontend: index.html / script.js / style.css)
│  slovakclouds.live │
└────────┬───────────┘
         │
         ▼
     Site visitors
```

---

## Repository / component breakdown

### 1. Docker image (`geo2grid:1.3`)

Base: `rockylinux:9` (Geo2Grid's officially supported/tested OS).

Bundled in the image:
- **Geo2Grid v1.3** — self-contained tarball install (own Python runtime,
  no system Python dependency), including custom `fci.yaml` composite and
  enhancement definitions (bind-mounted, not baked in, so they can be edited
  without a rebuild).
- **eumdac** — installed via `pip3`, authenticates against the EUMETSAT API
  using a Consumer Key/Secret, credentials persisted via a mounted volume.
- **rclone** — single static binary, configured as an S3-compatible remote
  pointing at Cloudflare R2, used for all uploads.
- **run_pipeline.sh** — the orchestration script (see below), baked into the
  image at `/usr/local/bin/`.

### 2. `run_pipeline.sh`

Runs a single end-to-end cycle:
- Lock file + hard runtime timeout (safety against overlapping/hung runs)
- `eumdac search` + `download` for the latest FDHSI/HRFI chunk sets
- `geo2grid.sh` processes the downloaded data into all six composites,
  reprojected to the custom Slovakia grid
- `add_coastlines.sh` overlays coastlines/borders and writes final PNGs,
  organized into per-product folders with `YYYYMMDDTHHMM.png` filenames
- Local retention pruning (48h)
- Generates `index.json` per product (replaces what used to be a standalone
  script run on the original droplet)
- `rclone copy` uploads new/changed PNGs and `index.json` files to R2

### 3. Cloudflare R2 (`geo2grid-products` bucket)

- Public Development URL enabled (public, read-only access to imagery —
  reasonable given this is public satellite data)
- CORS policy allows cross-origin `GET` requests from the frontend's domain
- Object Lifecycle Rule auto-deletes objects older than 2 days, keeping
  storage bounded indefinitely without manual cleanup
- A scoped Account API Token (Object Read & Write, limited to this bucket
  only) is used by `rclone` for uploads — least-privilege by design

### 4. Frontend (GitHub Pages)

Static site — `index.html`, `script.js`, `style.css`, `logo.png` — with no
build step or backend of its own. `script.js` fetches `index.json` and PNGs
directly from the R2 public URL (an absolute, cross-origin fetch — the site's
own hosting location is otherwise irrelevant to how images are served).

DNS for `slovakclouds.live` is managed via Cloudflare (registrar: name.com),
pointing at GitHub Pages' IPs via four DNS-only (non-proxied) A records, with
`www` as a CNAME to the GitHub Pages domain. HTTPS is enforced and
auto-provisioned by GitHub.

### 5. Scheduling

Two cron jobs on the host:
- **Pipeline cycle** — runs at `:05, :15, :25, :35, :45, :55` past every hour
  (offset from the top of the hour to avoid colliding with other scheduled
  system tasks)
- **Daily reboot** — `02:00` every day, as a periodic clean-slate safety net
  for long-running unattended operation

---

## Design decisions worth knowing

- **Ephemeral containers, not a long-running daemon.** Each cycle spins up a
  fresh, `--rm`'d container. Nothing persists inside the container between
  runs — all state lives in host-mounted volumes. This avoids memory
  buildup, makes each run independently debuggable via its own log entry,
  and means a bad cycle never affects the next one.
- **Rocky Linux inside Docker, Ubuntu on the host.** Geo2Grid is only
  officially supported on Rocky/RHEL-family systems. Rather than fight
  library compatibility on the Ubuntu host directly, the whole Geo2Grid
  environment is containerized, giving an exact, reproducible Rocky 9
  userland regardless of the host OS.
- **Custom composites and grid config are bind-mounted, not baked into the
  image.** This lets composite/enhancement/grid tuning happen by editing a
  file on the host, taking effect on the *next* scheduled run — no rebuild
  required.
- **Migrated from a single droplet to this architecture** to remove the
  Ubuntu/Rocky mismatch, move image serving off a single server onto object
  storage with zero egress fees, and decouple the frontend, image storage,
  and processing pipeline into independently replaceable pieces.

---

## Status

✅ Fully automated, running unattended on a 10-minute cadence
✅ Custom composites and grid definitions preserved from the original setup
✅ Public frontend live at the original domain, on free-tier infrastructure
   throughout (GitHub Pages + Cloudflare R2 free tier)
