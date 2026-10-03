# Imagen base con Node.js y Debian (glibc moderno, compatible con ODA File Converter)
FROM node:20-bullseye

# Dependencias del sistema: Xvfb (pantalla virtual, ODA la necesita aunque se use por consola),
# fuse (para poder ejecutar el AppImage), y la librería que los Linux modernos renombraron.
RUN apt-get update && apt-get install -y \
    wget \
    xvfb \
    fuse \
    libxcb-cursor0 \
    libxcb-util1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/lib/x86_64-linux-gnu/libxcb-util.so.1 /usr/lib/x86_64-linux-gnu/libxcb-util.so.0 || true

# Descarga e instalación de ODA File Converter (AppImage, Linux x64).
# Si esta URL ya no funciona, hay que entrar a https://www.opendesign.com/guestfiles/oda_file_converter
# y copiar el link actualizado del botón "AppImage".
RUN mkdir -p /opt/oda && cd /opt/oda \
    && wget -O ODAFileConverter.AppImage "https://www.opendesign.com/guestfiles/get?filename=ODAFileConverter_QT6_lnxX64_11dll.AppImage" \
    && chmod +x ODAFileConverter.AppImage \
    && ./ODAFileConverter.AppImage --appimage-extract \
    && mv squashfs-root oda-extracted \
    && (find oda-extracted -iname "ODAFileConverter" -type f -exec ln -sf {} /opt/oda/ODAFileConverter \; )

ENV ODA_BIN=/opt/oda/ODAFileConverter

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
