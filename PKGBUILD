# PKGBUILD local: compila este checkout e instala com pacman, sem release.
#   makepkg -si        (na raiz do repo)
# Deixa `node_modules/` e `src-tauri/target/` no próprio repo (já ignorados),
# então rebuilds seguintes só recompilam o que mudou.
pkgname=sightdeck
pkgver=0.2.7.r177.g6ba3104
pkgrel=1
pkgdesc="Desktop client for the pi coding agent"
arch=(x86_64)
url="https://github.com/matheusbbdutra/sightdeck"
license=(MIT)
depends=(webkit2gtk-4.1 gtk3 librsvg hicolor-icon-theme)
makedepends=(rust nodejs npm)
optdepends=("pi: cliente do agente que o app abre (instalado fora dos repos)")
# O makepkg do Arch/CachyOS liga OPTIONS=(lto) e exporta -flto=auto nos CFLAGS: o C do
# crate `ring` vira bitcode que o rust-lld (-fuse-ld=lld) não lê e o link do binário
# morre com 21 "undefined symbol: ring_core_0_17_14__*". Aqui o lto sai do makepkg.
options=(!lto)
source=()

# 0.2.6.r<commits>.g<hash>: instalar de novo depois de commitar já atualiza a versão.
# Obs.: o makepkg regrava o pkgver= acima a cada build (comportamento normal).
pkgver() {
  cd "$startdir"
  local v
  v=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json | head -1)
  printf '%s.r%s.g%s' "$v" "$(git rev-list --count HEAD)" "$(git rev-parse --short HEAD)"
}

build() {
  cd "$startdir"
  npm ci --no-audit --no-fund
  # beforeBuildCommand do tauri.conf.json
  npm run build:ui
  cargo build --release --locked --features tauri/custom-protocol \
    --manifest-path src-tauri/Cargo.toml
  # `tauri build` liga `custom-protocol`; sem ela o binário roda em modo dev e abre
  # http://localhost:1420 ("Could not connect to localhost") em vez do ui/dist embutido.
}

package() {
  cd "$startdir"
  install -Dm755 src-tauri/target/release/sightdeck "$pkgdir/usr/bin/sightdeck"

  local -A icons=(
    [32x32.png]=32
    [64x64.png]=64
    [128x128.png]=128
    ["128x128@2x.png"]=256
    [icon.png]=512
  )
  local f
  for f in "${!icons[@]}"; do
    install -Dm644 "src-tauri/icons/$f" \
      "$pkgdir/usr/share/icons/hicolor/${icons[$f]}x${icons[$f]}/apps/sightdeck.png"
  done

  install -d "$pkgdir/usr/share/applications"
  # Exec absoluto de propósito: com `Exec=sightdeck` o lançador resolve pelo PATH do
  # usuário e um binário antigo em ~/.local/bin (que vem antes de /usr/bin) roda no
  # lugar do pacote — foi o que fez o each_key_duplicate reaparecer em 2026-11-21.
  cat > "$pkgdir/usr/share/applications/sightdeck.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=sightdeck
Comment=Desktop client for the pi coding agent
Exec=/usr/bin/sightdeck
Icon=sightdeck
Categories=Development;
Terminal=false
StartupWMClass=sightdeck
EOF

  install -Dm644 LICENSE "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
