# Imagen base con Node.js y Debian 12 "bookworm": ODA File Converter (versión Qt6) necesita
# un glibc más nuevo que el de bullseye.
FROM node:20-bookworm

# Dependencias del sistema:
# - xvfb + xauth: pantalla virtual (ODA la necesita aunque se use por consola) y el comando xvfb-run
# - librerías que Qt6 necesita para arrancar (xcb, xkbcommon, OpenGL, fuentes, dbus)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    xvfb \
    xauth \
    libxcb-cursor0 \
    libxcb-util1 \
    libxcb-icccm4 \
    libxcb-image0 \
    libxcb-keysyms1 \
    libxcb-randr0 \
    libxcb-render-util0 \
    libxcb-shape0 \
    libxcb-xinerama0 \
    libxcb-xkb1 \
    libxkbcommon-x11-0 \
    libgl1 \
    libegl1 \
    libopengl0 \
    libglx0 \
    libxcb-glx0 \
    libx11-xcb1 \
    libxrender1 \
    libxext6 \
    libxi6 \
    libsm6 \
    libice6 \
    libfreetype6 \
    libxkbcommon0 \
    libfontconfig1 \
    libdbus-1-3 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && (ln -sf /usr/lib/x86_64-linux-gnu/libxcb-util.so.1 /usr/lib/x86_64-linux-gnu/libxcb-util.so.0 || true)

# Descarga e instalación de ODA File Converter (AppImage, Linux x64), extraído para no necesitar FUSE.
# Si esta URL ya no funciona, hay que entrar a https://www.opendesign.com/guestfiles/oda_file_converter
# y copiar el link actualizado del botón "AppImage".
RUN mkdir -p /opt/oda && cd /opt/oda \
    && wget -q -O ODAFileConverter.AppImage "https://www.opendesign.com/guestfiles/get?filename=ODAFileConverter_QT6_lnxX64_11dll.AppImage" \
    && chmod +x ODAFileConverter.AppImage \
    && ./ODAFileConverter.AppImage --appimage-extract > /dev/null \
    && mv squashfs-root oda-extracted \
    && rm ODAFileConverter.AppImage \
    && test -x /opt/oda/oda-extracted/AppRun \
    && (cd /opt/oda/oda-extracted && LD_LIBRARY_PATH="$(find . -name '*.so*' -printf '%h\n' | sort -u | sed 's|^\.|/opt/oda/oda-extracted|' | paste -sd:)" \
        sh -c 'ldd ./AppRun; find . -type f -name "*.so*" -exec ldd {} \; 2>/dev/null' | grep "not found" | sort -u > /opt/oda/missing-libs.txt || true) \
    && echo "Librerías faltantes para ODA:" && cat /opt/oda/missing-libs.txt

# Se ejecuta a través de AppRun para que ODA encuentre sus propias librerías incluidas en el AppImage.
ENV ODA_BIN=/opt/oda/oda-extracted/AppRun
ENV QT_QPA_PLATFORM=xcb

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
