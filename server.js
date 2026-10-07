// Servidor de conversión DWG → DXF para BIM CONTROL
// Recibe un archivo .dwg por POST /convert, lo convierte con ODA File Converter
// (instalado dentro del contenedor, ver Dockerfile) y devuelve el .dxf resultante.

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");

const app = express();
app.use(cors()); // en producción, idealmente restringir a tu dominio de Netlify

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 80 * 1024 * 1024 } }); // 80MB máx

// Ruta al binario de ODA File Converter dentro del contenedor (ver Dockerfile)
const ODA_BIN = process.env.ODA_BIN || "/opt/oda/ODAFileConverter";

app.get("/", (req, res) => {
  res.send("Servidor de conversión DWG → DXF para BIM CONTROL. Usa POST /convert con el campo 'dwg'.");
});

// Diagnóstico: confirma que el contenedor tiene ODA y xvfb-run (si sale false, Render no usó el Dockerfile)
app.get("/health", (req, res) => {
  const enPath = (bin) => (process.env.PATH || "").split(path.delimiter).some((d) => fs.existsSync(path.join(d, bin)));
  let faltantes = [];
  try { faltantes = [...new Set(fs.readFileSync("/opt/oda/missing-libs.txt", "utf8").split("\n").map((l) => l.trim().split(" ")[0]).filter(Boolean))]; } catch (e) {}
  res.json({ ok: true, oda: fs.existsSync(ODA_BIN), odaBin: ODA_BIN, xvfbRun: enPath("xvfb-run"), libreriasFaltantes: faltantes });
});

app.post("/convert", upload.single("dwg"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió ningún archivo (campo 'dwg')." });

  const jobId = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const inputDir = path.join(os.tmpdir(), "oda-in-" + jobId);
  const outputDir = path.join(os.tmpdir(), "oda-out-" + jobId);
  fs.mkdirSync(inputDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const safeName = (req.file.originalname || "archivo.dwg").replace(/[^a-zA-Z0-9._-]/g, "_");
  const inputPath = path.join(inputDir, safeName.toLowerCase().endsWith(".dwg") ? safeName : safeName + ".dwg");
  fs.renameSync(req.file.path, inputPath);

  const cleanup = () => {
    fs.rm(inputDir, { recursive: true, force: true }, () => {});
    fs.rm(outputDir, { recursive: true, force: true }, () => {});
  };

  // Orden de argumentos documentado por Open Design Alliance:
  // <carpeta origen> <carpeta destino> <versión de salida> <tipo de salida> <recursivo 0|1> <auditar 0|1> [filtro de entrada]
  // Sin auditoría (0): usa menos memoria y tiempo en planos grandes.
  const args = [inputDir, outputDir, "ACAD2018", "DXF", "0", "0", "*.DWG"];
  const t0 = Date.now(), mb = (n) => Math.round(n / 1024 / 1024);
  console.log(`[${jobId}] Convirtiendo ${safeName} (${mb(req.file.size)} MB)`);

  // El conversor necesita un entorno gráfico aunque se use por línea de comandos (ver Dockerfile: xvfb-run).
  // maxBuffer alto: con el valor por defecto (1 MB) Node corta la conversión si ODA escribe muchos mensajes.
  execFile("xvfb-run", ["-a", ODA_BIN, ...args], { timeout: 240000, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
    try {
      const files = fs.readdirSync(outputDir).filter((f) => f.toLowerCase().endsWith(".dxf"));
      if (!files.length) {
        const motivo = err ? (err.killed ? `proceso detenido (${err.signal || "timeout"}) tras ${Math.round((Date.now() - t0) / 1000)} s` : err.message) : "";
        console.error(`[${jobId}] Conversión sin resultado. ${motivo}\nstdout: ${stdout}\nstderr: ${stderr}`);
        return res.status(500).json({
          error: "La conversión no generó un DXF.",
          detalle: [motivo, (stderr || "").replace(/Detected locale[\s\S]*?more information\.\s*/g, "").trim(), (stdout || "").trim()].filter(Boolean).join(" | ").slice(0, 2000),
        });
      }
      const dxfPath = path.join(outputDir, files[0]);
      const size = fs.statSync(dxfPath).size;
      console.log(`[${jobId}] OK en ${Math.round((Date.now() - t0) / 1000)} s → ${files[0]} (${mb(size)} MB)`);
      if (req.query.raw === "1") {
        // Modo nuevo: envía el DXF directo y comprimido (gzip), sin cargarlo entero en memoria.
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("X-Filename", encodeURIComponent(files[0]));
        res.setHeader("Access-Control-Expose-Headers", "X-Filename");
        const stream = fs.createReadStream(dxfPath).pipe(zlib.createGzip({ level: 6 }));
        stream.pipe(res);
        stream.on("end", cleanup);
        stream.on("error", (e) => { console.error(e); cleanup(); res.destroy(e); });
        return;
      }
      // Modo anterior (JSON con el DXF dentro), lo sigue usando Avance 4D.
      const dxfContent = fs.readFileSync(dxfPath, "utf8");
      res.json({ ok: true, filename: files[0], dxf: dxfContent });
      cleanup();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Error leyendo el resultado de la conversión: " + e.message });
      cleanup();
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor de conversión DWG→DXF escuchando en puerto " + PORT));
