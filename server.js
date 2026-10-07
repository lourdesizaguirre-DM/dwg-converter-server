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
  const args = [inputDir, outputDir, "ACAD2018", "DXF", "0", "1", "*.DWG"];

  // El conversor necesita un entorno gráfico aunque se use por línea de comandos (ver Dockerfile: xvfb-run).
  execFile("xvfb-run", ["-a", ODA_BIN, ...args], { timeout: 120000 }, (err, stdout, stderr) => {
    try {
      const files = fs.readdirSync(outputDir).filter((f) => f.toLowerCase().endsWith(".dxf"));
      if (!files.length) {
        console.error("Conversión sin resultado. stdout:", stdout, "stderr:", stderr, "err:", err && err.message);
        return res.status(500).json({
          error: "La conversión no generó un DXF. El archivo puede estar dañado o en un formato no soportado.",
          detalle: (stderr || stdout || (err && err.message) || "").slice(0, 2000),
        });
      }
      const dxfPath = path.join(outputDir, files[0]);
      const dxfContent = fs.readFileSync(dxfPath, "utf8");
      res.json({ ok: true, filename: files[0], dxf: dxfContent });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Error leyendo el resultado de la conversión: " + e.message });
    } finally {
      cleanup();
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor de conversión DWG→DXF escuchando en puerto " + PORT));
